import type { GameData, MovementDomain, UnitDef } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import { entityFootprint, footprintOrigin, spawnEntity } from '../core/entities';
import { isPassable } from '../core/navgrid';
import { issueOrder, rejectCommand } from '../core/orders';
import {
  MAX_QUEUE_LENGTH,
  housingBlockReason,
  missingResource,
  payCost,
  populationCap,
  refreshBuildingState,
  refundCost,
  resolveUnitType,
  unitBlockReason,
} from '../effects/availability';
import { recordStat } from '../playerStats';
import { getUnitStats } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, GameState, Player, PlayerId, Vec2 } from '../types';

const BLOCK_KEY = 'productionBlocked';
const SPAWN_REACH = 2;

function ownBuilding(state: GameState, playerId: PlayerId, id: number): Entity | null {
  const building = state.entities[id];
  if (!building || building.kind !== 'building' || building.owner !== playerId) {
    return null;
  }
  return building;
}

function handleTrain(state: GameState, command: CommandOf<'train'>, ctx: StepContext): void {
  const data = ctx.data;
  const player = state.players[command.playerId];
  const building = ownBuilding(state, command.playerId, command.buildingId);
  if (!player || !building) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const count = Math.floor(command.count);
  if (building.buildProgress !== 1 || !(count >= 1)) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const unit = resolveUnitType(player, command.unit, data);
  const def = data.units[unit];
  if (!def || def.building !== building.type) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const blocked = unitBlockReason(player, unit, data);
  if (blocked !== null) {
    rejectCommand(ctx, command, blocked);
    return;
  }
  const room = MAX_QUEUE_LENGTH - building.queue.length;
  if (building.research !== null || room <= 0) {
    rejectCommand(ctx, command, 'busy');
    return;
  }
  const cost = getUnitStats(state, player.id, unit, data).cost;
  let queued = 0;
  while (queued < count && queued < room) {
    const lacking = missingResource(player, cost);
    if (lacking !== null) {
      if (queued === 0) {
        ctx.events.push({ type: 'insufficientResources', playerId: player.id, resource: lacking });
        rejectCommand(ctx, command, 'resources');
      }
      break;
    }
    payCost(player, cost);
    building.queue.push({ unit, progress: 0, paid: { ...cost } });
    queued += 1;
  }
  refreshBuildingState(building);
}

function handleCancelQueueItem(
  state: GameState,
  command: CommandOf<'cancelQueueItem'>,
  ctx: StepContext,
): void {
  const building = ownBuilding(state, command.playerId, command.buildingId);
  if (!building) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const item = Number.isInteger(command.index) ? building.queue[command.index] : undefined;
  if (!item) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  refundCost(state.players[command.playerId], item.paid);
  building.queue.splice(command.index, 1);
  if (command.index === 0) {
    delete building.scratch[BLOCK_KEY];
  }
  refreshBuildingState(building);
}

function handleSetRallyPoint(
  state: GameState,
  command: CommandOf<'setRallyPoint'>,
  ctx: StepContext,
): void {
  if (!Number.isFinite(command.position.x) || !Number.isFinite(command.position.y)) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  let applied = false;
  for (const id of command.buildingIds) {
    const building = ownBuilding(state, command.playerId, id);
    if (!building) {
      continue;
    }
    building.rallyPoint = {
      position: { x: command.position.x, y: command.position.y },
      targetId: command.targetId,
    };
    applied = true;
  }
  if (!applied) {
    rejectCommand(ctx, command, 'not_owner');
  }
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  switch (command.type) {
    case 'train':
      handleTrain(state, command, ctx);
      return true;
    case 'cancelQueueItem':
      handleCancelQueueItem(state, command, ctx);
      return true;
    case 'setRallyPoint':
      handleSetRallyPoint(state, command, ctx);
      return true;
    default:
      return false;
  }
}

export function spawnPointNear(
  state: GameState,
  building: Entity,
  domain: MovementDomain,
  data: GameData,
): Vec2 | null {
  const size = entityFootprint(building, data);
  const origin = footprintOrigin(building.position, size);
  const reference = building.rallyPoint?.position ?? {
    x: building.position.x,
    y: building.position.y + size,
  };
  for (let reach = 1; reach <= SPAWN_REACH; reach++) {
    let best: Vec2 | null = null;
    let bestSq = Infinity;
    for (let y = origin.y - reach; y < origin.y + size + reach; y++) {
      for (let x = origin.x - reach; x < origin.x + size + reach; x++) {
        const inner =
          x > origin.x - reach &&
          x < origin.x + size + reach - 1 &&
          y > origin.y - reach &&
          y < origin.y + size + reach - 1;
        if (inner || !isPassable(state, data, domain, x, y)) {
          continue;
        }
        const dx = x + 0.5 - reference.x;
        const dy = y + 0.5 - reference.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestSq) {
          best = { x: x + 0.5, y: y + 0.5 };
          bestSq = distSq;
        }
      }
    }
    if (best) {
      return best;
    }
  }
  return null;
}

