import type { GameData } from '../../data/types';
import type { Entity, EntityId, GameState, JsonValue, Vec2 } from '../types';
import { distance, inRange } from './geometry';

export type MoveStatus = 'moving' | 'arrived' | 'unreachable';

export type NavStatus = 'pending' | 'moving' | 'done';

export interface NavState {
  goal: Vec2;
  via: Vec2 | null;
  targetId: EntityId | null;
  range: number;
  status: NavStatus;
  requested: number;
  stall: number;
  repaths: number;
}

export const ARRIVAL_TOLERANCE = 0.3;

const NAV_KEY = 'nav';
const ALREADY_THERE = 0.05;
const RETARGET_DRIFT = 0.5;
const RETARGET_INTERVAL = 10;

export function navOf(entity: Entity): NavState | null {
  const nav = entity.scratch[NAV_KEY];
  return nav ? (nav as unknown as NavState) : null;
}

export function isMoving(entity: Entity): boolean {
  const nav = navOf(entity);
  return nav !== null && nav.status !== 'done';
}

export function stopMoving(entity: Entity): void {
  if (NAV_KEY in entity.scratch) {
    delete entity.scratch[NAV_KEY];
  }
  entity.path = null;
}

export function requestPath(
  state: GameState,
  entity: Entity,
  goal: Vec2,
  via: Vec2 | null,
  targetId: EntityId | null,
  range: number,
  keepPath: boolean,
): void {
  const nav: NavState = {
    goal: { x: goal.x, y: goal.y },
    via: via ? { x: via.x, y: via.y } : null,
    targetId,
    range,
    status: 'pending',
    requested: state.tick,
    stall: 0,
    repaths: 0,
  };
  entity.scratch[NAV_KEY] = nav as unknown as JsonValue;
  if (!keepPath) {
    entity.path = null;
  }
}

export function moveToward(
  state: GameState,
  entity: Entity,
  goal: Vec2,
  via: Vec2 | null = null,
): MoveStatus {
  const nav = navOf(entity);
  if (nav && nav.targetId === null && nav.goal.x === goal.x && nav.goal.y === goal.y) {
    if (nav.status !== 'done') {
      return 'moving';
    }
    return distance(entity.position, goal) <= ARRIVAL_TOLERANCE ? 'arrived' : 'unreachable';
  }
  if (distance(entity.position, goal) <= ALREADY_THERE) {
    stopMoving(entity);
    return 'arrived';
  }
  requestPath(state, entity, goal, via, null, 0, false);
  return 'moving';
}

export function approach(
  state: GameState,
  entity: Entity,
  target: Entity,
  range: number,
  data: GameData,
): MoveStatus {
  if (inRange(entity, target, range, data)) {
    stopMoving(entity);
    return 'arrived';
  }
  const nav = navOf(entity);
  if (nav && nav.targetId === target.id && nav.range === range) {
    const drifted = distance(nav.goal, target.position) > RETARGET_DRIFT;
    if (drifted && state.tick - nav.requested >= RETARGET_INTERVAL) {
      requestPath(state, entity, target.position, null, target.id, range, true);
      return 'moving';
    }
    return nav.status === 'done' ? 'unreachable' : 'moving';
  }
  requestPath(state, entity, target.position, null, target.id, range, false);
  return 'moving';
}
