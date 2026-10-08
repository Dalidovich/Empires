import type { GameData } from '../../data/types';
import { getBuildingStats, getUnitStats } from '../stats';
import type { Entity, FogState, GameState, Player, PlayerId, RememberedEntity } from '../types';
import { FOG, GAIA_PLAYER_ID } from '../types';
import { entityFootprint, footprintOrigin } from './entities';

const SHARED_EXPLORATION_INTERVAL = 20;

const circles = new Map<number, Int16Array>();

function circleOffsets(radius: number): Int16Array {
  const key = Math.round(radius * 2);
  const cached = circles.get(key);
  if (cached) {
    return cached;
  }
  const reach = key / 2;
  const span = Math.ceil(reach);
  const offsets: number[] = [];
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      if (dx * dx + dy * dy <= reach * reach) {
        offsets.push(dx, dy);
      }
    }
  }
  const packed = Int16Array.from(offsets);
  circles.set(key, packed);
  return packed;
}

export function fogAt(player: Player, tile: number): FogState {
  if (player.visible[tile] > 0) {
    return FOG.visible;
  }
  return player.explored[tile] === 1 ? FOG.explored : FOG.unexplored;
}

export function isTileVisible(state: GameState, playerId: PlayerId, x: number, y: number): boolean {
  const player = state.players[playerId];
  const size = state.map.size;
  if (!player || x < 0 || y < 0 || x >= size || y >= size) {
    return false;
  }
  return player.visible[y * size + x] > 0;
}

export function isTileExplored(state: GameState, playerId: PlayerId, x: number, y: number): boolean {
  const player = state.players[playerId];
  const size = state.map.size;
  if (!player || x < 0 || y < 0 || x >= size || y >= size) {
    return false;
  }
  return player.explored[y * size + x] === 1;
}

function footprintMatches(
  state: GameState,
  entity: Entity,
  data: GameData,
  layer: readonly number[],
): boolean {
  const size = state.map.size;
  const footprint = entityFootprint(entity, data);
  if (footprint <= 1) {
    const x = Math.floor(entity.position.x);
    const y = Math.floor(entity.position.y);
    return x >= 0 && y >= 0 && x < size && y < size && layer[y * size + x] > 0;
  }
  const origin = footprintOrigin(entity.position, footprint);
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      const x = origin.x + dx;
      const y = origin.y + dy;
      if (x >= 0 && y >= 0 && x < size && y < size && layer[y * size + x] > 0) {
        return true;
      }
    }
  }
  return false;
}

export function isEntityVisible(
  state: GameState,
  playerId: PlayerId,
  entity: Entity,
  data: GameData,
): boolean {
  const player = state.players[playerId];
  if (!player || entity.carriedBy !== null) {
    return false;
  }
  if (entity.owner === playerId) {
    return true;
  }
  return footprintMatches(state, entity, data, player.visible);
}

export function isEntityExplored(
  state: GameState,
  playerId: PlayerId,
  entity: Entity,
  data: GameData,
): boolean {
  const player = state.players[playerId];
  if (!player) {
    return false;
  }
  return footprintMatches(state, entity, data, player.explored);
}

function sightOf(
  state: GameState,
  entity: Entity,
  data: GameData,
  cache: Map<string, number>,
): number {
  const owner = entity.statsOwner ?? entity.owner;
  const key = `${entity.kind}:${owner}:${entity.type}`;
  let sight = cache.get(key);
  if (sight === undefined) {
    if (entity.kind === 'unit' && data.units[entity.type]) {
      sight = getUnitStats(state, owner, entity.type, data).lineOfSight;
    } else if (entity.kind === 'building' && data.buildings[entity.type]) {
      sight =
        getBuildingStats(state, owner, entity.type, data).lineOfSight +
        data.buildings[entity.type].size / 2;
    } else if (entity.kind === 'object') {
      sight = data.mapObjects[entity.type]?.lineOfSight ?? 0;
    } else {
      sight = 0;
    }
    cache.set(key, sight);
  }
  return sight;
}

