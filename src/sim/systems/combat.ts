import type { AttackBonus, GameData, PlayerFlag } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import { applyDamage } from '../core/entities';
import {
  REACH_SLACK,
  distance,
  distanceToEntity,
  elevationAt,
  entityDistance,
  entityRadius,
  inRange,
} from '../core/geometry';
import { approach, isMoving, moveToward, navOf, stopMoving } from '../core/movement';
import {
  commandableUnits,
  completeOrder,
  formationTargets,
  issueOrder,
  rejectCommand,
} from '../core/orders';
import { entitiesInRadius, forEachEntityNear } from '../core/spatial';
import type { BuildingStats, UnitStats } from '../stats';
import { getBuildingStats, getUnitStats, hasPlayerFlag } from '../stats';
import type { StepContext, System } from '../system';
import type {
  AttackGroundOrder,
  Entity,
  EntityId,
  GameState,
  JsonValue,
  PlayerId,
  Stance,
  Vec2,
} from '../types';

const AUTO_KEY = 'auto';
const ALERT_SECONDS = 10;
const ALERT_RADIUS = 10;
const TRAMPLE_SCAN_MARGIN = 2;
const LEAD_ITERATIONS = 2;
const STANDOFF_MARGIN = 0.5;
const FORTIFICATION_CLASSES: readonly string[] = ['wall', 'tower'];

export interface CombatProfile {
  classes: readonly string[];
  hp: number;
  attack: number;
  attackInterval: number;
  armor: number;
  pierceArmor: number;
  range: number;
  minRange: number;
  lineOfSight: number;
  blastRadius: number;
  projectileSpeed: number;
  ranged: boolean;
  trample: boolean;
  bonuses: readonly AttackBonus[];
}

export interface Strike {
  attack: number;
  ranged: boolean;
  bonuses: readonly AttackBonus[];
  weakAgainstFortifications: boolean;
}

export interface AutoMemory {
  targetId: EntityId;
  x: number;
  y: number;
  leash: number;
  returning: boolean;
}

const NO_BONUSES: readonly AttackBonus[] = [];

const profiles = new WeakMap<object, CombatProfile>();

const huntingProfiles = new WeakMap<object, CombatProfile>();

function frozenOf(entity: Entity): { id?: JsonValue } | null {
  const frozen = entity.frozenStats;
  if (frozen === null || typeof frozen !== 'object' || Array.isArray(frozen)) {
    return null;
  }
  return frozen.id === entity.type ? frozen : null;
}

export function statsOwnerOf(entity: Entity): PlayerId {
  return entity.statsOwner ?? entity.owner;
}

export function unitStatsOf(state: GameState, entity: Entity, data: GameData): UnitStats | null {
  if (entity.kind !== 'unit' || !data.units[entity.type]) {
    return null;
  }
  const frozen = frozenOf(entity);
  if (frozen) {
    return frozen as unknown as UnitStats;
  }
  return getUnitStats(state, statsOwnerOf(entity), entity.type, data);
}

export function buildingStatsOf(
  state: GameState,
  entity: Entity,
  data: GameData,
): BuildingStats | null {
  if (entity.kind !== 'building' || !data.buildings[entity.type]) {
    return null;
  }
  const frozen = frozenOf(entity);
  if (frozen) {
    return frozen as unknown as BuildingStats;
  }
  return getBuildingStats(state, statsOwnerOf(entity), entity.type, data);
}

function unitProfile(stats: UnitStats): CombatProfile {
  const projectileSpeed = stats.projectileSpeed ?? 0;
  return {
    classes: stats.class,
    hp: stats.hp,
    attack: stats.attack,
    attackInterval: stats.attackInterval,
    armor: stats.armor,
    pierceArmor: stats.pierceArmor,
    range: stats.range,
    minRange: stats.minRange,
    lineOfSight: stats.lineOfSight,
    blastRadius: stats.blastRadius,
    projectileSpeed,
    ranged: stats.attackType === 'ranged' && projectileSpeed > 0,
    trample: stats.trample === true,
    bonuses: stats.bonuses,
  };
}

function buildingProfile(stats: BuildingStats): CombatProfile {
  const projectileSpeed = stats.projectileSpeed ?? 0;
  return {
    classes: stats.class,
    hp: stats.hp,
    attack: stats.attack,
    attackInterval: stats.attackInterval,
    armor: stats.armor,
    pierceArmor: stats.pierceArmor,
    range: stats.range,
    minRange: 0,
    lineOfSight: stats.lineOfSight,
    blastRadius: 0,
    projectileSpeed,
    ranged: projectileSpeed > 0,
    trample: false,
    bonuses: NO_BONUSES,
  };
}

