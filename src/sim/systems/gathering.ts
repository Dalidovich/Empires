import type { GameData, GatherKind, ResourceKind } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import { removeEntity } from '../core/entities';
import { distanceToEntity } from '../core/geometry';
import { approach } from '../core/movement';
import {
  commandableUnits,
  completeOrder,
  issueOrder,
  rejectCommand,
  resetActivity,
} from '../core/orders';
import { nearestEntity } from '../core/spatial';
import type { StatKey } from '../playerStats';
import { recordStat } from '../playerStats';
import { getBuildingStats, getCarryCapacity, getGatherRate, getUnitStats } from '../stats';
import type { StepContext, System } from '../system';
import type {
  DropOffOrder,
  Entity,
  EntityId,
  GameState,
  GatherOrder,
  JsonValue,
  PlayerId,
} from '../types';
import { ensureFarmStock, farmWorker, isFarm, reseedsAutomatically } from './farms';

const MEMORY_KEY = 'gather';
const GATHER_RANGE = 0;
const DROP_OFF_RANGE = 0;
const CARCASS_SEARCH_RADIUS = 2;
const MAX_RETARGETS = 3;

const VILLAGER_KINDS: readonly GatherKind[] = [
  'forage',
  'farm',
  'wood',
  'stone',
  'gold',
  'hunt',
  'shore_fish',
];

const FISHING_SHIP_KINDS: readonly GatherKind[] = ['boat_fish'];

const GATHERED_STAT: Record<ResourceKind, StatKey> = {
  food: 'foodGathered',
  wood: 'woodGathered',
  stone: 'stoneGathered',
  gold: 'goldGathered',
};

interface GatherMemory {
  targetId: EntityId;
  kind: GatherKind;
  sourceType: string;
  x: number;
  y: number;
  progress: number;
  dropOffId: EntityId | null;
  retargets: number;
}

export interface GatherSource {
  kind: GatherKind;
  resource: ResourceKind;
}

export type DropOffIndex = Map<PlayerId, Entity[]>;

type DropOffLookup = () => DropOffIndex;

export function gatherRate(
  state: GameState,
  playerId: PlayerId,
  kind: GatherKind,
  data: GameData,
): number {
  return getGatherRate(state, playerId, kind, data);
}

export function carryCapacity(
  state: GameState,
  playerId: PlayerId,
  kind: GatherKind,
  data: GameData,
): number {
  return getCarryCapacity(state, playerId, kind, data);
}

function statsOwnerOf(entity: Entity): PlayerId {
  return entity.statsOwner ?? entity.owner;
}

export function gatherKindsOf(state: GameState, unit: Entity, data: GameData): readonly GatherKind[] {
  if (unit.kind !== 'unit' || !data.units[unit.type]) {
    return [];
  }
  const classes = getUnitStats(state, statsOwnerOf(unit), unit.type, data).class;
  if (classes.includes('villager')) {
    return VILLAGER_KINDS;
  }
  if (classes.includes('fishing_ship')) {
    return FISHING_SHIP_KINDS;
  }
  return [];
}

function canGather(state: GameState, unit: Entity, kind: GatherKind, data: GameData): boolean {
  return gatherKindsOf(state, unit, data).includes(kind);
}

export function sourceOf(state: GameState, target: Entity, data: GameData): GatherSource | null {
  if (target.kind === 'resource') {
    const def = data.resourceSources[target.type];
    return def ? { kind: def.gatherKind, resource: def.resource } : null;
  }
  if (isFarm(state, target, data)) {
    return { kind: 'farm', resource: 'food' };
  }
  return null;
}

function isLiveAnimal(target: Entity, data: GameData): boolean {
  return target.kind === 'unit' && data.units[target.type]?.animal !== undefined;
}

export function acceptsDropOff(
  state: GameState,
  building: Entity,
  kind: GatherKind,
  data: GameData,
): boolean {
  if (building.kind !== 'building' || building.buildProgress !== 1 || !data.buildings[building.type]) {
    return false;
  }
  return getBuildingStats(state, building.owner, building.type, data).dropOff.includes(kind);
}