function viewersOf(state: GameState): Player[][] {
  return state.players.map((owner) =>
    state.players.filter(
      (viewer) => viewer.id === owner.id || owner.diplomacy[viewer.id] === 'ally',
    ),
  );
}

function reveal(state: GameState, entity: Entity, sight: number, viewers: readonly Player[]): void {
  const size = state.map.size;
  const offsets = circleOffsets(sight);
  const centerX = Math.floor(entity.position.x);
  const centerY = Math.floor(entity.position.y);
  for (let i = 0; i < offsets.length; i += 2) {
    const x = centerX + offsets[i];
    const y = centerY + offsets[i + 1];
    if (x < 0 || y < 0 || x >= size || y >= size) {
      continue;
    }
    const tile = y * size + x;
    for (let v = 0; v < viewers.length; v++) {
      const viewer = viewers[v];
      viewer.visible[tile] += 1;
      viewer.explored[tile] = 1;
    }
  }
}

function remember(player: Player, entity: Entity, tick: number): void {
  const known: RememberedEntity | undefined = player.remembered[entity.id];
  if (
    known &&
    known.hp === entity.hp &&
    known.owner === entity.owner &&
    known.type === entity.type &&
    known.buildProgress === entity.buildProgress
  ) {
    return;
  }
  player.remembered[entity.id] = {
    id: entity.id,
    kind: entity.kind,
    type: entity.type,
    owner: entity.owner,
    position: { x: entity.position.x, y: entity.position.y },
    hp: entity.hp,
    buildProgress: entity.buildProgress,
    tick,
  };
}

function refreshMemory(state: GameState, data: GameData, buildings: readonly Entity[]): void {
  const size = state.map.size;
  const seedAll = state.tick === 0 && state.settings.revealMap;
  for (const player of state.players) {
    for (const building of buildings) {
      if (building.owner === player.id) {
        continue;
      }
      if (seedAll || footprintMatches(state, building, data, player.visible)) {
        remember(player, building, state.tick);
      }
    }
    for (const key of Object.keys(player.remembered)) {
      const known = player.remembered[key];
      const entity = state.entities[known.id];
      if (entity && entity.kind === 'building' && entity.owner !== player.id) {
        continue;
      }
      const x = Math.floor(known.position.x);
      const y = Math.floor(known.position.y);
      const seen = x >= 0 && y >= 0 && x < size && y < size && player.visible[y * size + x] > 0;
      if (seen || (entity && entity.owner === player.id)) {
        delete player.remembered[key];
      }
    }
  }
}

function shareExploration(state: GameState): void {
  for (const player of state.players) {
    if (!player.sharedExploration) {
      continue;
    }
    for (const ally of state.players) {
      if (
        ally.id === player.id ||
        player.diplomacy[ally.id] !== 'ally' ||
        ally.diplomacy[player.id] !== 'ally'
      ) {
        continue;
      }
      const source = ally.explored;
      const target = player.explored;
      for (let i = 0; i < source.length; i++) {
        if (source[i] === 1) {
          target[i] = 1;
        }
      }
    }
  }
}

export function updateVisibility(state: GameState, data: GameData): void {
  const noFog = state.settings.noFog === true;
  for (const player of state.players) {
    if (noFog && player.kind === 'human') {
      player.visible.fill(1);
      player.explored.fill(1);
    } else {
      player.visible.fill(0);
    }
  }
  const viewers = viewersOf(state);
  const sights = new Map<string, number>();
  const buildings: Entity[] = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'building') {
      buildings.push(entity);
    }
    if (entity.owner === GAIA_PLAYER_ID || entity.carriedBy !== null || entity.kind === 'resource') {
      continue;
    }
    const recipients = viewers[entity.owner];
    if (!recipients) {
      continue;
    }
    const sight = sightOf(state, entity, data, sights);
    if (sight > 0) {
      reveal(state, entity, sight, recipients);
    }
  }
  refreshMemory(state, data, buildings);
  if (state.tick % SHARED_EXPLORATION_INTERVAL === 0) {
    shareExploration(state);
  }
}