export function combatProfile(
  state: GameState,
  entity: Entity,
  data: GameData,
): CombatProfile | null {
  const unit = unitStatsOf(state, entity, data);
  const stats = unit ?? buildingStatsOf(state, entity, data);
  if (!stats) {
    return null;
  }
  let profile = profiles.get(stats);
  if (!profile) {
    profile = unit ? unitProfile(unit) : buildingProfile(stats as BuildingStats);
    profiles.set(stats, profile);
  }
  return profile;
}

function isHunting(attacker: Entity, targetId: EntityId): boolean {
  const next = attacker.orders[1];
  return next !== undefined && next.type === 'gather' && next.targetId === targetId;
}

function huntingProfile(stats: UnitStats, base: CombatProfile): CombatProfile {
  const hunting = stats.hunting;
  if (!hunting) {
    return base;
  }
  let profile = huntingProfiles.get(stats);
  if (!profile) {
    profile = {
      ...base,
      attack: Math.max(base.attack, hunting.attack),
      range: hunting.range,
      projectileSpeed: hunting.projectileSpeed,
      ranged: true,
    };
    huntingProfiles.set(stats, profile);
  }
  return profile;
}

export function attackProfile(
  state: GameState,
  attacker: Entity,
  targetId: EntityId,
  data: GameData,
): CombatProfile | null {
  const base = combatProfile(state, attacker, data);
  if (!base || !isHunting(attacker, targetId)) {
    return base;
  }
  const stats = unitStatsOf(state, attacker, data);
  return stats ? huntingProfile(stats, base) : base;
}

export function entityHasFlag(
  state: GameState,
  entity: Entity,
  flag: PlayerFlag,
  data: GameData,
): boolean {
  return hasPlayerFlag(state, statsOwnerOf(entity), flag, data);
}

export function stanceToward(state: GameState, from: PlayerId, to: PlayerId): Stance {
  if (from === to) {
    return 'ally';
  }
  const player = state.players[from];
  if (!player || !state.players[to]) {
    return 'neutral';
  }
  return player.diplomacy[to] ?? 'enemy';
}

export function isAttackable(entity: Entity): boolean {
  return (
    (entity.kind === 'unit' || entity.kind === 'building') &&
    entity.hp > 0 &&
    entity.carriedBy === null
  );
}

export function combatDistance(attacker: Entity, target: Entity, data: GameData): number {
  if (attacker.kind === 'building') {
    return Math.max(
      distanceToEntity(target.position, attacker, data) - entityRadius(target, data),
      0,
    );
  }
  return entityDistance(attacker, target, data);
}

export function withinReach(
  attacker: Entity,
  target: Entity,
  profile: CombatProfile,
  data: GameData,
): boolean {
  const gap = combatDistance(attacker, target, data);
  return gap <= profile.range + REACH_SLACK && (profile.minRange <= 0 || gap >= profile.minRange);
}

export function elevationMultiplier(
  state: GameState,
  from: Vec2,
  to: Vec2,
  data: GameData,
): number {
  const attacker = elevationAt(state.map, from);
  const target = elevationAt(state.map, to);
  if (attacker > target) {
    return data.game.elevation.highGroundMultiplier;
  }
  if (attacker < target) {
    return data.game.elevation.lowGroundMultiplier;
  }
  return 1;
}

export function strikeDamage(strike: Strike, defender: CombatProfile, elevation: number): number {
  if (
    strike.weakAgainstFortifications &&
    defender.classes.some((tag) => FORTIFICATION_CLASSES.includes(tag))
  ) {
    return 1;
  }
  let attack = strike.attack;
  let multiplier = elevation;
  for (const bonus of strike.bonuses) {
    if (defender.classes.includes(bonus.targetClass)) {
      attack += bonus.add ?? 0;
      multiplier *= bonus.multiply ?? 1;
    }
  }
  const armor = strike.ranged ? defender.pierceArmor : defender.armor;
  return Math.max(1, Math.round(Math.max(1, attack - armor) * multiplier));
}

export function strikeOf(
  state: GameState,
  attacker: Entity,
  profile: CombatProfile,
  data: GameData,
): Strike {
  return {
    attack: profile.attack,
    ranged: profile.ranged,
    bonuses: profile.bonuses,
    weakAgainstFortifications:
      profile.classes.includes('villager') &&
      !entityHasFlag(state, attacker, 'villagers_damage_walls', data),
  };
}