export function indexDropOffs(state: GameState, data: GameData): DropOffIndex {
  const index: DropOffIndex = new Map();
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'building' || entity.buildProgress !== 1 || !data.buildings[entity.type]) {
      continue;
    }
    if (getBuildingStats(state, entity.owner, entity.type, data).dropOff.length === 0) {
      continue;
    }
    const owned = index.get(entity.owner);
    if (owned) {
      owned.push(entity);
    } else {
      index.set(entity.owner, [entity]);
    }
  }
  return index;
}

export function nearestDropOff(
  state: GameState,
  unit: Entity,
  kind: GatherKind,
  data: GameData,
  index: DropOffIndex = indexDropOffs(state, data),
): Entity | null {
  let best: Entity | null = null;
  let bestDistance = Infinity;
  for (const building of index.get(unit.owner) ?? []) {
    if (!acceptsDropOff(state, building, kind, data)) {
      continue;
    }
    const dist = distanceToEntity(unit.position, building, data);
    if (dist < bestDistance) {
      best = building;
      bestDistance = dist;
    }
  }
  return best;
}

export function depositCarry(state: GameState, unit: Entity): number {
  const carry = unit.carry;
  unit.carry = null;
  const player = state.players[unit.owner];
  if (!carry || carry.amount <= 0 || !player) {
    return 0;
  }
  player.resources[carry.resource] += carry.amount;
  const stat = carry.kind === 'trade' ? 'tradeGold' : GATHERED_STAT[carry.resource];
  recordStat(state, unit.owner, stat, carry.amount);
  return carry.amount;
}

function memoryOf(unit: Entity): GatherMemory | null {
  const memory = unit.scratch[MEMORY_KEY];
  return memory ? (memory as unknown as GatherMemory) : null;
}

function forget(unit: Entity): void {
  if (MEMORY_KEY in unit.scratch) {
    delete unit.scratch[MEMORY_KEY];
  }
}

function remember(unit: Entity, target: Entity, kind: GatherKind, sourceType: string): GatherMemory {
  const known = memoryOf(unit);
  if (known && known.targetId === target.id) {
    known.kind = kind;
    known.sourceType = sourceType;
    known.x = target.position.x;
    known.y = target.position.y;
    return known;
  }
  const memory: GatherMemory = {
    targetId: target.id,
    kind,
    sourceType,
    x: target.position.x,
    y: target.position.y,
    progress: 0,
    dropOffId: null,
    retargets: 0,
  };
  unit.scratch[MEMORY_KEY] = memory as unknown as JsonValue;
  return memory;
}

function hasStock(entity: Entity): boolean {
  return (entity.amount ?? 0) >= 1;
}

function findReplacement(
  state: GameState,
  unit: Entity,
  memory: GatherMemory,
  data: GameData,
  excludeId: EntityId | null,
): Entity | null {
  const sight = getUnitStats(state, statsOwnerOf(unit), unit.type, data).lineOfSight;
  if (memory.kind === 'farm') {
    return nearestEntity(
      state,
      unit.position,
      sight,
      (entity) =>
        entity.id !== excludeId &&
        entity.owner === unit.owner &&
        entity.buildProgress === 1 &&
        isFarm(state, entity, data) &&
        (entity.amount === null || hasStock(entity)) &&
        farmWorker(state, entity) === null,
    );
  }
  if (memory.kind === 'hunt') {
    const carcass = nearestEntity(
      state,
      { x: memory.x, y: memory.y },
      CARCASS_SEARCH_RADIUS,
      (entity) =>
        entity.id !== excludeId &&
        entity.kind === 'resource' &&
        entity.type === memory.sourceType &&
        hasStock(entity),
    );
    if (carcass) {
      return carcass;
    }
  }
  const source = nearestEntity(
    state,
    unit.position,
    sight,
    (entity) =>
      entity.id !== excludeId &&
      entity.kind === 'resource' &&
      data.resourceSources[entity.type]?.gatherKind === memory.kind &&
      hasStock(entity),
  );
  if (source || memory.kind !== 'hunt') {
    return source;
  }
  return nearestEntity(
    state,
    unit.position,
    sight,
    (entity) =>
      entity.id !== excludeId &&
      entity.kind === 'unit' &&
      entity.hp > 0 &&
      entity.carriedBy === null &&
      data.units[entity.type]?.animal?.carcass === memory.sourceType,
  );
}

