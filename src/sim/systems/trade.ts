import type { GameData } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import { distance } from '../core/geometry';
import { approach } from '../core/movement';
import {
  commandableUnits,
  completeOrder,
  entitiesWithOrder,
  issueOrder,
  rejectCommand,
  resetActivity,
} from '../core/orders';
import { getBuildingStats, getUnitStats } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, GameState, JsonValue, TradeGood, TradeOrder, Vec2 } from '../types';
import { GAIA_PLAYER_ID } from '../types';
import type { DropOffIndex } from './gathering';
import { depositCarry, indexDropOffs, nearestDropOff } from './gathering';

const MEMORY_KEY = 'trade';
const DOCK_RANGE = 0;
const TRADE_GOODS: readonly TradeGood[] = ['food', 'wood', 'stone'];

interface TradeMemory {
  x: number;
  y: number;
}

export function tradeIncome(dockDistance: number, data: GameData): number {
  const { minGold, maxGold, maxDistance } = data.game.trade;
  const share = maxDistance > 0 ? Math.min(1, Math.max(0, dockDistance / maxDistance)) : 1;
  return Math.round(minGold + (maxGold - minGold) * share);
}

export function isTradeShip(state: GameState, unit: Entity, data: GameData): boolean {
  if (unit.kind !== 'unit' || !data.units[unit.type]) {
    return false;
  }
  const owner = unit.statsOwner ?? unit.owner;
  return getUnitStats(state, owner, unit.type, data).class.includes('trade_ship');
}

function isDock(state: GameState, entity: Entity | undefined, data: GameData): entity is Entity {
  if (!entity || entity.kind !== 'building' || entity.buildProgress !== 1) {
    return false;
  }
  if (!data.buildings[entity.type]) {
    return false;
  }
  return getBuildingStats(state, entity.owner, entity.type, data).class.includes('dock');
}

function isTradePartner(state: GameState, unit: Entity, dock: Entity | undefined, data: GameData): dock is Entity {
  return isDock(state, dock, data) && dock.owner !== unit.owner && dock.owner !== GAIA_PLAYER_ID;
}

function homeOf(unit: Entity): Vec2 | null {
  const memory = unit.scratch[MEMORY_KEY];
  return memory ? (memory as unknown as TradeMemory) : null;
}

function forget(unit: Entity): void {
  if (MEMORY_KEY in unit.scratch) {
    delete unit.scratch[MEMORY_KEY];
  }
}

function refundGoods(state: GameState, unit: Entity): void {
  const carry = unit.carry;
  const player = state.players[unit.owner];
  if (carry && carry.kind === 'trade' && carry.resource !== 'gold' && player) {
    player.resources[carry.resource] += carry.amount;
    unit.carry = null;
  }
}

function abandonTrade(state: GameState, unit: Entity): void {
  forget(unit);
  const carry = unit.carry;
  if (carry && carry.kind === 'trade' && carry.resource === 'gold' && carry.amount > 0) {
    unit.orders[0] = { type: 'dropOff', targetId: null };
    resetActivity(unit);
    return;
  }
  refundGoods(state, unit);
  completeOrder(unit);
}

function loadGoods(state: GameState, unit: Entity, order: TradeOrder, home: Entity, ctx: StepContext): void {
  const player = state.players[unit.owner];
  const goods = ctx.data.game.trade.goodsPerTrip;
  if (!player || player.resources[order.good] < goods) {
    ctx.events.push({ type: 'insufficientResources', playerId: unit.owner, resource: order.good });
    forget(unit);
    completeOrder(unit);
    return;
  }
  player.resources[order.good] -= goods;
  unit.carry = { kind: 'trade', resource: order.good, amount: goods };
  const memory: TradeMemory = { x: home.position.x, y: home.position.y };
  unit.scratch[MEMORY_KEY] = memory as unknown as JsonValue;
}

function updateTrader(
  state: GameState,
  unit: Entity,
  order: TradeOrder,
  ctx: StepContext,
  dropOffs: DropOffIndex,
): void {
  const data = ctx.data;
  const partner = state.entities[order.targetId];
  if (!isTradeShip(state, unit, data) || !isTradePartner(state, unit, partner, data)) {
    abandonTrade(state, unit);
    return;
  }
  if (unit.carry && unit.carry.kind !== 'trade') {
    unit.carry = null;
  }
  const carry = unit.carry;
  if (carry && carry.resource !== 'gold') {
    const status = approach(state, unit, partner, DOCK_RANGE, data);
    unit.state = 'trading';
    unit.target = partner.id;
    if (status === 'unreachable') {
      abandonTrade(state, unit);
    } else if (status === 'arrived') {
      const home = homeOf(unit) ?? nearestDropOff(state, unit, 'trade', data, dropOffs)?.position;
      const gold = tradeIncome(home ? distance(home, partner.position) : 0, data);
      unit.carry = { kind: 'trade', resource: 'gold', amount: gold };
    }
    return;
  }
  const home = nearestDropOff(state, unit, 'trade', data, dropOffs);
  if (!home) {
    forget(unit);
    completeOrder(unit);
    return;
  }
  const status = approach(state, unit, home, DOCK_RANGE, data);
  unit.state = 'trading';
  unit.target = home.id;
  if (status === 'moving') {
    return;
  }
  if (status === 'unreachable') {
    forget(unit);
    completeOrder(unit);
    return;
  }
  if (carry) {
    const gold = depositCarry(state, unit);
    ctx.events.push({
      type: 'tradeCompleted',
      playerId: unit.owner,
      entityId: unit.id,
      gold,
      position: { x: home.position.x, y: home.position.y },
    });
  }
  loadGoods(state, unit, order, home, ctx);
}

function handleTrade(state: GameState, command: CommandOf<'trade'>, ctx: StepContext): void {
  const ships = commandableUnits(state, command.playerId, command.entityIds).filter((unit) =>
    isTradeShip(state, unit, ctx.data),
  );
  if (ships.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const dock = state.entities[command.dockId];
  if (!TRADE_GOODS.includes(command.good) || !isTradePartner(state, ships[0], dock, ctx.data)) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  for (const ship of ships) {
    issueOrder(ship, { type: 'trade', targetId: dock.id, good: command.good }, command.queued);
  }
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  if (command.type !== 'trade') {
    return false;
  }
  handleTrade(state, command, ctx);
  return true;
}

function update(state: GameState, ctx: StepContext): void {
  const traders = entitiesWithOrder(state, 'trade');
  if (traders.length === 0) {
    return;
  }
  const dropOffs = indexDropOffs(state, ctx.data);
  for (const unit of traders) {
    const order = unit.orders[0];
    if (order.type === 'trade') {
      updateTrader(state, unit, order, ctx, dropOffs);
    }
  }
}

export const tradeSystem: System = {
  id: 'trade',
  handleCommand,
  update,
};