function raiseAlarm(
  state: GameState,
  target: Entity,
  attackerOwner: PlayerId,
  ctx: StepContext,
): void {
  if (!state.players[target.owner] || attackerOwner === target.owner) {
    return;
  }
  const window = ALERT_SECONDS * ctx.data.game.tickRate;
  const recent = (entity: Entity): boolean =>
    entity.lastAttackedTick >= 0 && state.tick - entity.lastAttackedTick < window;
  if (recent(target)) {
    return;
  }
  let quiet = true;
  forEachEntityNear(state, target.position.x, target.position.y, ALERT_RADIUS, (other) => {
    if (other.owner === target.owner && recent(other)) {
      quiet = false;
    }
  });
  if (!quiet) {
    return;
  }
  ctx.events.push({
    type: 'underAttack',
    playerId: target.owner,
    attackerOwner,
    position: { x: target.position.x, y: target.position.y },
  });
}

export function dealDamage(
  state: GameState,
  target: Entity,
  amount: number,
  ctx: StepContext,
  attackerId: EntityId,
  attackerOwner: PlayerId,
): boolean {
  raiseAlarm(state, target, attackerOwner, ctx);
  return applyDamage(state, target, amount, ctx, attackerId, attackerOwner);
}

export function autoMemoryOf(entity: Entity): AutoMemory | null {
  const memory = entity.scratch[AUTO_KEY];
  return memory ? (memory as unknown as AutoMemory) : null;
}

export function setAutoMemory(entity: Entity, memory: AutoMemory): void {
  entity.scratch[AUTO_KEY] = memory as unknown as JsonValue;
}

export function clearAutoMemory(entity: Entity): void {
  if (AUTO_KEY in entity.scratch) {
    delete entity.scratch[AUTO_KEY];
  }
}

export function releaseAutomation(entity: Entity): void {
  clearAutoMemory(entity);
  entity.anchor = null;
}

function pointAlongPath(start: Vec2, path: readonly Vec2[], travel: number): Vec2 {
  let x = start.x;
  let y = start.y;
  let remaining = travel;
  for (const waypoint of path) {
    const dx = waypoint.x - x;
    const dy = waypoint.y - y;
    const length = Math.hypot(dx, dy);
    if (length >= remaining) {
      if (length > 0) {
        x += (dx / length) * remaining;
        y += (dy / length) * remaining;
      }
      return { x, y };
    }
    x = waypoint.x;
    y = waypoint.y;
    remaining -= length;
  }
  return { x, y };
}

function leadPosition(
  state: GameState,
  shooter: Entity,
  target: Entity,
  projectileSpeed: number,
  data: GameData,
): Vec2 {
  const path = target.path;
  const speed = unitStatsOf(state, target, data)?.speed ?? 0;
  if (!path || path.length === 0 || speed <= 0 || !isMoving(target)) {
    return { x: target.position.x, y: target.position.y };
  }
  let aim: Vec2 = target.position;
  for (let i = 0; i < LEAD_ITERATIONS; i++) {
    const flight = distance(shooter.position, aim) / projectileSpeed;
    aim = pointAlongPath(target.position, path, speed * flight);
  }
  return { x: aim.x, y: aim.y };
}

function launch(
  state: GameState,
  attacker: Entity,
  target: Entity,
  profile: CombatProfile,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const destination = entityHasFlag(state, attacker, 'ballistics', data)
    ? leadPosition(state, attacker, target, profile.projectileSpeed, data)
    : { x: target.position.x, y: target.position.y };
  fire(state, attacker, target.id, destination, profile, ctx);
}

function fire(
  state: GameState,
  attacker: Entity,
  targetId: EntityId | null,
  destination: Vec2,
  profile: CombatProfile,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const flight = distance(attacker.position, destination) / profile.projectileSpeed;
  const id = state.nextProjectileId;
  state.nextProjectileId += 1;
  state.projectiles.push({
    id,
    owner: attacker.owner,
    sourceId: attacker.id,
    sourceType: attacker.type,
    targetId,
    origin: { x: attacker.position.x, y: attacker.position.y },
    destination,
    launchTick: state.tick,
    arriveTick: state.tick + Math.max(1, Math.ceil(flight * data.game.tickRate)),
    damage: profile.attack,
    ranged: true,
    blastRadius: profile.blastRadius,
    friendlyFire: profile.blastRadius > 0,
  });
  ctx.events.push({
    type: 'projectileLaunched',
    sourceId: attacker.id,
    sourceType: attacker.type,
    position: { x: attacker.position.x, y: attacker.position.y },
  });
}

