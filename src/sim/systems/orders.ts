import type { Command, CommandOf } from '../commands';
import { approach, moveToward } from '../core/movement';
import {
  clearOrders,
  commandableUnits,
  completeOrder,
  entitiesWithOrder,
  formationTargets,
  issueOrder,
  rejectCommand,
} from '../core/orders';
import type { StepContext, System } from '../system';
import type { GameState, MoveOrder, Vec2 } from '../types';

const FOLLOW_RANGE = 1;

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

function handleMove(state: GameState, command: CommandOf<'move'>, ctx: StepContext): void {
  const units = commandableUnits(state, command.playerId, command.entityIds);
  const target = clampTarget(state, command.target);
  if (units.length === 0 || target === null) {
    rejectCommand(ctx, command, units.length === 0 ? 'not_owner' : 'invalid');
    return;
  }
  const targets = formationTargets(state, ctx.data, units, target);
  for (const unit of units) {
    const order: MoveOrder = { type: 'move', target: targets.get(unit.id) ?? target };
    if (units.length > 1) {
      order.groupTarget = { x: target.x, y: target.y };
    }
    issueOrder(unit, order, command.queued);
  }
}

function handleStop(state: GameState, command: CommandOf<'stop'>, ctx: StepContext): void {
  const units = commandableUnits(state, command.playerId, command.entityIds);
  if (units.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  for (const unit of units) {
    clearOrders(unit);
  }
}

function handleStandGround(
  state: GameState,
  command: CommandOf<'standGround'>,
  ctx: StepContext,
): void {
  const units = commandableUnits(state, command.playerId, command.entityIds);
  if (units.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  for (const unit of units) {
    unit.standGround = command.enabled;
    if (command.enabled) {
      clearOrders(unit);
    }
  }
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  switch (command.type) {
    case 'move':
      handleMove(state, command, ctx);
      return true;
    case 'stop':
      handleStop(state, command, ctx);
      return true;
    case 'standGround':
      handleStandGround(state, command, ctx);
      return true;
    default:
      return false;
  }
}

function update(state: GameState, ctx: StepContext): void {
  for (const unit of entitiesWithOrder(state, 'move')) {
    const order = unit.orders[0] as MoveOrder;
    const status = moveToward(state, unit, order.target, order.groupTarget ?? null);
    if (status === 'moving') {
      unit.state = 'moving';
    } else {
      completeOrder(unit);
    }
  }
  for (const unit of entitiesWithOrder(state, 'follow')) {
    const order = unit.orders[0];
    const leader = order.type === 'follow' ? state.entities[order.targetId] : undefined;
    if (!leader || leader.carriedBy !== null) {
      completeOrder(unit);
      continue;
    }
    const status = approach(state, unit, leader, FOLLOW_RANGE, ctx.data);
    unit.state = status === 'moving' ? 'moving' : 'idle';
  }
}

export const ordersSystem: System = {
  id: 'orders',
  handleCommand,
  update,
};
