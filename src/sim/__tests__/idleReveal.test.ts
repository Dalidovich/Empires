import { describe, expect, it } from 'vitest';
import { distance } from '../core/geometry';
import { occludingBuilding } from '../systems/idleReveal';
import { addBuilding, addUnit, context, data, emptyState, run, runUntil } from './fixtures';

describe('idle units hidden behind buildings', () => {
  it('detects points behind a building and ignores points in front of it', () => {
    const state = emptyState(32);
    const house = addBuilding(state, 'house', 0, 10, 10);
    expect(occludingBuilding(state, data, { x: 9.5, y: 9.5 })?.id).toBe(house.id);
    expect(occludingBuilding(state, data, { x: 8.5, y: 8.5 })?.id).toBe(house.id);
    expect(occludingBuilding(state, data, { x: 12.5, y: 12.5 })).toBeNull();
    expect(occludingBuilding(state, data, { x: 7.5, y: 7.5 })).toBeNull();
  });

  it('walks a hidden idle unit to a visible tile', () => {
    const state = emptyState(32);
    const ctx = context();
    addBuilding(state, 'house', 0, 10, 10);
    const unit = addUnit(state, 'villager', 0, 9.5, 9.5);
    run(state, ctx, 2);
    expect(unit.orders).toHaveLength(1);
    const ticks = runUntil(state, ctx, 400, () => unit.orders.length === 0);
    expect(ticks).toBeLessThan(400);
    expect(occludingBuilding(state, data, unit.position)).toBeNull();
    run(state, ctx, 40);
    expect(unit.orders).toHaveLength(0);
    expect(occludingBuilding(state, data, unit.position)).toBeNull();
  });

  it('sends a hidden idle unit to the rally point of its own building', () => {
    const state = emptyState(32);
    const ctx = context();
    const house = addBuilding(state, 'house', 0, 10, 10);
    const rally = { x: 16.5, y: 15.5 };
    house.rallyPoint = { position: rally, targetId: null };
    const unit = addUnit(state, 'villager', 0, 9.5, 9.5);
    run(state, ctx, 2);
    runUntil(state, ctx, 600, () => unit.orders.length === 0);
    expect(distance(unit.position, rally)).toBeLessThan(0.05);
  });

  it('gives each hidden unit its own tile', () => {
    const state = emptyState(32);
    const ctx = context();
    addBuilding(state, 'house', 0, 10, 10);
    const first = addUnit(state, 'villager', 0, 9.5, 9.5);
    const second = addUnit(state, 'villager', 0, 8.5, 9.5);
    run(state, ctx, 1);
    expect(first.orders).toHaveLength(1);
    expect(second.orders).toHaveLength(1);
    expect(first.orders[0]).not.toEqual(second.orders[0]);
  });

  it('leaves visible, standing ground and computer-controlled units alone', () => {
    const state = emptyState(32);
    const ctx = context();
    state.players[1].kind = 'ai';
    addBuilding(state, 'house', 0, 10, 10);
    const visible = addUnit(state, 'villager', 0, 13.5, 13.5);
    const guard = addUnit(state, 'villager', 0, 9.5, 9.5);
    guard.standGround = true;
    const computer = addUnit(state, 'villager', 1, 8.5, 9.5);
    run(state, ctx, 30);
    expect(visible.position).toEqual({ x: 13.5, y: 13.5 });
    expect(guard.position).toEqual({ x: 9.5, y: 9.5 });
    expect(computer.position).toEqual({ x: 8.5, y: 9.5 });
  });
});
