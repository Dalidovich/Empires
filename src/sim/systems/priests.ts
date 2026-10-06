import type { GameData } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import { distance, inRange } from '../core/geometry';
import { approach } from '../core/movement';
import {
  clearOrders,
  commandableUnits,
  completeOrder,
  issueOrder,
  rejectCommand,
} from '../core/orders';
import { recordStat } from '../playerStats';
import { chance } from '../rng';
import { nearestEntity } from '../core/spatial';
import type { ConversionParams, UnitStats } from '../stats';
import { getConversionParams } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, EntityId, GameState, JsonValue, Order, PlayerId, Vec2 } from '../types';
import {
  buildingStatsOf,
  entityHasFlag,
  isAttackable,
  releaseAutomation,
  stanceToward,
  statsOwnerOf,
  unitStatsOf,
} from './combat';

const CONVERT_KEY = 'convert';
const HEAL_KEY = 'heal';
const UNHEALABLE_CLASSES: readonly string[] = ['ship', 'machine'];
const UNCONVERTIBLE_CLASSES: readonly string[] = ['town_center', 'wonder', 'wall', 'tower'];

const AUTO_KEY = 'autoPriest';
const SCAN_INTERVAL = 5;
const CHASE_MARGIN = 3;
const RETURN_TOLERANCE = 1;

interface AutoMemory {
  targetId: EntityId;
  x: number;
  y: number;
  returning: boolean;
}

interface ConvertMemory {
  targetId: EntityId;
  attempts: number;
}

export function isPriest(state: GameState, entity: Entity, data: GameData): boolean {
  return unitStatsOf(state, entity, data)?.class.includes('priest') ?? false;
}

export function canHeal(state: GameState, priest: Entity, target: Entity, data: GameData): boolean {
  const stats = unitStatsOf(state, target, data);
  return (
    stats !== null &&
    target.id !== priest.id &&
    isAttackable(target) &&
    stanceToward(state, priest.owner, target.owner) === 'ally' &&
    !stats.class.some((tag) => UNHEALABLE_CLASSES.includes(tag))
  );
}

export function canConvert(
  state: GameState,
  priest: Entity,
  target: Entity,
  data: GameData,
): boolean {
  if (
    !isAttackable(target) ||
    !state.players[target.owner] ||
    stanceToward(state, priest.owner, target.owner) === 'ally'
  ) {
    return false;
  }
  const unit = unitStatsOf(state, target, data);
  if (unit) {
    return !unit.class.includes('priest') || entityHasFlag(state, priest, 'convert_priests', data);
  }
  const building = buildingStatsOf(state, target, data);
  if (
    !building ||
    building.convertible === false ||
    building.class.some((tag) => UNCONVERTIBLE_CLASSES.includes(tag))
  ) {
    return false;
  }
  return entityHasFlag(state, priest, 'convert_buildings', data);
}

export function conversionChance(
  state: GameState,
  priest: Entity,
  target: Entity,
  data: GameData,
): number {
  const params = getConversionParams(state, statsOwnerOf(priest), data);
  const resistance = unitStatsOf(state, target, data)?.conversionResistance ?? 1;
  return params.chance / Math.max(1, resistance);
}

export function convertEntity(
  state: GameState,
  entity: Entity,
  owner: PlayerId,
  data: GameData,
): void {
  const stats = unitStatsOf(state, entity, data) ?? buildingStatsOf(state, entity, data);
  if (entity.frozenStats === null && stats) {
    entity.frozenStats = JSON.parse(JSON.stringify(stats)) as JsonValue;
  }
  entity.statsOwner = statsOwnerOf(entity);
  entity.owner = owner;
  clearOrders(entity);
  if (AUTO_KEY in entity.scratch) {
    delete entity.scratch[AUTO_KEY];
  }
  releaseAutomation(entity);
  entity.queue = [];
  entity.research = null;
  entity.rallyPoint = null;
  entity.workers = [];
  if (entity.kind === 'building' && entity.state === 'producing') {
    entity.state = 'idle';
  }
  for (const cargoId of entity.cargo) {
    const carried = state.entities[cargoId];
    if (carried) {
      convertEntity(state, carried, owner, data);
    }
  }
}

function convertMemoryOf(priest: Entity, targetId: EntityId): ConvertMemory {
  const stored = priest.scratch[CONVERT_KEY];
  if (stored) {
    const memory = stored as unknown as ConvertMemory;
    if (memory.targetId === targetId) {
      return memory;
    }
  }
  const memory: ConvertMemory = { targetId, attempts: 0 };
  priest.scratch[CONVERT_KEY] = memory as unknown as JsonValue;
  priest.conversionProgress = 0;
  return memory;
}

function endConversion(priest: Entity): void {
  if (CONVERT_KEY in priest.scratch) {
    delete priest.scratch[CONVERT_KEY];
  }
  priest.conversionProgress = 0;
  completeOrder(priest);
}

