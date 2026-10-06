import { loadGameData } from '../../data';
import type { BuildingDef, Cost, GameData, MovementDomain, ResourceKind } from '../../data/types';
import { RESOURCE_KINDS } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import { footprintCenter, inBounds, killEntity, spawnEntity, tileIndex } from '../core/entities';
import { approach } from '../core/movement';
import { domainOf, terrainPassable } from '../core/navgrid';
import { commandableUnits, completeOrder, issueOrder, rejectCommand } from '../core/orders';
import { nearestPassablePoint } from '../core/pathfinding';
import { entitiesInRadius, setEntityPosition } from '../core/spatial';
import {
  buildingBlockReason,
  missingResource,
  ownedBuildings,
  payCost,
  refundCost,
  resolveBuildingType,
} from '../effects/availability';
import { recordStat } from '../playerStats';
import { getBuildingStats, getEntityMaxHp, getUnitStats } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, EntityId, GameState, JsonValue, Player, PlayerId, TileCoord } from '../types';
import { TERRAIN, TILE_FREE } from '../types';

const WORK_RANGE = 0;
const REPAIR_COST_FACTOR = 0.5;
const REPAIR_DEBT_KEY = 'repairDebt';
const MAX_WALL_TILES = 256;
const COMPLETE_EPSILON = 1e-9;

type RepairDebt = Partial<Record<ResourceKind, number>>;

export function builderSpeed(builders: number): number {
  return builders <= 0 ? 0 : (builders + 2) / 3;
}

function isWater(terrain: number): boolean {
  return terrain === TERRAIN.deepWater || terrain === TERRAIN.shallows;
}

function ringHasTerrain(state: GameState, tile: TileCoord, size: number, domain: MovementDomain): boolean {
  const map = state.map;
  for (let y = tile.y - 1; y <= tile.y + size; y++) {
    for (let x = tile.x - 1; x <= tile.x + size; x++) {
      const inside = x >= tile.x && x < tile.x + size && y >= tile.y && y < tile.y + size;
      if (inside || !inBounds(map, x, y)) {
        continue;
      }
      const index = tileIndex(map, x, y);
      if (map.occupancy[index] === TILE_FREE && terrainPassable(domain, map.terrain[index])) {
        return true;
      }
    }
  }
  return false;
}

function insideFootprint(entity: Entity, tile: TileCoord, size: number): boolean {
  return (
    entity.position.x >= tile.x &&
    entity.position.x < tile.x + size &&
    entity.position.y >= tile.y &&
    entity.position.y < tile.y + size
  );
}

function occupantsOf(state: GameState, tile: TileCoord, size: number): Entity[] {
  const center = footprintCenter(tile, size);
  return entitiesInRadius(
    state,
    center,
    size,
    (entity) => entity.carriedBy === null && insideFootprint(entity, tile, size),
  );
}

export function canPlace(
  state: GameState,
  playerId: PlayerId,
  buildingId: string,
  tile: TileCoord,
  data: GameData = loadGameData(),
): boolean {
  const def = data.buildings[buildingId];
  const player = state.players[playerId];
  if (!def || !player || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
    return false;
  }
  const map = state.map;
  let touchesShore = false;
  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (!inBounds(map, x, y)) {
        return false;
      }
      const index = tileIndex(map, x, y);
      if (player.explored[index] !== 1 || map.occupancy[index] !== TILE_FREE) {
        return false;
      }
      const terrain = map.terrain[index];
      if (terrain === TERRAIN.cliff) {
        return false;
      }
      if (def.placement === 'land') {
        if (isWater(terrain)) {
          return false;
        }
      } else if (isWater(terrain) || terrain === TERRAIN.shore) {
        touchesShore = true;
      }
    }
  }
  if (occupantsOf(state, tile, def.size).some((entity) => entity.kind !== 'unit')) {
    return false;
  }
  if (def.placement === 'land') {
    return true;
  }
  return (
    touchesShore &&
    ringHasTerrain(state, tile, def.size, 'water') &&
    ringHasTerrain(state, tile, def.size, 'land')
  );
}

function isBuilder(state: GameState, unit: Entity, data: GameData): boolean {
  if (!data.units[unit.type]) {
    return false;
  }
  return getUnitStats(state, unit.statsOwner ?? unit.owner, unit.type, data).class.includes('villager');
}

function buildersOf(state: GameState, playerId: PlayerId, ids: readonly EntityId[], data: GameData): Entity[] {
  return commandableUnits(state, playerId, ids).filter((unit) => isBuilder(state, unit, data));
}

