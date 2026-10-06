import type { GameData, MovementDomain } from '../../data/types';
import { inBounds, tileIndex } from '../core/entities';
import { distanceSq } from '../core/geometry';
import { domainOf, isPositionPassable } from '../core/navgrid';
import { issueOrder } from '../core/orders';
import { freeTilesNear, isReachable } from '../core/pathfinding';
import { forEachEntityNear } from '../core/spatial';
import type { Entity, GameState, Vec2 } from '../types';
import { TILE_FREE } from '../types';

const REVEAL_INTERVAL = 10;
const OCCLUSION_DEPTH = 2;
const OCCLUSION_STEP = 0.5;
const SEARCH_TILES = 120;
const CROWD_RADIUS = 0.45;
const RALLY_MINIMUM_SQ = 1;

export function occludingBuilding(state: GameState, data: GameData, point: Vec2): Entity | null {
  const map = state.map;
  for (let offset = OCCLUSION_STEP; offset <= OCCLUSION_DEPTH; offset += OCCLUSION_STEP) {
    const x = Math.floor(point.x + offset);
    const y = Math.floor(point.y + offset);
    if (!inBounds(map, x, y)) {
      return null;
    }
    const occupant = map.occupancy[tileIndex(map, x, y)];
    if (occupant === TILE_FREE) {
      continue;
    }
    const entity = state.entities[occupant];
    if (
      entity &&
      entity.kind === 'building' &&
      entity.buildProgress === 1 &&
      !(data.buildings[entity.type]?.class.includes('farm') ?? true)
    ) {
      return entity;
    }
  }
  return null;
}

function isCrowded(state: GameState, unit: Entity, point: Vec2): boolean {
  let crowded = false;
  forEachEntityNear(state, point.x, point.y, CROWD_RADIUS, (other) => {
    if (other.id !== unit.id && other.kind === 'unit') {
      crowded = true;
    }
  });
  return crowded;
}

function rallyTarget(
  state: GameState,
  data: GameData,
  unit: Entity,
  building: Entity,
  domain: MovementDomain,
): Vec2 | null {
  const rally = building.rallyPoint;
  if (!rally || building.owner !== unit.owner) {
    return null;
  }
  const point = rally.position;
  if (
    distanceSq(unit.position, point) < RALLY_MINIMUM_SQ ||
    !isPositionPassable(state, data, domain, point) ||
    !isReachable(state, data, domain, unit.position, point) ||
    occludingBuilding(state, data, point) !== null
  ) {
    return null;
  }
  return { x: point.x, y: point.y };
}

function visibleTarget(
  state: GameState,
  data: GameData,
  unit: Entity,
  domain: MovementDomain,
  claimed: Set<number>,
): Vec2 | null {
  const map = state.map;
  for (const tile of freeTilesNear(state, data, domain, unit.position, SEARCH_TILES)) {
    const index = tileIndex(map, Math.floor(tile.x), Math.floor(tile.y));
    if (
      claimed.has(index) ||
      occludingBuilding(state, data, tile) !== null ||
      isCrowded(state, unit, tile)
    ) {
      continue;
    }
    claimed.add(index);
    return tile;
  }
  return null;
}

export function revealHiddenIdle(state: GameState, data: GameData): void {
  if (state.tick % REVEAL_INTERVAL !== 0) {
    return;
  }
  const claimed = new Set<number>();
  for (const unit of Object.values(state.entities)) {
    if (
      unit.kind !== 'unit' ||
      unit.state !== 'idle' ||
      unit.orders.length > 0 ||
      unit.carriedBy !== null ||
      unit.standGround ||
      state.players[unit.owner]?.kind !== 'human'
    ) {
      continue;
    }
    const building = occludingBuilding(state, data, unit.position);
    if (!building) {
      continue;
    }
    const domain = domainOf(unit, data);
    const target =
      rallyTarget(state, data, unit, building, domain) ??
      visibleTarget(state, data, unit, domain, claimed);
    if (target) {
      issueOrder(unit, { type: 'move', target }, false);
    }
  }
}
