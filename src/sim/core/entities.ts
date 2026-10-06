import type { GameData } from '../../data/types';
import { recordStat } from '../playerStats';
import type { StepContext } from '../system';
import type {
  Entity,
  EntityId,
  EntityKind,
  EntitySpec,
  GameMap,
  GameState,
  PlayerId,
  TileCoord,
  Vec2,
} from '../types';
import { GAIA_PLAYER_ID, TILE_FREE } from '../types';
import { invalidateNavGrid } from './navgrid';
import { indexEntity, unindexEntity } from './spatial';

export function tileIndex(map: GameMap, x: number, y: number): number {
  return y * map.size + x;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.size && y < map.size;
}

export function footprintSize(type: string, data: GameData): number {
  const building = data.buildings[type];
  if (building) {
    return building.size;
  }
  const source = data.resourceSources[type];
  if (source) {
    return source.size;
  }
  const object = data.mapObjects[type];
  if (object) {
    return object.size;
  }
  return 0;
}

export function entityFootprint(entity: { kind: EntityKind; type: string }, data: GameData): number {
  switch (entity.kind) {
    case 'building':
      return data.buildings[entity.type]?.size ?? 0;
    case 'resource':
      return data.resourceSources[entity.type]?.size ?? 0;
    case 'object':
      return data.mapObjects[entity.type]?.size ?? 0;
    default:
      return 0;
  }
}

export function footprintOrigin(position: Vec2, size: number): TileCoord {
  return {
    x: Math.floor(position.x - size / 2 + 0.5),
    y: Math.floor(position.y - size / 2 + 0.5),
  };
}

export function footprintCenter(tile: TileCoord, size: number): Vec2 {
  return { x: tile.x + size / 2, y: tile.y + size / 2 };
}

export function blocksTiles(entity: { kind: EntityKind; type: string }, data: GameData): boolean {
  if (entity.kind === 'building') {
    return true;
  }
  if (entity.kind === 'resource') {
    return data.resourceSources[entity.type]?.blocksMovement ?? false;
  }
  if (entity.kind === 'object') {
    return data.mapObjects[entity.type]?.kind === 'ruin';
  }
  return false;
}

function setFootprint(map: GameMap, position: Vec2, size: number, value: number): void {
  const origin = footprintOrigin(position, size);
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = origin.x + dx;
      const y = origin.y + dy;
      if (inBounds(map, x, y)) {
        map.occupancy[tileIndex(map, x, y)] = value;
      }
    }
  }
}

export function isFootprintFree(map: GameMap, tile: TileCoord, size: number): boolean {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (!inBounds(map, x, y) || map.occupancy[tileIndex(map, x, y)] !== TILE_FREE) {
        return false;
      }
    }
  }
  return true;
}

export function occupyFootprint(state: GameState, entity: Entity, data: GameData): void {
  setFootprint(state.map, entity.position, entityFootprint(entity, data), entity.id);
  invalidateNavGrid(state);
}

export function releaseFootprint(state: GameState, entity: Entity, data: GameData): void {
  const size = entityFootprint(entity, data);
  if (size === 0) {
    return;
  }
  const origin = footprintOrigin(entity.position, size);
  let released = false;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const x = origin.x + dx;
      const y = origin.y + dy;
      if (!inBounds(state.map, x, y)) {
        continue;
      }
      const index = tileIndex(state.map, x, y);
      if (state.map.occupancy[index] === entity.id) {
        state.map.occupancy[index] = TILE_FREE;
        released = true;
      }
    }
  }
  if (released) {
    invalidateNavGrid(state);
  }
}

function initialHp(spec: EntitySpec, data: GameData): number {
  if (spec.hp !== undefined) {
    return spec.hp;
  }
  if (spec.kind === 'unit') {
    return data.units[spec.type]?.hp ?? 1;
  }
  if (spec.kind === 'building') {
    return data.buildings[spec.type]?.hp ?? 1;
  }
  return 1;
}

function initialAmount(spec: EntitySpec, data: GameData): number | null {
  if (spec.amount !== undefined) {
    return spec.amount;
  }
  if (spec.kind === 'resource') {
    return data.resourceSources[spec.type]?.amount ?? 0;
  }
  return null;
}