function endHealing(priest: Entity): void {
  if (HEAL_KEY in priest.scratch) {
    delete priest.scratch[HEAL_KEY];
  }
  completeOrder(priest);
}

function succeed(state: GameState, priest: Entity, target: Entity, ctx: StepContext): void {
  const previousOwner = target.owner;
  priest.faith = 0;
  convertEntity(state, target, priest.owner, ctx.data);
  recordStat(state, priest.owner, 'conversions', 1);
  ctx.events.push({
    type: 'unitConverted',
    entityId: target.id,
    fromPlayerId: previousOwner,
    toPlayerId: priest.owner,
    position: { x: target.position.x, y: target.position.y },
  });
  endConversion(priest);
}

function updateConvert(
  state: GameState,
  priest: Entity,
  targetId: EntityId,
  params: ConversionParams,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const stats = unitStatsOf(state, priest, data);
  const target = state.entities[targetId];
  if (!stats || !stats.class.includes('priest') || !target || !canConvert(state, priest, target, data)) {
    endConversion(priest);
    return;
  }
  const memory = convertMemoryOf(priest, target.id);
  const status = approach(state, priest, target, stats.range, data);
  if (status === 'unreachable') {
    endConversion(priest);
    return;
  }
  priest.target = target.id;
  if (status === 'moving') {
    priest.state = 'moving';
    return;
  }
  if ((priest.faith ?? params.faithMax) < params.faithMax) {
    priest.state = 'idle';
    priest.conversionProgress = 0;
    return;
  }
  priest.state = 'converting';
  priest.conversionProgress += 1;
  const attemptTicks = Math.max(1, Math.round(params.attemptInterval * data.game.tickRate));
  if (priest.conversionProgress < attemptTicks) {
    return;
  }
  priest.conversionProgress = 0;
  memory.attempts += 1;
  if (memory.attempts <= params.guaranteedFailures) {
    return;
  }
  if (chance(state, conversionChance(state, priest, target, data))) {
    succeed(state, priest, target, ctx);
  }
}

function updateHeal(state: GameState, priest: Entity, targetId: EntityId, ctx: StepContext): void {
  const data = ctx.data;
  const stats = unitStatsOf(state, priest, data);
  const target = state.entities[targetId];
  const rate = stats?.healRate ?? 0;
  if (!stats || rate <= 0 || !target || !canHeal(state, priest, target, data)) {
    endHealing(priest);
    return;
  }
  const maxHp = unitStatsOf(state, target, data)?.hp ?? target.hp;
  if (target.hp >= maxHp) {
    endHealing(priest);
    return;
  }
  const status = approach(state, priest, target, stats.range, data);
  if (status === 'unreachable') {
    endHealing(priest);
    return;
  }
  priest.target = target.id;
  if (status === 'moving') {
    priest.state = 'moving';
    return;
  }
  priest.state = 'healing';
  const stored = priest.scratch[HEAL_KEY];
  const progress = (typeof stored === 'number' ? stored : 0) + rate / data.game.tickRate;
  const restored = Math.floor(progress);
  priest.scratch[HEAL_KEY] = progress - restored;
  if (restored > 0) {
    target.hp = Math.min(maxHp, target.hp + restored);
  }
}

function rechargeFaith(priest: Entity, params: ConversionParams, tickRate: number): void {
  if (priest.faith === null) {
    priest.faith = params.faithMax;
  } else if (priest.faith < params.faithMax) {
    priest.faith = Math.min(params.faithMax, priest.faith + params.faithRechargeRate / tickRate);
  }
}

function autoMemoryOf(priest: Entity): AutoMemory | null {
  const stored = priest.scratch[AUTO_KEY];
  if (!stored) {
    return null;
  }
  const memory = stored as unknown as AutoMemory;
  if (priest.orders.length === 0) {
    return memory;
  }
  const order = priest.orders[0];
  const kept = memory.returning
    ? order.type === 'move' && order.target.x === memory.x && order.target.y === memory.y
    : (order.type === 'heal' || order.type === 'convert') && order.targetId === memory.targetId;
  if (kept) {
    return memory;
  }
  delete priest.scratch[AUTO_KEY];
  return null;
}

function hasStrayed(
  state: GameState,
  priest: Entity,
  memory: AutoMemory,
  data: GameData,
): boolean {
  const stats = unitStatsOf(state, priest, data);
  const target = state.entities[memory.targetId];
  if (!stats || !target) {
    return false;
  }
  if (priest.standGround) {
    return !inRange(priest, target, stats.range, data);
  }
  return distance(target.position, memory) > stats.lineOfSight + CHASE_MARGIN;
}