function finishGathering(unit: Entity): void {
  forget(unit);
  if (unit.carry && unit.carry.amount > 0) {
    unit.orders[0] = { type: 'dropOff', targetId: null };
    resetActivity(unit);
    return;
  }
  unit.carry = null;
  completeOrder(unit);
}

function loseSource(
  state: GameState,
  unit: Entity,
  order: GatherOrder,
  data: GameData,
  excludeId: EntityId | null,
): void {
  const memory = memoryOf(unit);
  if (memory && memory.targetId === order.targetId && memory.retargets < MAX_RETARGETS) {
    const next = findReplacement(state, unit, memory, data, excludeId);
    if (next) {
      order.targetId = next.id;
      memory.targetId = next.id;
      memory.retargets += 1;
      memory.dropOffId = null;
      resetActivity(unit);
      return;
    }
  }
  finishGathering(unit);
}

function startHunt(unit: Entity, order: GatherOrder, prey: Entity, data: GameData): void {
  const carcass = data.units[prey.type]?.animal?.carcass ?? '';
  const memory = remember(unit, prey, 'hunt', carcass);
  if (memory.retargets >= MAX_RETARGETS) {
    finishGathering(unit);
    return;
  }
  memory.retargets += 1;
  resetActivity(unit);
  unit.orders.unshift({ type: 'attack', targetId: order.targetId });
}

function trackPrey(state: GameState, unit: Entity, preyId: EntityId): void {
  const next = unit.orders[1];
  const memory = memoryOf(unit);
  if (!memory || !next || next.type !== 'gather' || next.targetId !== preyId) {
    return;
  }
  const prey = state.entities[preyId];
  if (prey && memory.targetId === preyId) {
    memory.x = prey.position.x;
    memory.y = prey.position.y;
  }
}

function resolveDropOff(
  state: GameState,
  unit: Entity,
  memory: GatherMemory,
  kind: GatherKind,
  data: GameData,
  dropOffs: DropOffLookup,
): Entity | null {
  const cached = memory.dropOffId !== null ? state.entities[memory.dropOffId] : undefined;
  if (cached && cached.owner === unit.owner && acceptsDropOff(state, cached, kind, data)) {
    return cached;
  }
  const found = nearestDropOff(state, unit, kind, data, dropOffs());
  memory.dropOffId = found ? found.id : null;
  return found;
}

function harvest(
  state: GameState,
  unit: Entity,
  target: Entity,
  source: GatherSource,
  memory: GatherMemory,
  capacity: number,
  ctx: StepContext,
): void {
  if (!unit.carry || unit.carry.kind !== source.kind) {
    unit.carry = { kind: source.kind, resource: source.resource, amount: 0 };
  }
  const carry = unit.carry;
  const rate = gatherRate(state, statsOwnerOf(unit), source.kind, ctx.data);
  memory.progress += rate / ctx.data.game.tickRate;
  let struck = false;
  while (memory.progress >= 1 && carry.amount < capacity && hasStock(target)) {
    memory.progress -= 1;
    carry.amount += 1;
    target.amount = (target.amount ?? 0) - 1;
    struck = true;
  }
  if (struck) {
    memory.retargets = 0;
    ctx.events.push({
      type: 'gatherStrike',
      entityId: unit.id,
      gatherKind: source.kind,
      position: { x: target.position.x, y: target.position.y },
    });
  }
  if (!hasStock(target) && target.kind === 'resource') {
    unit.target = null;
    removeEntity(state, target.id, ctx.data);
  }
}

