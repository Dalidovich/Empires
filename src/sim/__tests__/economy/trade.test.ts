import { describe, expect, it } from 'vitest';
import { tradeIncome } from '../../systems/trade';
import type { GameState } from '../../types';
import { TERRAIN } from '../../types';
import { addBuilding, addUnit, context, data, emptyState, paint, run, runUntil } from '../fixtures';

function seaState(size: number, playerCount = 2): GameState {
  const state = emptyState(size, playerCount);
  paint(state, 0, 8, size - 1, size - 1, TERRAIN.deepWater);
  return state;
}

describe('trade income', () => {
  it('stays within the configured bounds', () => {
    const { minGold, maxGold, maxDistance } = data.game.trade;
    expect(minGold).toBe(7);
    expect(maxGold).toBe(75);
    expect(tradeIncome(0, data)).toBe(minGold);
    expect(tradeIncome(maxDistance, data)).toBe(maxGold);
    expect(tradeIncome(maxDistance * 10, data)).toBe(maxGold);
    expect(tradeIncome(-5, data)).toBe(minGold);
  });

  it('grows with the distance between docks', () => {
    let previous = tradeIncome(0, data);
    for (let dist = 10; dist <= data.game.trade.maxDistance; dist += 10) {
      const income = tradeIncome(dist, data);
      expect(income).toBeGreaterThan(previous);
      previous = income;
    }
  });
});

describe('trade route', () => {
  it('carries goods to a foreign dock and returns with gold', () => {
    const state = seaState(48);
    const ctx = context();
    const home = addBuilding(state, 'dock', 0, 4, 5);
    const partner = addBuilding(state, 'dock', 1, 34, 5);
    const boat = addUnit(state, 'trade_boat', 0, 6.5, 9.5);
    state.players[0].resources.wood = 100;
    const goods = data.game.trade.goodsPerTrip;
    const expected = tradeIncome(Math.abs(partner.position.x - home.position.x), data);

    const events = run(state, ctx, 1, [
      {
        type: 'trade',
        playerId: 0,
        entityIds: [boat.id],
        dockId: partner.id,
        good: 'wood',
        queued: false,
      },
    ]);
    expect(events.some((event) => event.type === 'commandRejected')).toBe(false);

    runUntil(state, ctx, 2000, () => boat.carry !== null);
    expect(boat.carry).toEqual({ kind: 'trade', resource: 'wood', amount: goods });
    expect(state.players[0].resources.wood).toBe(100 - goods);

    runUntil(state, ctx, 4000, () => boat.carry?.resource === 'gold');
    expect(boat.carry).toEqual({ kind: 'trade', resource: 'gold', amount: expected });

    let completed = false;
    runUntil(state, ctx, 4000, () => {
      completed = state.players[0].resources.gold > 0;
      return completed;
    });
    expect(state.players[0].resources.gold).toBe(expected);
    expect(expected).toBeGreaterThanOrEqual(data.game.trade.minGold);
    expect(expected).toBeLessThanOrEqual(data.game.trade.maxGold);
    expect(state.players[0].stats.tradeGold).toBe(expected);
    expect(state.players[0].stats.goldGathered).toBe(0);
    expect(state.players[1].resources.wood).toBe(0);
    expect(state.players[0].resources.wood).toBe(100 - goods * 2);
    expect(boat.orders[0]).toEqual({ type: 'trade', targetId: partner.id, good: 'wood' });
  });

  it('reports the finished trip', () => {
    const state = seaState(32);
    const ctx = context();
    addBuilding(state, 'dock', 0, 4, 5);
    const partner = addBuilding(state, 'dock', 1, 20, 5);
    const boat = addUnit(state, 'trade_boat', 0, 6.5, 9.5);
    state.players[0].resources.food = 20;
    const events = run(state, ctx, 3000, [
      {
        type: 'trade',
        playerId: 0,
        entityIds: [boat.id],
        dockId: partner.id,
        good: 'food',
        queued: false,
      },
    ]);
    const done = events.filter((event) => event.type === 'tradeCompleted');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ playerId: 0, entityId: boat.id });
    expect(events.some((event) => event.type === 'insufficientResources')).toBe(true);
    expect(boat.orders).toEqual([]);
    expect(state.players[0].resources.food).toBe(0);
  });

  it('rejects own docks, non-trading units and missing docks', () => {
    const state = seaState(32);
    const ctx = context();
    const home = addBuilding(state, 'dock', 0, 4, 5);
    const partner = addBuilding(state, 'dock', 1, 20, 5);
    const boat = addUnit(state, 'trade_boat', 0, 6.5, 9.5);
    const fisher = addUnit(state, 'fishing_boat', 0, 8.5, 9.5);
    const events = run(state, ctx, 1, [
      { type: 'trade', playerId: 0, entityIds: [boat.id], dockId: home.id, good: 'wood', queued: false },
      { type: 'trade', playerId: 0, entityIds: [fisher.id], dockId: partner.id, good: 'wood', queued: false },
      { type: 'trade', playerId: 0, entityIds: [boat.id], dockId: 9999, good: 'wood', queued: false },
    ]);
    const reasons = events
      .filter((event) => event.type === 'commandRejected')
      .map((event) => (event.type === 'commandRejected' ? event.reason : ''));
    expect(reasons).toEqual(['invalid', 'not_owner', 'invalid']);
    expect(boat.orders).toEqual([]);
  });

  it('refunds the goods when the foreign dock disappears', () => {
    const state = seaState(48);
    const ctx = context();
    addBuilding(state, 'dock', 0, 4, 5);
    const partner = addBuilding(state, 'dock', 1, 34, 5);
    const boat = addUnit(state, 'trade_boat', 0, 6.5, 9.5);
    state.players[0].resources.stone = 50;
    run(state, ctx, 1, [
      { type: 'trade', playerId: 0, entityIds: [boat.id], dockId: partner.id, good: 'stone', queued: false },
    ]);
    runUntil(state, ctx, 2000, () => boat.carry !== null);
    expect(state.players[0].resources.stone).toBe(30);
    partner.buildProgress = 0.5;
    run(state, ctx, 2);
    expect(state.players[0].resources.stone).toBe(50);
    expect(boat.carry).toBeNull();
    expect(boat.orders).toEqual([]);
  });
});
