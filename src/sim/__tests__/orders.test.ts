import { describe, expect, it } from 'vitest';
import type { Command } from '../commands';
import { distance } from '../core/geometry';
import { approach, isMoving, navOf } from '../core/movement';
import { completeOrder, currentOrder, entitiesWithOrder, issueOrder } from '../core/orders';
import { step } from '../engine';
import type { Entity } from '../types';
import { addBuilding, addTree, addUnit, context, emptyState, run, runUntil } from './fixtures';

describe('orders and movement', () => {
  it('moves a unit to the target and completes the order', () => {
    const state = emptyState(32);
    const ctx = context();
    const unit = addUnit(state, 'villager', 0, 4.5, 4.5);
    const target = { x: 12.25, y: 9.75 };
    run(state, ctx, 1, [
      { type: 'move', playerId: 0, entityIds: [unit.id], target, queued: false },
    ]);
    expect(unit.orders).toHaveLength(1);
    expect(unit.state).toBe('moving');
    const ticks = runUntil(state, ctx, 400, () => unit.orders.length === 0);
    expect(ticks).toBeLessThan(400);
    expect(distance(unit.position, target)).toBeLessThan(0.05);
    expect(unit.state).toBe('idle');
    expect(unit.path).toBeNull();
    expect(navOf(unit)).toBeNull();
  });

  it('moves at the speed from data', () => {
    const state = emptyState(32);
    const ctx = context();
    const unit = addUnit(state, 'villager', 0, 2.5, 5.5);
    run(state, ctx, 20, [
      { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 25.5, y: 5.5 }, queued: false },
    ]);
    expect(unit.position.x - 2.5).toBeCloseTo(1.1, 1);
  });

  it('visits shift-queued targets in order', () => {
    const state = emptyState(32);
    const ctx = context();
    const unit = addUnit(state, 'villager', 0, 4.5, 4.5);
    const first = { x: 10.5, y: 4.5 };
    const second = { x: 10.5, y: 10.5 };
    const commands: Command[] = [
      { type: 'move', playerId: 0, entityIds: [unit.id], target: first, queued: false },
      { type: 'move', playerId: 0, entityIds: [unit.id], target: second, queued: true },
    ];
    run(state, ctx, 1, commands);
    expect(unit.orders).toHaveLength(2);
    let reachedFirst = false;
    runUntil(state, ctx, 600, () => {
      if (distance(unit.position, first) < 0.1) {
        reachedFirst = true;
      }
      return unit.orders.length === 0;
    });
    expect(reachedFirst).toBe(true);
    expect(distance(unit.position, second)).toBeLessThan(0.05);
  });

  it('replaces the queue with an unqueued order', () => {
    const state = emptyState(32);
    const ctx = context();
    const unit = addUnit(state, 'villager', 0, 4.5, 4.5);
    run(state, ctx, 5, [
      { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 20.5, y: 4.5 }, queued: false },
      { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 20.5, y: 20.5 }, queued: true },
    ]);
    run(state, ctx, 1, [
      { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 4.5, y: 8.5 }, queued: false },
    ]);
    expect(unit.orders).toEqual([{ type: 'move', target: { x: 4.5, y: 8.5 } }]);
  });

  it('stops on command and toggles stand ground', () => {
    const state = emptyState(32);
    const ctx = context();
    const unit = addUnit(state, 'villager', 0, 4.5, 4.5);
    run(state, ctx, 10, [
      { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 20.5, y: 4.5 }, queued: false },
    ]);
    run(state, ctx, 1, [{ type: 'stop', playerId: 0, entityIds: [unit.id] }]);
    const stoppedAt = { ...unit.position };
    run(state, ctx, 10);
    expect(unit.orders).toHaveLength(0);
    expect(unit.state).toBe('idle');
    expect(unit.position).toEqual(stoppedAt);

    run(state, ctx, 1, [{ type: 'standGround', playerId: 0, entityIds: [unit.id], enabled: true }]);
    expect(unit.standGround).toBe(true);
    run(state, ctx, 1, [{ type: 'standGround', playerId: 0, entityIds: [unit.id], enabled: false }]);
    expect(unit.standGround).toBe(false);
  });

  it('rejects commands for units of another player', () => {
    const state = emptyState(32);
    const ctx = context();
    const unit = addUnit(state, 'villager', 1, 4.5, 4.5);
    const events = run(state, ctx, 1, [
      { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 9.5, y: 9.5 }, queued: false },
    ]);
    expect(unit.orders).toHaveLength(0);
    expect(events).toContainEqual({
      type: 'commandRejected',
      playerId: 0,
      command: 'move',
      reason: 'not_owner',
    });
  });

  it('goes to the nearest reachable point when the target is unreachable', () => {
    const state = emptyState(32);
    const ctx = context();
    for (let y = 0; y < 32; y++) {
      addTree(state, 16, y);
    }
    const unit = addUnit(state, 'villager', 0, 10.5, 10.5);
    run(state, ctx, 1, [
      { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 22.5, y: 10.5 }, queued: false },
    ]);
    runUntil(state, ctx, 400, () => unit.orders.length === 0);
    expect(unit.orders).toHaveLength(0);
    expect(distance(unit.position, { x: 15.5, y: 10.5 })).toBeLessThan(0.05);
  });

  it('brings a whole group through a one-tile gap to distinct spots', () => {
    const state = emptyState(48);
    const ctx = context();
    for (let y = 0; y < 48; y++) {
      if (y !== 24) {
        addTree(state, 24, y);
      }
    }
    const units: Entity[] = [];
    for (let i = 0; i < 40; i++) {
      units.push(addUnit(state, 'villager', 0, 6.5 + (i % 8), 20.5 + Math.floor(i / 8)));
    }
    const target = { x: 38.5, y: 24.5 };
    run(state, ctx, 1, [
      {
        type: 'move',
        playerId: 0,
        entityIds: units.map((unit) => unit.id),
        target,
        queued: false,
      },
    ]);
    const ticks = runUntil(state, ctx, 2000, () => units.every((unit) => unit.orders.length === 0));
    expect(ticks).toBeLessThan(2000);
    const tiles = new Set<string>();
    for (const unit of units) {
      expect(distance(unit.position, target)).toBeLessThan(7);
      tiles.add(`${Math.floor(unit.position.x)}:${Math.floor(unit.position.y)}`);
    }
    expect(tiles.size).toBe(40);
  });

  it('lets two groups pass each other head-on in a corridor', () => {
    const state = emptyState(40);
    const ctx = context();
    for (let x = 0; x < 40; x++) {
      addTree(state, x, 18);
      addTree(state, x, 21);
    }
    const left: Entity[] = [];
    const right: Entity[] = [];
    for (let i = 0; i < 6; i++) {
      left.push(addUnit(state, 'villager', 0, 2.5 + Math.floor(i / 2), 19.5 + (i % 2)));
      right.push(addUnit(state, 'villager', 0, 37.5 - Math.floor(i / 2), 19.5 + (i % 2)));
    }
    run(state, ctx, 1, [
      { type: 'move', playerId: 0, entityIds: left.map((u) => u.id), target: { x: 36.5, y: 19.5 }, queued: false },
      { type: 'move', playerId: 0, entityIds: right.map((u) => u.id), target: { x: 3.5, y: 19.5 }, queued: false },
    ]);
    const all = [...left, ...right];
    const ticks = runUntil(state, ctx, 2000, () => all.every((unit) => unit.orders.length === 0));
    expect(ticks).toBeLessThan(2000);
    for (const unit of left) {
      expect(unit.position.x).toBeGreaterThan(30);
    }
    for (const unit of right) {
      expect(unit.position.x).toBeLessThan(10);
    }
  });

  it('approaches a building until in range', () => {
    const state = emptyState(32);
    const ctx = context();
    const building = addBuilding(state, 'town_center', 0, 20, 20);
    const unit = addUnit(state, 'villager', 0, 4.5, 21.5);
    let status = approach(state, unit, building, 0, ctx.data);
    expect(status).toBe('moving');
    for (let i = 0; i < 600 && status === 'moving'; i++) {
      step(state, [], ctx);
      status = approach(state, unit, building, 0, ctx.data);
    }
    expect(status).toBe('arrived');
    expect(unit.position.x).toBeLessThan(20);
    expect(unit.position.x).toBeGreaterThan(19);
    expect(isMoving(unit)).toBe(false);
  });

  it('chases a moving target', () => {
    const state = emptyState(48);
    const ctx = context();
    const hunter = addUnit(state, 'scout', 0, 4.5, 4.5);
    const prey = addUnit(state, 'villager', 1, 20.5, 20.5);
    run(state, ctx, 1, [
      { type: 'move', playerId: 1, entityIds: [prey.id], target: { x: 40.5, y: 20.5 }, queued: false },
    ]);
    let status = approach(state, hunter, prey, 0, ctx.data);
    for (let i = 0; i < 1500 && status !== 'arrived'; i++) {
      step(state, [], ctx);
      status = approach(state, hunter, prey, 0, ctx.data);
    }
    expect(status).toBe('arrived');
    expect(distance(hunter.position, prey.position)).toBeLessThan(1.5);
  });

  it('lets a system claim, progress and complete its own order type', () => {
    const state = emptyState(32);
    const ctx = context();
    const tree = addTree(state, 15, 10);
    const unit = addUnit(state, 'villager', 0, 4.5, 10.5);
    issueOrder(unit, { type: 'gather', targetId: tree.id }, false);
    issueOrder(unit, { type: 'move', target: { x: 4.5, y: 12.5 } }, true);
    let arrivedAt = -1;
    for (let i = 0; i < 600 && unit.orders.length > 0; i++) {
      for (const worker of entitiesWithOrder(state, 'gather')) {
        const order = currentOrder(worker);
        if (order?.type !== 'gather') {
          continue;
        }
        if (approach(state, worker, tree, 0, ctx.data) === 'arrived') {
          arrivedAt = worker.position.x;
          completeOrder(worker);
        }
      }
      step(state, [], ctx);
    }
    expect(arrivedAt).toBeGreaterThan(14);
    expect(unit.orders).toHaveLength(0);
    expect(distance(unit.position, { x: 4.5, y: 12.5 })).toBeLessThan(0.05);
  });

  it('spreads idle units standing on the same spot', () => {
    const state = emptyState(16);
    const ctx = context();
    const first = addUnit(state, 'villager', 0, 8.5, 8.5);
    const second = addUnit(state, 'villager', 0, 8.5, 8.5);
    run(state, ctx, 80);
    expect(distance(first.position, second.position)).toBeGreaterThan(0.3);
    const settled = { ...first.position };
    run(state, ctx, 40);
    expect(first.position).toEqual(settled);
  });
});