function haul(
  state: GameState,
  unit: Entity,
  source: GatherSource,
  memory: GatherMemory,
  ctx: StepContext,
  dropOffs: DropOffLookup,
): void {
  const carry = unit.carry;
  if (!carry) {
    return;
  }
  const dropOff = resolveDropOff(state, unit, memory, carry.kind, ctx.data, dropOffs);
  if (!dropOff) {
    if (carry.kind !== source.kind) {
      unit.carry = null;
      return;
    }
    forget(unit);
    completeOrder(unit);
    return;
  }
  const status = approach(state, unit, dropOff, DROP_OFF_RANGE, ctx.data);
  if (status === 'moving') {
    unit.state = 'returning';
    unit.target = dropOff.id;
    return;
  }
  if (status === 'unreachable') {
    forget(unit);
    completeOrder(unit);
    return;
  }
  depositCarry(state, unit);
  memory.dropOffId = null;
}

function awaitReseed(
  state: GameState,
  unit: Entity,
  farm: Entity,
  source: GatherSource,
  memory: GatherMemory,
  ctx: StepContext,
  dropOffs: DropOffLookup,
): void {
  if (unit.carry && unit.carry.amount > 0) {
    haul(state, unit, source, memory, ctx, dropOffs);
    return;
  }
  unit.target = farm.id;
  unit.state = approach(state, unit, farm, GATHER_RANGE, ctx.data) === 'moving' ? 'moving' : 'idle';
}

function updateGather(
  state: GameState,
  unit: Entity,
  order: GatherOrder,
  ctx: StepContext,
  dropOffs: DropOffLookup,
): void {
  const data = ctx.data;
  const target = state.entities[order.targetId];
  if (!target) {
    loseSource(state, unit, order, data, null);
    return;
  }
  if (isLiveAnimal(target, data)) {
    if (canGather(state, unit, 'hunt', data)) {
      startHunt(unit, order, target, data);
    } else {
      finishGathering(unit);
    }
    return;
  }
  const source = sourceOf(state, target, data);
  if (!source || !canGather(state, unit, source.kind, data)) {
    finishGathering(unit);
    return;
  }
  const memory = remember(unit, target, source.kind, target.type);
  if (target.kind === 'building') {
    if (target.owner !== unit.owner || target.buildProgress !== 1) {
      finishGathering(unit);
      return;
    }
    ensureFarmStock(state, target, data);
    const worker = farmWorker(state, target);
    if (worker !== null && worker !== unit.id) {
      loseSource(state, unit, order, data, target.id);
      return;
    }
    if (target.workers.length !== 1 || target.workers[0] !== unit.id) {
      target.workers = [unit.id];
    }
  }
  if (!hasStock(target)) {
    if (target.kind === 'building' && reseedsAutomatically(state, target)) {
      awaitReseed(state, unit, target, source, memory, ctx, dropOffs);
      return;
    }
    if (target.kind === 'resource') {
      removeEntity(state, target.id, data);
    }
    loseSource(state, unit, order, data, target.id);
    return;
  }
  const capacity = Math.max(1, carryCapacity(state, statsOwnerOf(unit), source.kind, data));
  const carry = unit.carry;
  if (carry && carry.amount > 0 && (carry.kind !== source.kind || carry.amount >= capacity)) {
    haul(state, unit, source, memory, ctx, dropOffs);
    return;
  }
  const status = approach(state, unit, target, GATHER_RANGE, data);
  if (status === 'moving') {
    unit.state = 'moving';
    unit.target = target.id;
    return;
  }
  if (status === 'unreachable') {
    loseSource(state, unit, order, data, target.id);
    return;
  }
  unit.state = 'gathering';
  unit.target = target.id;
  harvest(state, unit, target, source, memory, capacity, ctx);
}