function hit(
  state: GameState,
  attacker: Entity,
  victim: Entity,
  strike: Strike,
  ctx: StepContext,
): void {
  const defender = combatProfile(state, victim, ctx.data);
  if (!defender) {
    return;
  }
  const elevation = elevationMultiplier(state, attacker.position, victim.position, ctx.data);
  dealDamage(
    state,
    victim,
    strikeDamage(strike, defender, elevation),
    ctx,
    attacker.id,
    attacker.owner,
  );
}

function strikeMelee(
  state: GameState,
  attacker: Entity,
  target: Entity,
  profile: CombatProfile,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const strike = strikeOf(state, attacker, profile, data);
  ctx.events.push({
    type: 'attackHit',
    attackerId: attacker.id,
    attackerType: attacker.type,
    targetId: target.id,
    position: { x: target.position.x, y: target.position.y },
  });
  const trampled = profile.trample
    ? entitiesInRadius(
        state,
        attacker.position,
        profile.range + entityRadius(attacker, data) + TRAMPLE_SCAN_MARGIN,
        (other) =>
          other.id !== target.id &&
          other.kind === 'unit' &&
          isAttackable(other) &&
          stanceToward(state, attacker.owner, other.owner) === 'enemy' &&
          inRange(attacker, other, profile.range, data),
      )
    : [];
  hit(state, attacker, target, strike, ctx);
  for (const victim of trampled) {
    hit(state, attacker, victim, strike, ctx);
  }
}

function face(attacker: Entity, point: Vec2): void {
  const dx = point.x - attacker.position.x;
  const dy = point.y - attacker.position.y;
  if (dx !== 0 || dy !== 0) {
    attacker.facing = Math.atan2(dy, dx);
  }
}

function updateAttack(
  state: GameState,
  attacker: Entity,
  targetId: EntityId,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const profile = attackProfile(state, attacker, targetId, data);
  const target = state.entities[targetId];
  if (
    !profile ||
    profile.attack <= 0 ||
    !target ||
    !isAttackable(target) ||
    (attacker.kind === 'building' && attacker.buildProgress !== 1) ||
    stanceToward(state, attacker.owner, target.owner) === 'ally'
  ) {
    completeOrder(attacker);
    return;
  }
  const memory = autoMemoryOf(attacker);
  const automatic = memory !== null && !memory.returning && memory.targetId === target.id;
  if (automatic && distance(target.position, memory) > memory.leash) {
    completeOrder(attacker);
    return;
  }
  const gap = combatDistance(attacker, target, data);
  if (profile.minRange > 0 && gap < profile.minRange) {
    if (automatic) {
      completeOrder(attacker);
      return;
    }
    stopMoving(attacker);
    attacker.state = 'idle';
    attacker.target = target.id;
    return;
  }
  if (gap > profile.range + REACH_SLACK) {
    if (attacker.kind !== 'unit' || (automatic && attacker.standGround)) {
      completeOrder(attacker);
      return;
    }
    if (approach(state, attacker, target, profile.range, data) === 'moving') {
      attacker.state = 'moving';
      attacker.target = target.id;
    } else {
      completeOrder(attacker);
    }
    return;
  }
  attacker.target = target.id;
  if (attacker.kind === 'unit') {
    stopMoving(attacker);
    attacker.state = 'attacking';
    face(attacker, target.position);
  }
  if (attacker.attackCooldown > 0) {
    return;
  }
  attacker.attackCooldown = Math.max(1, Math.round(profile.attackInterval * data.game.tickRate));
  if (profile.ranged) {
    launch(state, attacker, target, profile, ctx);
  } else {
    strikeMelee(state, attacker, target, profile, ctx);
  }
}

function standoffPoint(
  state: GameState,
  shooter: Vec2,
  target: Vec2,
  profile: CombatProfile,
): Vec2 {
  const dx = shooter.x - target.x;
  const dy = shooter.y - target.y;
  const length = Math.hypot(dx, dy);
  const reach = Math.max(profile.range - STANDOFF_MARGIN, profile.minRange);
  const scale = length > 0 ? reach / length : 0;
  return (
    clampTarget(state, { x: target.x + dx * scale, y: target.y + dy * scale }) ?? {
      x: target.x,
      y: target.y,
    }
  );
}

