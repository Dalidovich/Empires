import type { GameData } from '../../data/types';
import { removeEntity } from '../core/entities';
import { distanceToEntity, entityRadius } from '../core/geometry';
import { entitiesInRadius, nearestEntity } from '../core/spatial';
import { getUnitStats } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, GameState, Projectile, Vec2 } from '../types';
import type { Strike } from './combat';
import {
  combatProfile,
  dealDamage,
  elevationMultiplier,
  isAttackable,
  stanceToward,
  strikeDamage,
} from './combat';

const HIT_TOLERANCE = 0.25;
const STRAY_SCAN_RADIUS = 1.5;
const LARGEST_HALF_FOOTPRINT = 4;

function strikeOfProjectile(state: GameState, projectile: Projectile, data: GameData): Strike {
  const source = state.entities[projectile.sourceId];
  const live =
    source && source.type === projectile.sourceType ? combatProfile(state, source, data) : null;
  let bonuses = live?.bonuses;
  if (!bonuses) {
    bonuses = data.units[projectile.sourceType]
      ? getUnitStats(state, projectile.owner, projectile.sourceType, data).bonuses
      : [];
  }
  return {
    attack: projectile.damage,
    ranged: projectile.ranged,
    bonuses,
    weakAgainstFortifications: false,
  };
}

function distanceToFlight(projectile: Projectile, point: Vec2): number {
  const { origin, destination } = projectile;
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const lengthSq = dx * dx + dy * dy;
  let share = 0;
  if (lengthSq > 0) {
    share = ((point.x - origin.x) * dx + (point.y - origin.y) * dy) / lengthSq;
    share = Math.min(1, Math.max(0, share));
  }
  return Math.hypot(point.x - (origin.x + dx * share), point.y - (origin.y + dy * share));
}

function isStruck(projectile: Projectile, target: Entity, data: GameData): boolean {
  if (target.kind !== 'unit') {
    return distanceToEntity(projectile.destination, target, data) <= HIT_TOLERANCE;
  }
  return (
    distanceToFlight(projectile, target.position) <= entityRadius(target, data) + HIT_TOLERANCE
  );
}

function damage(
  state: GameState,
  projectile: Projectile,
  victim: Entity,
  strike: Strike,
  ctx: StepContext,
): void {
  const defender = combatProfile(state, victim, ctx.data);
  if (!defender) {
    return;
  }
  const elevation = elevationMultiplier(state, projectile.origin, victim.position, ctx.data);
  dealDamage(
    state,
    victim,
    strikeDamage(strike, defender, elevation),
    ctx,
    projectile.sourceId,
    projectile.owner,
  );
}

function announce(projectile: Projectile, targetId: number, ctx: StepContext): void {
  ctx.events.push({
    type: 'attackHit',
    attackerId: projectile.sourceId,
    attackerType: projectile.sourceType,
    targetId,
    position: { x: projectile.destination.x, y: projectile.destination.y },
  });
}

function explode(state: GameState, projectile: Projectile, ctx: StepContext): void {
  const data = ctx.data;
  const victims = entitiesInRadius(
    state,
    projectile.destination,
    projectile.blastRadius + LARGEST_HALF_FOOTPRINT,
    (entity) =>
      isAttackable(entity) &&
      distanceToEntity(projectile.destination, entity, data) <= projectile.blastRadius &&
      (projectile.friendlyFire ||
        stanceToward(state, projectile.owner, entity.owner) !== 'ally'),
  );
  announce(projectile, projectile.targetId ?? victims[0]?.id ?? 0, ctx);
  const strike = strikeOfProjectile(state, projectile, data);
  for (const victim of victims) {
    damage(state, projectile, victim, strike, ctx);
  }
  fellTrees(state, projectile, data);
}

function fellTrees(state: GameState, projectile: Projectile, data: GameData): void {
  const trees = entitiesInRadius(
    state,
    projectile.destination,
    projectile.blastRadius,
    (entity) =>
      entity.kind === 'resource' && data.resourceSources[entity.type]?.gatherKind === 'wood',
  );
  for (const tree of trees) {
    removeEntity(state, tree.id, data);
  }
}

function land(state: GameState, projectile: Projectile, ctx: StepContext): void {
  const data = ctx.data;
  const target = projectile.targetId !== null ? state.entities[projectile.targetId] : undefined;
  let victim: Entity | null =
    target && isAttackable(target) && isStruck(projectile, target, data) ? target : null;
  if (!victim) {
    victim = nearestEntity(
      state,
      projectile.destination,
      STRAY_SCAN_RADIUS,
      (entity) =>
        entity.kind === 'unit' &&
        isAttackable(entity) &&
        stanceToward(state, projectile.owner, entity.owner) === 'enemy' &&
        distanceToEntity(projectile.destination, entity, data) <= HIT_TOLERANCE,
    );
  }
  if (!victim) {
    return;
  }
  announce(projectile, victim.id, ctx);
  damage(state, projectile, victim, strikeOfProjectile(state, projectile, data), ctx);
}

function update(state: GameState, ctx: StepContext): void {
  if (state.projectiles.length === 0) {
    return;
  }
  const flying: Projectile[] = [];
  for (const projectile of state.projectiles) {
    if (projectile.arriveTick > state.tick) {
      flying.push(projectile);
    } else if (projectile.blastRadius > 0) {
      explode(state, projectile, ctx);
    } else {
      land(state, projectile, ctx);
    }
  }
  state.projectiles = flying;
}

export const projectilesSystem: System = {
  id: 'projectiles',
  update,
};