function updateDropOff(
  state: GameState,
  unit: Entity,
  order: DropOffOrder,
  ctx: StepContext,
  dropOffs: DropOffLookup,
): void {
  const carry = unit.carry;
  if (!carry || carry.amount <= 0) {
    unit.carry = null;
    completeOrder(unit);
    return;
  }
  const chosen = order.targetId !== null ? state.entities[order.targetId] : undefined;
  let dropOff: Entity | null;
  if (chosen && chosen.owner === unit.owner && acceptsDropOff(state, chosen, carry.kind, ctx.data)) {
    dropOff = chosen;
  } else {
    dropOff = nearestDropOff(state, unit, carry.kind, ctx.data, dropOffs());
    order.targetId = dropOff ? dropOff.id : null;
  }
  if (!dropOff) {
    completeOrder(unit);
    return;
  }
  const status = approach(state, unit, dropOff, DROP_OFF_RANGE, ctx.data);
  if (status === 'moving') {
    unit.state = 'returning';
    unit.target = dropOff.id;
    return;
  }
  if (status === 'arrived') {
    depositCarry(state, unit);
  }
  completeOrder(unit);
}

function handleGather(state: GameState, command: CommandOf<'gather'>, ctx: StepContext): void {
  const data = ctx.data;
  const units = commandableUnits(state, command.playerId, command.entityIds);
  if (units.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const target = state.entities[command.targetId];
  if (!target || target.carriedBy !== null) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  if (isLiveAnimal(target, data)) {
    const hunters = units.filter((unit) => canGather(state, unit, 'hunt', data));
    if (hunters.length === 0) {
      rejectCommand(ctx, command, 'invalid');
      return;
    }
    for (const hunter of hunters) {
      issueOrder(hunter, { type: 'gather', targetId: target.id }, command.queued);
    }
    return;
  }
  const source = sourceOf(state, target, data);
  if (source && target.kind === 'building') {
    const farmer = units.find((unit) => canGather(state, unit, 'farm', data));
    if (!farmer || target.owner !== command.playerId) {
      rejectCommand(ctx, command, 'invalid');
      return;
    }
    const worker = farmWorker(state, target);
    if (worker !== null && worker !== farmer.id) {
      rejectCommand(ctx, command, 'busy');
      return;
    }
    if (target.buildProgress !== 1) {
      issueOrder(farmer, { type: 'build', targetId: target.id }, command.queued);
      issueOrder(farmer, { type: 'gather', targetId: target.id }, true);
      return;
    }
    issueOrder(farmer, { type: 'gather', targetId: target.id }, command.queued);
    return;
  }
  if (source) {
    const gatherers = units.filter((unit) => canGather(state, unit, source.kind, data));
    if (gatherers.length === 0) {
      rejectCommand(ctx, command, 'invalid');
      return;
    }
    for (const gatherer of gatherers) {
      issueOrder(gatherer, { type: 'gather', targetId: target.id }, command.queued);
    }
    return;
  }
  if (target.owner === command.playerId) {
    const carriers = units.filter(
      (unit) =>
        unit.carry !== null &&
        unit.carry.amount > 0 &&
        acceptsDropOff(state, target, unit.carry.kind, data),
    );
    if (carriers.length > 0) {
      for (const carrier of carriers) {
        issueOrder(carrier, { type: 'dropOff', targetId: target.id }, command.queued);
      }
      return;
    }
  }
  rejectCommand(ctx, command, 'invalid');
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  if (command.type !== 'gather') {
    return false;
  }
  handleGather(state, command, ctx);
  return true;
}

function update(state: GameState, ctx: StepContext): void {
  let index: DropOffIndex | null = null;
  const dropOffs: DropOffLookup = () => {
    if (index === null) {
      index = indexDropOffs(state, ctx.data);
    }
    return index;
  };
  for (const unit of Object.values(state.entities)) {
    if (unit.orders.length === 0 || unit.carriedBy !== null || state.entities[unit.id] !== unit) {
      continue;
    }
    const order = unit.orders[0];
    switch (order.type) {
      case 'gather':
        updateGather(state, unit, order, ctx, dropOffs);
        break;
      case 'dropOff':
        updateDropOff(state, unit, order, ctx, dropOffs);
        break;
      case 'attack':
        trackPrey(state, unit, order.targetId);
        break;
      default:
        break;
    }
  }
}

export const gatheringSystem: System = {
  id: 'gathering',
  handleCommand,
  update,
};