function updateAttackGround(
  state: GameState,
  attacker: Entity,
  order: AttackGroundOrder,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const profile = combatProfile(state, attacker, data);
  if (!profile || profile.attack <= 0 || profile.blastRadius <= 0 || !profile.ranged) {
    completeOrder(attacker);
    return;
  }
  const gap = distance(attacker.position, order.target);
  if (profile.minRange > 0 && gap < profile.minRange) {
    stopMoving(attacker);
    attacker.state = 'idle';
    attacker.target = null;
    return;
  }
  if (gap > profile.range + REACH_SLACK) {
    const nav = navOf(attacker);
    const goal =
      nav && nav.targetId === null && nav.status !== 'done'
        ? nav.goal
        : standoffPoint(state, attacker.position, order.target, profile);
    if (moveToward(state, attacker, goal) === 'moving') {
      attacker.state = 'moving';
      attacker.target = null;
    } else {
      completeOrder(attacker);
    }
    return;
  }
  attacker.target = null;
  stopMoving(attacker);
  attacker.state = 'attacking';
  face(attacker, order.target);
  if (attacker.attackCooldown > 0) {
    return;
  }
  attacker.attackCooldown = Math.max(1, Math.round(profile.attackInterval * data.game.tickRate));
  fire(state, attacker, null, { x: order.target.x, y: order.target.y }, profile, ctx);
}

function clampTarget(state: GameState, target: Vec2): Vec2 | null {
  if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
    return null;
  }
  const limit = state.map.size - 0.01;
  return {
    x: Math.min(limit, Math.max(0, target.x)),
    y: Math.min(limit, Math.max(0, target.y)),
  };
}

function handleAttack(state: GameState, command: CommandOf<'attack'>, ctx: StepContext): void {
  const units = commandableUnits(state, command.playerId, command.entityIds);
  if (units.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const target = state.entities[command.targetId];
  if (
    !target ||
    !isAttackable(target) ||
    stanceToward(state, command.playerId, target.owner) === 'ally'
  ) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const attackers = units.filter(
    (unit) => (combatProfile(state, unit, ctx.data)?.attack ?? 0) > 0,
  );
  if (attackers.length === 0) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  for (const attacker of attackers) {
    releaseAutomation(attacker);
    issueOrder(attacker, { type: 'attack', targetId: target.id }, command.queued);
  }
}

function handleAttackMove(
  state: GameState,
  command: CommandOf<'attackMove'>,
  ctx: StepContext,
): void {
  const units = commandableUnits(state, command.playerId, command.entityIds);
  const target = clampTarget(state, command.target);
  if (units.length === 0 || target === null) {
    rejectCommand(ctx, command, units.length === 0 ? 'not_owner' : 'invalid');
    return;
  }
  const targets = formationTargets(state, ctx.data, units, target);
  for (const unit of units) {
    releaseAutomation(unit);
    issueOrder(unit, { type: 'attackMove', target: targets.get(unit.id) ?? target }, command.queued);
  }
}

function handleAttackGround(
  state: GameState,
  command: CommandOf<'attackGround'>,
  ctx: StepContext,
): void {
  const units = commandableUnits(state, command.playerId, command.entityIds);
  const target = clampTarget(state, command.target);
  if (units.length === 0 || target === null) {
    rejectCommand(ctx, command, units.length === 0 ? 'not_owner' : 'invalid');
    return;
  }
  const siege = units.filter((unit) => {
    const profile = combatProfile(state, unit, ctx.data);
    return profile !== null && profile.attack > 0 && profile.blastRadius > 0 && profile.ranged;
  });
  if (siege.length === 0) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  for (const unit of siege) {
    releaseAutomation(unit);
    issueOrder(unit, { type: 'attackGround', target: { x: target.x, y: target.y } }, command.queued);
  }
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  switch (command.type) {
    case 'attackGround':
      handleAttackGround(state, command, ctx);
      return true;
    case 'attack':
      handleAttack(state, command, ctx);
      return true;
    case 'attackMove':
      handleAttackMove(state, command, ctx);
      return true;
    default:
      return false;
  }
}

function update(state: GameState, ctx: StepContext): void {
  for (const entity of Object.values(state.entities)) {
    if (state.entities[entity.id] !== entity) {
      continue;
    }
    if (entity.attackCooldown > 0) {
      entity.attackCooldown -= 1;
    }
    if (entity.orders.length === 0 || entity.carriedBy !== null) {
      continue;
    }
    const order = entity.orders[0];
    if (order.type === 'attack') {
      updateAttack(state, entity, order.targetId, ctx);
    } else if (order.type === 'attackGround') {
      updateAttackGround(state, entity, order, ctx);
    }
  }
}

export const combatSystem: System = {
  id: 'combat',
  handleCommand,
  update,
};