function findAutoOrder(
  state: GameState,
  priest: Entity,
  stats: UnitStats,
  home: Vec2,
  params: ConversionParams,
  data: GameData,
): Order | null {
  const leash = stats.lineOfSight + CHASE_MARGIN;
  const reachable = (other: Entity): boolean =>
    priest.standGround
      ? inRange(priest, other, stats.range, data)
      : distance(other.position, home) <= leash;
  if ((priest.faith ?? params.faithMax) >= params.faithMax) {
    const enemy = nearestEntity(
      state,
      priest.position,
      stats.lineOfSight,
      (other) =>
        other.kind === 'unit' &&
        stanceToward(state, priest.owner, other.owner) === 'enemy' &&
        canConvert(state, priest, other, data) &&
        reachable(other),
    );
    if (enemy) {
      return { type: 'convert', targetId: enemy.id };
    }
  }
  if ((stats.healRate ?? 0) <= 0) {
    return null;
  }
  const wounded = nearestEntity(
    state,
    priest.position,
    stats.lineOfSight,
    (other) =>
      canHeal(state, priest, other, data) &&
      other.hp < (unitStatsOf(state, other, data)?.hp ?? other.hp) &&
      reachable(other),
  );
  return wounded ? { type: 'heal', targetId: wounded.id } : null;
}

function actOnOwn(
  state: GameState,
  priest: Entity,
  memory: AutoMemory | null,
  params: ConversionParams,
  data: GameData,
): void {
  const stats = unitStatsOf(state, priest, data);
  if (!stats) {
    return;
  }
  const home: Vec2 = memory
    ? { x: memory.x, y: memory.y }
    : { x: priest.position.x, y: priest.position.y };
  const order = findAutoOrder(state, priest, stats, home, params, data);
  if (order && (order.type === 'heal' || order.type === 'convert')) {
    issueOrder(priest, order, false);
    const next: AutoMemory = { targetId: order.targetId, x: home.x, y: home.y, returning: false };
    priest.scratch[AUTO_KEY] = next as unknown as JsonValue;
    return;
  }
  if (!memory || priest.orders.length > 0) {
    return;
  }
  if (memory.returning || priest.standGround || distance(priest.position, home) <= RETURN_TOLERANCE) {
    delete priest.scratch[AUTO_KEY];
    return;
  }
  issueOrder(priest, { type: 'move', target: home }, false);
  memory.targetId = 0;
  memory.returning = true;
}

function handleHeal(state: GameState, command: CommandOf<'heal'>, ctx: StepContext): void {
  const units = commandableUnits(state, command.playerId, command.entityIds);
  if (units.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const target = state.entities[command.targetId];
  const healers = target
    ? units.filter(
        (unit) => isPriest(state, unit, ctx.data) && canHeal(state, unit, target, ctx.data),
      )
    : [];
  if (!target || healers.length === 0) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  for (const healer of healers) {
    issueOrder(healer, { type: 'heal', targetId: target.id }, command.queued);
  }
}

function handleConvert(state: GameState, command: CommandOf<'convert'>, ctx: StepContext): void {
  const units = commandableUnits(state, command.playerId, command.entityIds);
  if (units.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const target = state.entities[command.targetId];
  const priests = units.filter((unit) => isPriest(state, unit, ctx.data));
  if (!target || priests.length === 0) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const converters = priests.filter((priest) => canConvert(state, priest, target, ctx.data));
  if (converters.length === 0) {
    rejectCommand(ctx, command, isAttackable(target) ? 'unavailable' : 'invalid');
    return;
  }
  for (const converter of converters) {
    issueOrder(converter, { type: 'convert', targetId: target.id }, command.queued);
  }
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  switch (command.type) {
    case 'heal':
      handleHeal(state, command, ctx);
      return true;
    case 'convert':
      handleConvert(state, command, ctx);
      return true;
    default:
      return false;
  }
}

function update(state: GameState, ctx: StepContext): void {
  const data = ctx.data;
  const tickRate = data.game.tickRate;
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'unit' || !data.units[entity.type]?.class.includes('priest')) {
      continue;
    }
    const params = getConversionParams(state, statsOwnerOf(entity), data);
    rechargeFaith(entity, params, tickRate);
    if (entity.carriedBy !== null) {
      continue;
    }
    const memory = autoMemoryOf(entity);
    if (entity.orders.length === 0 || memory?.returning === true) {
      if (
        state.players[entity.owner]?.kind === 'human' &&
        (state.tick + entity.id) % SCAN_INTERVAL === 0
      ) {
        actOnOwn(state, entity, memory, params, data);
      }
      continue;
    }
    const order = entity.orders[0];
    if (memory && hasStrayed(state, entity, memory, data)) {
      if (order.type === 'convert') {
        endConversion(entity);
      } else {
        endHealing(entity);
      }
    } else if (order.type === 'convert') {
      updateConvert(state, entity, order.targetId, params, ctx);
    } else if (order.type === 'heal') {
      updateHeal(state, entity, order.targetId, ctx);
    }
  }
}

export const priestsSystem: System = {
  id: 'priests',
  handleCommand,
  update,
};