function isGatherTarget(target: Entity, owner: PlayerId, data: GameData): boolean {
  if (target.kind === 'resource') {
    return true;
  }
  if (target.kind === 'unit') {
    return data.units[target.type]?.animal !== undefined;
  }
  return (
    target.kind === 'building' &&
    target.owner === owner &&
    target.buildProgress === 1 &&
    (data.buildings[target.type]?.class.includes('farm') ?? false)
  );
}

function applyRallyPoint(state: GameState, unit: Entity, building: Entity, def: UnitDef, data: GameData): void {
  const rally = building.rallyPoint;
  if (!rally) {
    return;
  }
  const target = rally.targetId !== null ? state.entities[rally.targetId] : undefined;
  if (target && target.carriedBy === null) {
    const villager = def.class.includes('villager');
    if ((villager || def.class.includes('fishing_ship')) && isGatherTarget(target, unit.owner, data)) {
      issueOrder(unit, { type: 'gather', targetId: target.id }, false);
      return;
    }
    if (
      villager &&
      target.kind === 'building' &&
      target.owner === unit.owner &&
      target.buildProgress !== null &&
      target.buildProgress < 1
    ) {
      issueOrder(unit, { type: 'build', targetId: target.id }, false);
      return;
    }
  }
  issueOrder(unit, { type: 'move', target: { x: rally.position.x, y: rally.position.y } }, false);
}

function reportBlocked(state: GameState, building: Entity, player: Player, needed: number, ctx: StepContext): void {
  if (building.scratch[BLOCK_KEY] === true) {
    return;
  }
  building.scratch[BLOCK_KEY] = true;
  const reason = housingBlockReason(state, player, needed);
  ctx.events.push({
    type: reason === 'population_limit' ? 'populationLimit' : 'housingShort',
    playerId: player.id,
  });
}

function reservedPopulation(state: GameState, data: GameData): Map<PlayerId, number> {
  const reserved = new Map<PlayerId, number>();
  for (const building of Object.values(state.entities)) {
    const item = building.queue[0];
    if (!item || item.progress <= 0) {
      continue;
    }
    const population = data.units[item.unit]?.population ?? 0;
    reserved.set(building.owner, (reserved.get(building.owner) ?? 0) + population);
  }
  return reserved;
}

function advanceQueue(
  state: GameState,
  building: Entity,
  player: Player,
  reserved: Map<PlayerId, number>,
  ctx: StepContext,
): void {
  const data = ctx.data;
  const item = building.queue[0];
  const def = data.units[item.unit];
  if (!def) {
    refundCost(player, item.paid);
    building.queue.shift();
    return;
  }
  const cap = populationCap(state, player);
  const committed = reserved.get(player.id) ?? 0;
  if (item.progress <= 0) {
    const needed = player.population + committed + def.population;
    if (def.population > 0 && needed > cap) {
      reportBlocked(state, building, player, needed, ctx);
      return;
    }
    reserved.set(player.id, committed + def.population);
  }
  if (item.progress < 1) {
    const trainTime = getUnitStats(state, player.id, def.id, data).trainTime;
    item.progress = Math.min(1, item.progress + 1 / Math.max(1, trainTime * data.game.tickRate));
    if (item.progress < 1) {
      delete building.scratch[BLOCK_KEY];
      return;
    }
  }
  const needed = player.population + def.population;
  if (def.population > 0 && needed > cap) {
    reportBlocked(state, building, player, needed, ctx);
    return;
  }
  const spot = spawnPointNear(state, building, def.domain, data);
  if (!spot) {
    return;
  }
  delete building.scratch[BLOCK_KEY];
  building.queue.shift();
  const unit = spawnEntity(
    state,
    {
      kind: 'unit',
      type: def.id,
      owner: player.id,
      position: spot,
      hp: getUnitStats(state, player.id, def.id, data).hp,
    },
    data,
  );
  player.population += def.population;
  reserved.set(player.id, Math.max(0, (reserved.get(player.id) ?? 0) - def.population));
  recordStat(state, player.id, 'unitsTrained', 1);
  ctx.events.push({
    type: 'unitTrained',
    playerId: player.id,
    entityId: unit.id,
    unitType: unit.type,
    position: { x: spot.x, y: spot.y },
  });
  applyRallyPoint(state, unit, building, def, data);
}

function update(state: GameState, ctx: StepContext): void {
  const reserved = reservedPopulation(state, ctx.data);
  for (const building of Object.values(state.entities)) {
    if (building.kind !== 'building' || building.queue.length === 0 || building.buildProgress !== 1) {
      continue;
    }
    const player = state.players[building.owner];
    if (!player) {
      continue;
    }
    advanceQueue(state, building, player, reserved, ctx);
    refreshBuildingState(building);
  }
}

export const productionSystem: System = {
  id: 'production',
  handleCommand,
  update,
};