function displaceUnits(state: GameState, foundation: Entity, def: BuildingDef, tile: TileCoord, data: GameData): void {
  if (def.class.includes('farm')) {
    return;
  }
  for (const unit of occupantsOf(state, tile, def.size)) {
    if (unit.kind !== 'unit' || unit.id === foundation.id) {
      continue;
    }
    const spot = nearestPassablePoint(state, data, domainOf(unit, data), unit.position);
    if (spot) {
      setEntityPosition(state, unit, spot.x, spot.y);
    }
  }
}

function placeFoundation(
  state: GameState,
  player: Player,
  def: BuildingDef,
  tile: TileCoord,
  cost: Cost,
  ctx: StepContext,
): Entity {
  payCost(player, cost);
  const foundation = spawnEntity(
    state,
    {
      kind: 'building',
      type: def.id,
      owner: player.id,
      position: footprintCenter(tile, def.size),
      buildProgress: 0,
      hp: 1,
    },
    ctx.data,
  );
  foundation.paid = { ...cost };
  displaceUnits(state, foundation, def, tile, ctx.data);
  ctx.events.push({
    type: 'buildingPlaced',
    playerId: player.id,
    buildingId: foundation.id,
    buildingType: foundation.type,
    position: { x: foundation.position.x, y: foundation.position.y },
  });
  return foundation;
}

function reportShortage(ctx: StepContext, command: Command, resource: ResourceKind): void {
  ctx.events.push({ type: 'insufficientResources', playerId: command.playerId, resource });
  rejectCommand(ctx, command, 'resources');
}