export function spawnEntity(state: GameState, spec: EntitySpec, data: GameData): Entity {
  const id = state.nextEntityId;
  state.nextEntityId += 1;
  const isBuilding = spec.kind === 'building';
  const buildProgress = isBuilding ? (spec.buildProgress ?? 1) : null;
  const entity: Entity = {
    id,
    kind: spec.kind,
    type: spec.type,
    owner: spec.owner,
    position: { x: spec.position.x, y: spec.position.y },
    facing: 0,
    hp: initialHp(spec, data),
    orders: [],
    state: buildProgress !== null && buildProgress < 1 ? 'foundation' : 'idle',
    standGround: false,
    target: null,
    attackCooldown: 0,
    path: null,
    anchor: null,
    carry: null,
    faith: null,
    conversionProgress: 0,
    cargo: [],
    carriedBy: null,
    buildProgress,
    paid: null,
    queue: [],
    rallyPoint: null,
    research: null,
    amount: initialAmount(spec, data),
    workers: [],
    heldBy: null,
    statsOwner: null,
    frozenStats: null,
    lastAttackedTick: -1,
    lastAttackerId: null,
    scratch: {},
  };
  state.entities[id] = entity;
  if (blocksTiles(spec, data)) {
    occupyFootprint(state, entity, data);
  }
  indexEntity(state, entity);
  return entity;
}

function releaseHeldObjects(state: GameState, holderId: EntityId): void {
  for (const other of Object.values(state.entities)) {
    if (other.heldBy === holderId) {
      other.heldBy = null;
    }
  }
}

export function removeEntity(state: GameState, id: EntityId, data: GameData): void {
  const entity = state.entities[id];
  if (!entity) {
    return;
  }
  for (const cargoId of [...entity.cargo]) {
    removeEntity(state, cargoId, data);
  }
  if (entity.carriedBy !== null) {
    const carrier = state.entities[entity.carriedBy];
    if (carrier) {
      carrier.cargo = carrier.cargo.filter((cargoId) => cargoId !== id);
    }
  }
  releaseFootprint(state, entity, data);
  if (entity.kind === 'unit') {
    releaseHeldObjects(state, id);
  }
  unindexEntity(state, id);
  delete state.entities[id];
}

export function getEntity(state: GameState, id: EntityId | null): Entity | null {
  if (id === null) {
    return null;
  }
  return state.entities[id] ?? null;
}

function recordDeath(state: GameState, entity: Entity, killerOwner: PlayerId | null): void {
  const hostileKill = killerOwner !== null && killerOwner !== entity.owner;
  if (entity.kind === 'unit') {
    recordStat(state, entity.owner, 'unitsLost', 1);
    if (hostileKill && entity.owner !== GAIA_PLAYER_ID) {
      recordStat(state, killerOwner, 'unitsKilled', 1);
    }
  } else if (entity.kind === 'building' && entity.buildProgress === 1) {
    recordStat(state, entity.owner, 'buildingsLost', 1);
    if (hostileKill) {
      recordStat(state, killerOwner, 'buildingsRazed', 1);
    }
  }
}

export function killEntity(
  state: GameState,
  id: EntityId,
  ctx: StepContext,
  killerOwner: PlayerId | null = null,
): void {
  const entity = state.entities[id];
  if (!entity) {
    return;
  }
  ctx.events.push({
    type: 'entityDied',
    entityId: entity.id,
    entityKind: entity.kind,
    entityType: entity.type,
    owner: entity.owner,
    killerOwner,
    position: { x: entity.position.x, y: entity.position.y },
  });
  recordDeath(state, entity, killerOwner);
  for (const cargoId of [...entity.cargo]) {
    killEntity(state, cargoId, ctx, killerOwner);
  }
  const animal = entity.kind === 'unit' ? ctx.data.units[entity.type]?.animal : undefined;
  const position = { x: entity.position.x, y: entity.position.y };
  removeEntity(state, id, ctx.data);
  if (animal && ctx.data.resourceSources[animal.carcass]) {
    spawnEntity(
      state,
      {
        kind: 'resource',
        type: animal.carcass,
        owner: GAIA_PLAYER_ID,
        position,
        amount: animal.food,
      },
      ctx.data,
    );
  }
}

export function applyDamage(
  state: GameState,
  target: Entity,
  amount: number,
  ctx: StepContext,
  attackerId: EntityId | null = null,
  attackerOwner: PlayerId | null = null,
): boolean {
  if (amount <= 0 || state.entities[target.id] !== target) {
    return false;
  }
  target.hp -= amount;
  target.lastAttackedTick = state.tick;
  if (attackerId !== null) {
    target.lastAttackerId = attackerId;
  }
  if (target.hp > 0) {
    return false;
  }
  target.hp = 0;
  killEntity(state, target.id, ctx, attackerOwner);
  return true;
}
