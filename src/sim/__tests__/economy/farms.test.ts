import { describe, expect, it } from 'vitest';
import { farmFoodCapacity } from '../../systems/farms';
import { addBuilding, addUnit, context, data, emptyState, run, runUntil } from '../fixtures';

describe('farms', () => {
  it('stocks a finished farm with the farm food capacity', () => {
    const state = emptyState(24);
    const ctx = context();
    const farm = addBuilding(state, 'farm', 0, 10, 4);
    const foundation = addBuilding(state, 'farm', 0, 14, 4);
    foundation.buildProgress = 0.5;
    run(state, ctx, 1);
    expect(farm.amount).toBe(farmFoodCapacity(state, 0, data));
    expect(farm.amount).toBe(data.resources.farmFood);
    expect(foundation.amount).toBeNull();
  });

  it('feeds one villager and delivers farm food to the granary', () => {
    const state = emptyState(24);
    const ctx = context();
    addBuilding(state, 'granary', 0, 4, 4);
    const farm = addBuilding(state, 'farm', 0, 10, 4);
    const villager = addUnit(state, 'villager', 0, 8.5, 5.5);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: farm.id, queued: false },
    ]);
    runUntil(state, ctx, 4000, () => state.players[0].resources.food > 0);
    expect(state.players[0].resources.food).toBe(data.resources.carryCapacity.farm);
    expect(farm.amount).toBeLessThanOrEqual(data.resources.farmFood - data.resources.carryCapacity.farm);
    expect(farm.workers).toEqual([villager.id]);
  });

  it('admits a single villager', () => {
    const state = emptyState(24);
    const ctx = context();
    const farm = addBuilding(state, 'farm', 0, 10, 4);
    const first = addUnit(state, 'villager', 0, 8.5, 5.5);
    const second = addUnit(state, 'villager', 0, 8.5, 6.5);
    const third = addUnit(state, 'villager', 0, 8.5, 4.5);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [first.id, second.id], targetId: farm.id, queued: false },
    ]);
    expect(first.orders[0]).toEqual({ type: 'gather', targetId: farm.id });
    expect(second.orders).toEqual([]);
    const events = run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [third.id], targetId: farm.id, queued: false },
    ]);
    expect(events).toContainEqual({
      type: 'commandRejected',
      playerId: 0,
      command: 'gather',
      reason: 'busy',
    });
    expect(farm.workers).toEqual([first.id]);
  });

  it('frees the farm when the villager leaves', () => {
    const state = emptyState(24);
    const ctx = context();
    const farm = addBuilding(state, 'farm', 0, 10, 4);
    const villager = addUnit(state, 'villager', 0, 8.5, 5.5);
    run(state, ctx, 5, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: farm.id, queued: false },
    ]);
    expect(farm.workers).toEqual([villager.id]);
    run(state, ctx, 2, [{ type: 'stop', playerId: 0, entityIds: [villager.id] }]);
    expect(farm.workers).toEqual([]);
  });

  it('is reseeded for its cost on depletion and keeps the villager working', () => {
    const state = emptyState(24);
    const ctx = context();
    const cost = data.buildings.farm.cost.wood ?? 0;
    state.players[0].resources.wood = cost + 10;
    addBuilding(state, 'town_center', 0, 4, 4);
    const farm = addBuilding(state, 'farm', 0, 10, 4);
    farm.amount = 4;
    const villager = addUnit(state, 'villager', 0, 8.5, 5.5);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: farm.id, queued: false },
    ]);
    runUntil(state, ctx, 4000, () => state.players[0].resources.wood === 10);
    expect(state.players[0].resources.wood).toBe(10);
    expect(farm.amount).toBe(farmFoodCapacity(state, 0, data));
    run(state, ctx, 20);
    expect(state.entities[farm.id]).toBe(farm);
    expect(villager.orders[0]).toEqual({ type: 'gather', targetId: farm.id });
    expect(villager.state).toBe('gathering');
  });

  it('waits for wood when the reseed is not affordable', () => {
    const state = emptyState(24);
    const ctx = context();
    addBuilding(state, 'town_center', 0, 4, 4);
    const farm = addBuilding(state, 'farm', 0, 10, 4);
    farm.amount = 4;
    const villager = addUnit(state, 'villager', 0, 8.5, 5.5);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: farm.id, queued: false },
    ]);
    runUntil(state, ctx, 4000, () => state.players[0].resources.food === 4);
    run(state, ctx, 200);
    expect(state.players[0].resources.food).toBe(4);
    expect(state.entities[farm.id]).toBe(farm);
    expect(farm.amount).toBe(0);
    expect(villager.orders[0]).toEqual({ type: 'gather', targetId: farm.id });
    state.players[0].resources.wood = data.buildings.farm.cost.wood ?? 0;
    run(state, ctx, 1);
    expect(state.players[0].resources.wood).toBe(0);
    expect(farm.amount).toBe(farmFoodCapacity(state, 0, data));
    runUntil(state, ctx, 400, () => villager.state === 'gathering');
    expect(villager.state).toBe('gathering');
  });

  it('is destroyed when depleted without a farmer', () => {
    const state = emptyState(24);
    const ctx = context();
    state.players[0].resources.wood = 1000;
    const farm = addBuilding(state, 'farm', 0, 10, 4);
    farm.amount = 0;
    run(state, ctx, 1);
    expect(state.entities[farm.id]).toBeUndefined();
    expect(state.players[0].resources.wood).toBe(1000);
  });

  it('is destroyed on depletion for an AI player and the villager delivers the rest', () => {
    const state = emptyState(24);
    const ctx = context();
    state.players[0].kind = 'ai';
    state.players[0].resources.wood = 1000;
    addBuilding(state, 'town_center', 0, 4, 4);
    const farm = addBuilding(state, 'farm', 0, 10, 4);
    farm.amount = 4;
    const villager = addUnit(state, 'villager', 0, 8.5, 5.5);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: farm.id, queued: false },
    ]);
    runUntil(state, ctx, 4000, () => state.entities[farm.id] === undefined);
    expect(state.entities[farm.id]).toBeUndefined();
    expect(state.map.occupancy.every((occupant) => occupant !== farm.id)).toBe(true);
    runUntil(state, ctx, 4000, () => villager.orders.length === 0);
    expect(state.players[0].resources.food).toBe(4);
    expect(villager.state).toBe('idle');
  });
});