function handlePlaceBuilding(
  state: GameState,
  command: CommandOf<'placeBuilding'>,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const player = state.players[command.playerId];
  const builders = buildersOf(state, command.playerId, command.entityIds, data);
  if (!player || builders.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const type = resolveBuildingType(player, command.building, data);
  const def = data.buildings[type];
  if (!def) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const blocked = buildingBlockReason(player, type, ownedBuildings(state, player.id), data);
  if (blocked !== null) {
    rejectCommand(ctx, command, blocked);
    return;
  }
  if (!canPlace(state, player.id, type, command.tile, data)) {
    rejectCommand(ctx, command, 'placement');
    return;
  }
  const cost = getBuildingStats(state, player.id, type, data).cost;
  const lacking = missingResource(player, cost);
  if (lacking !== null) {
    reportShortage(ctx, command, lacking);
    return;
  }
  const foundation = placeFoundation(state, player, def, command.tile, cost, ctx);
  for (const builder of builders) {
    issueOrder(builder, { type: 'build', targetId: foundation.id }, command.queued);
  }
}

export function wallLine(from: TileCoord, to: TileCoord): TileCoord[] {
  const tiles: TileCoord[] = [];
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = dx - dy;
  let x = from.x;
  let y = from.y;
  while (tiles.length < MAX_WALL_TILES) {
    tiles.push({ x, y });
    if (x === to.x && y === to.y) {
      break;
    }
    const doubled = 2 * error;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
  }
  return tiles;
}

function isTile(tile: TileCoord): boolean {
  return Number.isInteger(tile.x) && Number.isInteger(tile.y);
}

function handlePlaceWall(state: GameState, command: CommandOf<'placeWall'>, ctx: StepContext): void {
  const data = ctx.data;
  const player = state.players[command.playerId];
  const builders = buildersOf(state, command.playerId, command.entityIds, data);
  if (!player || builders.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const type = resolveBuildingType(player, command.building, data);
  const def = data.buildings[type];
  if (!def || !def.class.includes('wall') || !isTile(command.from) || !isTile(command.to)) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const blocked = buildingBlockReason(player, type, ownedBuildings(state, player.id), data);
  if (blocked !== null) {
    rejectCommand(ctx, command, blocked);
    return;
  }
  const cost = getBuildingStats(state, player.id, type, data).cost;
  const placed: Entity[] = [];
  let lacking: ResourceKind | null = null;
  for (const tile of wallLine(command.from, command.to)) {
    if (!canPlace(state, player.id, type, tile, data)) {
      continue;
    }
    lacking = missingResource(player, cost);
    if (lacking !== null) {
      break;
    }
    placed.push(placeFoundation(state, player, def, tile, cost, ctx));
  }
  if (placed.length === 0) {
    if (lacking !== null) {
      reportShortage(ctx, command, lacking);
    } else {
      rejectCommand(ctx, command, 'placement');
    }
    return;
  }
  for (const builder of builders) {
    placed.forEach((segment, index) => {
      issueOrder(builder, { type: 'build', targetId: segment.id }, command.queued || index > 0);
    });
  }
}

function isShip(state: GameState, entity: Entity, data: GameData): boolean {
  if (entity.kind !== 'unit' || !data.units[entity.type]) {
    return false;
  }
  return getUnitStats(state, entity.statsOwner ?? entity.owner, entity.type, data).class.includes('ship');
}

function isFoundation(entity: Entity): boolean {
  return entity.kind === 'building' && entity.buildProgress !== null && entity.buildProgress < 1;
}

function isRepairable(state: GameState, target: Entity, data: GameData): boolean {
  if (target.kind === 'building') {
    return target.buildProgress === 1 && data.buildings[target.type] !== undefined;
  }
  return isShip(state, target, data);
}

function handleWorkCommand(
  state: GameState,
  command: CommandOf<'build'> | CommandOf<'repair'>,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const builders = buildersOf(state, command.playerId, command.entityIds, data);
  if (builders.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const target = state.entities[command.targetId];
  if (!target || target.owner !== command.playerId || target.carriedBy !== null) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  if (isFoundation(target)) {
    for (const builder of builders) {
      issueOrder(builder, { type: 'build', targetId: target.id }, command.queued);
    }
    return;
  }
  if (!isRepairable(state, target, data) || target.hp >= getEntityMaxHp(state, target, data)) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  for (const builder of builders) {
    if (builder.id !== target.id) {
      issueOrder(builder, { type: 'repair', targetId: target.id }, command.queued);
    }
  }
}

function refundBuilding(player: Player | undefined, building: Entity): void {
  if (isFoundation(building)) {
    refundCost(player, building.paid);
  }
  for (const item of building.queue) {
    refundCost(player, item.paid);
  }
  if (building.research) {
    refundCost(player, building.research.paid);
  }
}

function handleDelete(state: GameState, command: CommandOf<'delete'>, ctx: StepContext): void {
  const ids = [...new Set(command.entityIds)].sort((a, b) => a - b);
  let removed = false;
  for (const id of ids) {
    const entity = state.entities[id];
    if (!entity || entity.owner !== command.playerId) {
      continue;
    }
    if (entity.kind !== 'unit' && entity.kind !== 'building') {
      continue;
    }
    if (entity.kind === 'building') {
      refundBuilding(state.players[command.playerId], entity);
    }
    killEntity(state, id, ctx, null);
    removed = true;
  }
  if (!removed) {
    rejectCommand(ctx, command, 'not_owner');
  }
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  switch (command.type) {
    case 'placeBuilding':
      handlePlaceBuilding(state, command, ctx);
      return true;
    case 'placeWall':
      handlePlaceWall(state, command, ctx);
      return true;
    case 'build':
    case 'repair':
      handleWorkCommand(state, command, ctx);
      return true;
    case 'delete':
      handleDelete(state, command, ctx);
      return true;
    default:
      return false;
  }
}

function join(crews: Map<EntityId, Entity[]>, targetId: EntityId, unit: Entity): void {
  const crew = crews.get(targetId);
  if (crew) {
    crew.push(unit);
  } else {
    crews.set(targetId, [unit]);
  }
}

function reach(
  state: GameState,
  unit: Entity,
  target: Entity,
  working: 'building' | 'repairing',
  data: GameData,
): boolean {
  const status = approach(state, unit, target, WORK_RANGE, data);
  if (status === 'unreachable') {
    completeOrder(unit);
    return false;
  }
  unit.target = target.id;
  unit.state = status === 'arrived' ? working : 'moving';
  return status === 'arrived';
}

function strike(state: GameState, crew: readonly Entity[], target: Entity, ctx: StepContext): void {
  if (state.tick % ctx.data.game.tickRate !== 0) {
    return;
  }
  ctx.events.push({
    type: 'constructionStrike',
    entityId: crew[0].id,
    buildingId: target.id,
    position: { x: target.position.x, y: target.position.y },
  });
}

function finishConstruction(
  state: GameState,
  building: Entity,
  crew: readonly Entity[],
  maxHp: number,
  ctx: StepContext,
): void {
  const data = ctx.data;
  building.buildProgress = 1;
  building.state = 'idle';
  building.hp = Math.min(maxHp, Math.ceil(building.hp));
  building.paid = null;
  const stats = getBuildingStats(state, building.owner, building.type, data);
  const player = state.players[building.owner];
  if (player) {
    player.housing += stats.housing;
  }
  recordStat(state, building.owner, 'buildingsBuilt', 1);
  ctx.events.push({
    type: 'buildingCompleted',
    playerId: building.owner,
    buildingId: building.id,
    buildingType: building.type,
    position: { x: building.position.x, y: building.position.y },
  });
  let farmer: Entity | null = null;
  for (const unit of crew) {
    completeOrder(unit);
    if (farmer === null && unit.orders.length === 0) {
      farmer = unit;
    }
  }
  if (farmer && stats.class.includes('farm')) {
    issueOrder(farmer, { type: 'gather', targetId: building.id }, false);
  }
}

function advanceConstruction(
  state: GameState,
  building: Entity,
  crew: readonly Entity[],
  ctx: StepContext,
): void {
  const data = ctx.data;
  const stats = getBuildingStats(state, building.owner, building.type, data);
  const duration = Math.max(1, stats.buildTime * data.game.tickRate);
  const before = building.buildProgress ?? 0;
  const next = Math.min(1, before + builderSpeed(crew.length) / duration);
  building.hp = Math.min(stats.hp, building.hp + stats.hp * (next - before));
  building.buildProgress = next;
  strike(state, crew, building, ctx);
  if (next >= 1 - COMPLETE_EPSILON) {
    finishConstruction(state, building, crew, stats.hp, ctx);
  }
}

function repairDuration(state: GameState, target: Entity, data: GameData): number {
  const owner = target.statsOwner ?? target.owner;
  const seconds =
    target.kind === 'building'
      ? getBuildingStats(state, owner, target.type, data).buildTime
      : getUnitStats(state, owner, target.type, data).trainTime;
  return Math.max(1, seconds * data.game.tickRate);
}

function repairCost(state: GameState, target: Entity, data: GameData): Cost {
  const owner = target.statsOwner ?? target.owner;
  return target.kind === 'building'
    ? getBuildingStats(state, owner, target.type, data).cost
    : getUnitStats(state, owner, target.type, data).cost;
}

function release(crew: readonly Entity[]): void {
  for (const unit of crew) {
    completeOrder(unit);
  }
}

function advanceRepair(state: GameState, target: Entity, crew: readonly Entity[], ctx: StepContext): void {
  const data = ctx.data;
  const player = state.players[crew[0].owner];
  const maxHp = getEntityMaxHp(state, target, data);
  if (!player || target.hp >= maxHp) {
    release(crew);
    return;
  }
  const rate = (maxHp * builderSpeed(crew.length)) / repairDuration(state, target, data);
  const restored = Math.min(maxHp - target.hp, rate);
  const cost = repairCost(state, target, data);
  const stored = target.scratch[REPAIR_DEBT_KEY];
  const debt: RepairDebt = stored ? { ...(stored as RepairDebt) } : {};
  const due: RepairDebt = {};
  for (const resource of RESOURCE_KINDS) {
    const owed = (debt[resource] ?? 0) + ((cost[resource] ?? 0) * REPAIR_COST_FACTOR * restored) / maxHp;
    const whole = Math.floor(owed);
    if (player.resources[resource] < whole) {
      ctx.events.push({ type: 'insufficientResources', playerId: player.id, resource });
      release(crew);
      return;
    }
    due[resource] = whole;
    debt[resource] = owed - whole;
  }
  for (const resource of RESOURCE_KINDS) {
    player.resources[resource] -= due[resource] ?? 0;
  }
  target.hp += restored;
  strike(state, crew, target, ctx);
  if (target.hp >= maxHp - COMPLETE_EPSILON) {
    target.hp = maxHp;
    delete target.scratch[REPAIR_DEBT_KEY];
    release(crew);
    return;
  }
  target.scratch[REPAIR_DEBT_KEY] = debt as JsonValue;
}

function sortedTargets(crews: Map<EntityId, Entity[]>): EntityId[] {
  return [...crews.keys()].sort((a, b) => a - b);
}

function update(state: GameState, ctx: StepContext): void {
  const data = ctx.data;
  const construction = new Map<EntityId, Entity[]>();
  const repairs = new Map<EntityId, Entity[]>();
  for (const unit of Object.values(state.entities)) {
    if (unit.orders.length === 0 || unit.carriedBy !== null) {
      continue;
    }
    const order = unit.orders[0];
    if (order.type !== 'build' && order.type !== 'repair') {
      continue;
    }
    const target = state.entities[order.targetId];
    if (!target || target.owner !== unit.owner || target.carriedBy !== null) {
      completeOrder(unit);
      continue;
    }
    if (isFoundation(target)) {
      if (reach(state, unit, target, 'building', data)) {
        join(construction, target.id, unit);
      }
      continue;
    }
    if (
      order.type === 'build' ||
      !isRepairable(state, target, data) ||
      target.hp >= getEntityMaxHp(state, target, data)
    ) {
      completeOrder(unit);
      continue;
    }
    if (reach(state, unit, target, 'repairing', data)) {
      join(repairs, target.id, unit);
    }
  }
  for (const id of sortedTargets(construction)) {
    const building = state.entities[id];
    const crew = construction.get(id);
    if (building && crew) {
      advanceConstruction(state, building, crew, ctx);
    }
  }
  for (const id of sortedTargets(repairs)) {
    const target = state.entities[id];
    const crew = repairs.get(id);
    if (target && crew) {
      advanceRepair(state, target, crew, ctx);
    }
  }
}

export const constructionSystem: System = {
  id: 'construction',
  handleCommand,
  update,
};
