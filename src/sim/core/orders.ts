import type { GameData, MovementDomain } from '../../data/types';
import type { Command } from '../commands';
import type { CommandRejectReason } from '../events';
import type { StepContext } from '../system';
import type { Entity, EntityId, GameState, Order, OrderType, PlayerId, Vec2 } from '../types';
import { distanceSq } from './geometry';
import { stopMoving } from './movement';
import { domainOf } from './navgrid';
import { formationSlots } from './pathfinding';

const WIDE_UNIT_RADIUS = 0.5;

export function currentOrder(entity: Entity): Order | null {
  return entity.orders.length > 0 ? entity.orders[0] : null;
}

export function resetActivity(entity: Entity): void {
  stopMoving(entity);
  entity.target = null;
  if (entity.kind === 'unit' && entity.carriedBy === null) {
    entity.state = 'idle';
  }
}

export function issueOrder(entity: Entity, order: Order, queued: boolean): void {
  if (!queued && entity.orders.length > 0) {
    entity.orders = [];
    resetActivity(entity);
  }
  entity.orders.push(order);
}

export function completeOrder(entity: Entity): void {
  entity.orders.shift();
  resetActivity(entity);
}

export function clearOrders(entity: Entity): void {
  entity.orders = [];
  resetActivity(entity);
}

export function entitiesWithOrder<T extends OrderType>(state: GameState, type: T): Entity[] {
  const found: Entity[] = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.orders.length > 0 && entity.orders[0].type === type && entity.carriedBy === null) {
      found.push(entity);
    }
  }
  return found;
}

export function commandableUnits(
  state: GameState,
  playerId: PlayerId,
  entityIds: readonly EntityId[],
): Entity[] {
  const seen = new Set<EntityId>();
  const units: Entity[] = [];
  for (const id of entityIds) {
    const entity = state.entities[id];
    if (
      entity &&
      !seen.has(id) &&
      entity.kind === 'unit' &&
      entity.owner === playerId &&
      entity.carriedBy === null
    ) {
      seen.add(id);
      units.push(entity);
    }
  }
  return units.sort((a, b) => a.id - b.id);
}

export function rejectCommand(
  ctx: StepContext,
  command: Command,
  reason: CommandRejectReason,
): void {
  ctx.events.push({
    type: 'commandRejected',
    playerId: command.playerId,
    command: command.type,
    reason,
  });
}

export function formationTargets(
  state: GameState,
  data: GameData,
  units: readonly Entity[],
  target: Vec2,
): Map<EntityId, Vec2> {
  const targets = new Map<EntityId, Vec2>();
  const domains: MovementDomain[] = ['land', 'water'];
  for (const domain of domains) {
    const members = units
      .filter((unit) => domainOf(unit, data) === domain)
      .sort(
        (a, b) => distanceSq(a.position, target) - distanceSq(b.position, target) || a.id - b.id,
      );
    if (members.length === 0) {
      continue;
    }
    const wide = members.some((unit) => (data.units[unit.type]?.radius ?? 0) > WIDE_UNIT_RADIUS);
    const slots = formationSlots(
      state,
      data,
      domain,
      members[0].position,
      target,
      members.length,
      wide ? 2 : 1,
    );
    members.forEach((unit, index) => {
      targets.set(unit.id, slots[index] ?? { x: target.x, y: target.y });
    });
  }
  return targets;
}
