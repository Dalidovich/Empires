import type { GameData } from '../../data/types';
import { removeEntity } from '../core/entities';
import { missingResource, payCost } from '../effects/availability';
import { getBuildingStats, getFarmFood } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, EntityId, GameState, PlayerId } from '../types';

export function farmFoodCapacity(state: GameState, playerId: PlayerId, data: GameData): number {
  return getFarmFood(state, playerId, data);
}

export function isFarm(state: GameState, entity: Entity, data: GameData): boolean {
  if (entity.kind !== 'building' || !data.buildings[entity.type]) {
    return false;
  }
  return getBuildingStats(state, entity.owner, entity.type, data).class.includes('farm');
}

export function ensureFarmStock(state: GameState, farm: Entity, data: GameData): void {
  if (farm.amount === null && farm.buildProgress === 1) {
    farm.amount = farmFoodCapacity(state, farm.statsOwner ?? farm.owner, data);
  }
}

export function farmWorker(state: GameState, farm: Entity): EntityId | null {
  for (const id of farm.workers) {
    const worker = state.entities[id];
    const order = worker?.orders[0];
    if (order && order.type === 'gather' && order.targetId === farm.id) {
      return id;
    }
  }
  return null;
}

export function reseedsAutomatically(state: GameState, farm: Entity): boolean {
  return state.players[farm.owner]?.kind === 'human';
}

function reseed(state: GameState, farm: Entity, data: GameData): boolean {
  const player = state.players[farm.owner];
  if (!player) {
    return false;
  }
  const cost = getBuildingStats(state, farm.owner, farm.type, data).cost;
  if (missingResource(player, cost) !== null) {
    return false;
  }
  payCost(player, cost);
  farm.amount = farmFoodCapacity(state, farm.statsOwner ?? farm.owner, data);
  return true;
}

function survivesDepletion(
  state: GameState,
  farm: Entity,
  worker: EntityId | null,
  data: GameData,
): boolean {
  if (worker === null || !reseedsAutomatically(state, farm)) {
    return false;
  }
  reseed(state, farm, data);
  return true;
}

function update(state: GameState, ctx: StepContext): void {
  for (const entity of Object.values(state.entities)) {
    if (entity.buildProgress !== 1 || !isFarm(state, entity, ctx.data)) {
      continue;
    }
    ensureFarmStock(state, entity, ctx.data);
    const worker = farmWorker(state, entity);
    if (worker === null) {
      if (entity.workers.length > 0) {
        entity.workers = [];
      }
    } else if (entity.workers.length !== 1 || entity.workers[0] !== worker) {
      entity.workers = [worker];
    }
    if ((entity.amount ?? 0) < 1 && !survivesDepletion(state, entity, worker, ctx.data)) {
      removeEntity(state, entity.id, ctx.data);
    }
  }
}

export const farmsSystem: System = {
  id: 'farms',
  update,
};
