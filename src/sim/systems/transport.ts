import type { GameData } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import { distance, distanceSq } from '../core/geometry';
import { approach, isMoving, moveToward } from '../core/movement';
import { domainOf, isPassable } from '../core/navgrid';
import {
  clearOrders,
  commandableUnits,
  completeOrder,
  entitiesWithOrder,
  issueOrder,
  rejectCommand,
} from '../core/orders';
import { freeTilesNear } from '../core/pathfinding';
import { indexEntity, unindexEntity } from '../core/spatial';
import { getUnitStats } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, EntityId, GameState, Vec2 } from '../types';

const BOARD_RANGE = 0.5;
const UNLOAD_REACH = 2;

export function transportCapacity(state: GameState, transport: Entity, data: GameData): number {
  if (transport.kind !== 'unit' || !data.units[transport.type]) {
    return 0;
  }
  const owner = transport.statsOwner ?? transport.owner;
  return getUnitStats(state, owner, transport.type, data).transportCapacity ?? 0;
}

export function boardTransport(state: GameState, passenger: Entity, transport: Entity): void {
  clearOrders(passenger);
  passenger.carriedBy = transport.id;
  passenger.state = 'carried';
  passenger.position.x = transport.position.x;
  passenger.position.y = transport.position.y;
  transport.cargo.push(passenger.id);
  unindexEntity(state, passenger.id);
}

function landingTile(state: GameState, data: GameData, transport: Entity, target: Vec2): Vec2 | null {
  const originX = Math.floor(transport.position.x);
  const originY = Math.floor(transport.position.y);
  let best: Vec2 | null = null;
  let bestSq = Infinity;
  for (let dy = -UNLOAD_REACH; dy <= UNLOAD_REACH; dy++) {
    for (let dx = -UNLOAD_REACH; dx <= UNLOAD_REACH; dx++) {
      const x = originX + dx;
      const y = originY + dy;
      if (!isPassable(state, data, 'land', x, y)) {
        continue;
      }
      const center = { x: x + 0.5, y: y + 0.5 };
      if (distance(center, transport.position) > UNLOAD_REACH + 0.5) {
        continue;
      }
      const distSq = distanceSq(center, target);
      if (distSq < bestSq) {
        best = center;
        bestSq = distSq;
      }
    }
  }
  return best;
}

export function unloadTransport(
  state: GameState,
  transport: Entity,
  target: Vec2,
  data: GameData,
): boolean {
  if (transport.cargo.length === 0) {
    return true;
  }
  const landing = landingTile(state, data, transport, target);
  if (!landing) {
    return false;
  }
  const spots = freeTilesNear(state, data, 'land', landing, transport.cargo.length);
  transport.cargo.forEach((id, index) => {
    const passenger = state.entities[id];
    if (!passenger) {
      return;
    }
    const spot = spots[index] ?? landing;
    passenger.carriedBy = null;
    passenger.state = 'idle';
    passenger.position.x = spot.x;
    passenger.position.y = spot.y;
    indexEntity(state, passenger);
  });
  transport.cargo = [];
  return true;
}

function handleLoad(state: GameState, command: CommandOf<'load'>, ctx: StepContext): void {
  const transport = state.entities[command.transportId];
  const passengers = commandableUnits(state, command.playerId, command.entityIds).filter(
    (unit) => domainOf(unit, ctx.data) === 'land' && unit.id !== command.transportId,
  );
  if (passengers.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  if (!transport || transport.owner !== command.playerId || transport.carriedBy !== null) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const capacity = transportCapacity(state, transport, ctx.data);
  if (capacity <= 0) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  if (transport.cargo.length >= capacity) {
    rejectCommand(ctx, command, 'busy');
    return;
  }
  for (const passenger of passengers) {
    issueOrder(passenger, { type: 'load', targetId: transport.id }, command.queued);
  }
}

function handleUnload(state: GameState, command: CommandOf<'unload'>, ctx: StepContext): void {
  const transports = commandableUnits(state, command.playerId, command.entityIds).filter(
    (unit) => transportCapacity(state, unit, ctx.data) > 0,
  );
  if (transports.length === 0) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  if (!Number.isFinite(command.target.x) || !Number.isFinite(command.target.y)) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  for (const transport of transports) {
    issueOrder(
      transport,
      { type: 'unload', target: { x: command.target.x, y: command.target.y } },
      command.queued,
    );
  }
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  switch (command.type) {
    case 'load':
      handleLoad(state, command, ctx);
      return true;
    case 'unload':
      handleUnload(state, command, ctx);
      return true;
    default:
      return false;
  }
}

function updateLoading(state: GameState, ctx: StepContext): void {
  const summoned = new Set<EntityId>();
  for (const passenger of entitiesWithOrder(state, 'load')) {
    const order = passenger.orders[0];
    const transport = order.type === 'load' ? state.entities[order.targetId] : undefined;
    if (
      !transport ||
      transport.owner !== passenger.owner ||
      transport.carriedBy !== null ||
      transport.cargo.length >= transportCapacity(state, transport, ctx.data)
    ) {
      completeOrder(passenger);
      continue;
    }
    const status = approach(state, passenger, transport, BOARD_RANGE, ctx.data);
    if (status === 'arrived') {
      boardTransport(state, passenger, transport);
      continue;
    }
    passenger.state = status === 'moving' ? 'moving' : 'loading';
    if (status === 'unreachable' && transport.orders.length === 0 && !summoned.has(transport.id)) {
      summoned.add(transport.id);
      moveToward(state, transport, passenger.position);
      transport.state = isMoving(transport) ? 'moving' : 'idle';
    }
  }
}

function updateUnloading(state: GameState, ctx: StepContext): void {
  for (const transport of entitiesWithOrder(state, 'unload')) {
    const order = transport.orders[0];
    if (order.type !== 'unload') {
      continue;
    }
    if (transport.cargo.length === 0) {
      completeOrder(transport);
      continue;
    }
    const status = moveToward(state, transport, order.target);
    if (status === 'moving') {
      transport.state = 'moving';
      continue;
    }
    unloadTransport(state, transport, order.target, ctx.data);
    completeOrder(transport);
  }
}

function carryCargo(state: GameState, data: GameData): void {
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'unit' || data.units[entity.type]?.transportCapacity === undefined) {
      continue;
    }
    for (const id of entity.cargo) {
      const passenger = state.entities[id];
      if (passenger) {
        passenger.position.x = entity.position.x;
        passenger.position.y = entity.position.y;
      }
    }
    if (entity.orders.length === 0 && entity.state === 'moving' && !isMoving(entity)) {
      entity.state = 'idle';
    }
  }
}

function update(state: GameState, ctx: StepContext): void {
  updateLoading(state, ctx);
  updateUnloading(state, ctx);
  carryCargo(state, ctx.data);
}

export const transportSystem: System = {
  id: 'transport',
  handleCommand,
  update,
};
