import type { GameData } from '../../data/types';
import { REACH_SLACK, distance } from '../core/geometry';
import { moveToward } from '../core/movement';
import { completeOrder, issueOrder, resetActivity } from '../core/orders';
import { nearestEntity } from '../core/spatial';
import type { StepContext, System } from '../system';
import type { AttackMoveOrder, Entity, GameState, Order, Vec2 } from '../types';
import type { AutoMemory, CombatProfile } from './combat';
import {
  autoMemoryOf,
  clearAutoMemory,
  combatDistance,
  combatProfile,
  isAttackable,
  setAutoMemory,
  stanceToward,
  withinReach,
} from './combat';

const SCAN_INTERVAL = 5;
const CHASE_MARGIN = 3;
const RETURN_TOLERANCE = 1;
const RETALIATION_SECONDS = 3;
const LARGEST_HALF_FOOTPRINT = 3;

interface Engagement {
  target: Entity;
  leash: number;
}

function syncMemory(entity: Entity, order: Order | null): AutoMemory | null {
  const memory = autoMemoryOf(entity);
  if (memory) {
    if (memory.returning) {
      if (
        order &&
        order.type === 'move' &&
        order.target.x === memory.x &&
        order.target.y === memory.y
      ) {
        return memory;
      }
    } else if (order && order.type === 'attack' && order.targetId === memory.targetId) {
      return memory;
    }
    clearAutoMemory(entity);
  }
  if (order && entity.anchor !== null) {
    entity.anchor = null;
  }
  return null;
}

function isGuard(entity: Entity, profile: CombatProfile | null): profile is CombatProfile {
  if (!profile || profile.attack <= 0) {
    return false;
  }
  if (entity.kind === 'building') {
    return entity.buildProgress === 1;
  }
  return profile.classes.includes('military');
}

function retaliationTarget(state: GameState, entity: Entity, data: GameData): Entity | null {
  if (entity.lastAttackerId === null || entity.lastAttackedTick < 0) {
    return null;
  }
  if (state.tick - entity.lastAttackedTick > RETALIATION_SECONDS * data.game.tickRate) {
    return null;
  }
  const attacker = state.entities[entity.lastAttackerId];
  if (
    !attacker ||
    !isAttackable(attacker) ||
    stanceToward(state, entity.owner, attacker.owner) === 'ally'
  ) {
    return null;
  }
  return attacker;
}

function findTarget(
  state: GameState,
  entity: Entity,
  profile: CombatProfile,
  origin: Vec2,
  data: GameData,
): Engagement | null {
  const stationary = entity.kind === 'building' || entity.standGround;
  const leash = profile.lineOfSight + CHASE_MARGIN;
  const attacker = retaliationTarget(state, entity, data);
  if (attacker && (!stationary || withinReach(entity, attacker, profile, data))) {
    if (profile.minRange <= 0 || combatDistance(entity, attacker, data) >= profile.minRange) {
      return {
        target: attacker,
        leash: Math.max(leash, distance(attacker.position, origin) + CHASE_MARGIN),
      };
    }
  }
  const radius = stationary
    ? profile.range + REACH_SLACK + LARGEST_HALF_FOOTPRINT
    : profile.lineOfSight;
  const eligible = (other: Entity): boolean =>
    isAttackable(other) &&
    stanceToward(state, entity.owner, other.owner) === 'enemy' &&
    distance(other.position, origin) <= leash &&
    (stationary
      ? withinReach(entity, other, profile, data)
      : profile.minRange <= 0 || combatDistance(entity, other, data) >= profile.minRange);
  const target =
    nearestEntity(state, entity.position, radius, (other) => other.kind === 'unit' && eligible(other)) ??
    nearestEntity(
      state,
      entity.position,
      radius,
      (other) =>
        other.kind === 'building' &&
        eligible(other) &&
        !(data.buildings[other.type]?.class.includes('wall') ?? false),
    );
  return target ? { target, leash } : null;
}

function engage(entity: Entity, engagement: Engagement, origin: Vec2): void {
  setAutoMemory(entity, {
    targetId: engagement.target.id,
    x: origin.x,
    y: origin.y,
    leash: engagement.leash,
    returning: false,
  });
}

function guard(state: GameState, entity: Entity, returning: boolean, data: GameData): void {
  const profile = combatProfile(state, entity, data);
  if (!isGuard(entity, profile)) {
    return;
  }
  const origin = entity.anchor ?? entity.position;
  const engagement = findTarget(state, entity, profile, origin, data);
  if (engagement) {
    if (entity.kind === 'unit' && entity.anchor === null) {
      entity.anchor = { x: entity.position.x, y: entity.position.y };
    }
    const home = entity.anchor ?? entity.position;
    issueOrder(entity, { type: 'attack', targetId: engagement.target.id }, false);
    engage(entity, engagement, home);
    return;
  }
  const anchor = entity.anchor;
  if (returning || anchor === null) {
    return;
  }
  if (entity.standGround || distance(entity.position, anchor) <= RETURN_TOLERANCE) {
    entity.anchor = null;
    return;
  }
  issueOrder(entity, { type: 'move', target: { x: anchor.x, y: anchor.y } }, false);
  setAutoMemory(entity, { targetId: 0, x: anchor.x, y: anchor.y, leash: 0, returning: true });
}

function advanceAttackMove(
  state: GameState,
  entity: Entity,
  order: AttackMoveOrder,
  data: GameData,
): void {
  if ((state.tick + entity.id) % SCAN_INTERVAL === 0) {
    const profile = combatProfile(state, entity, data);
    if (isGuard(entity, profile)) {
      const engagement = findTarget(state, entity, profile, entity.position, data);
      if (engagement) {
        resetActivity(entity);
        entity.orders.unshift({ type: 'attack', targetId: engagement.target.id });
        engage(entity, engagement, entity.position);
        return;
      }
    }
  }
  if (moveToward(state, entity, order.target) === 'moving') {
    entity.state = 'moving';
  } else {
    completeOrder(entity);
  }
}

function update(state: GameState, ctx: StepContext): void {
  for (const entity of Object.values(state.entities)) {
    if (
      entity.owner < 0 ||
      entity.carriedBy !== null ||
      (entity.kind !== 'unit' && entity.kind !== 'building')
    ) {
      continue;
    }
    const order = entity.orders.length > 0 ? entity.orders[0] : null;
    const memory = syncMemory(entity, order);
    if (order && order.type === 'attackMove') {
      if (entity.kind === 'unit') {
        advanceAttackMove(state, entity, order, ctx.data);
      }
      continue;
    }
    const returning = memory !== null && memory.returning;
    if (order && !returning) {
      continue;
    }
    if ((state.tick + entity.id) % SCAN_INTERVAL !== 0) {
      continue;
    }
    guard(state, entity, returning, ctx.data);
  }
}

export const autoTargetSystem: System = {
  id: 'autoTarget',
  update,
};
