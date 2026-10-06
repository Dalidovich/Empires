import { describe, expect, it } from 'vitest';
import type { Command } from '../../commands';
import { deserialize, serialize } from '../../serialize';
import type { Entity } from '../../types';
import { TILE_FREE } from '../../types';
import { addTree, addUnit, context, data, run, runUntil } from '../fixtures';
import { attackCommand, battlefield, eventsOf, seconds } from './fixtures';

function attackGround(
  units: readonly Entity[],
  x: number,
  y: number,
  queued = false,
  playerId = 0,
): Command {
  return {
    type: 'attackGround',
    playerId,
    entityIds: units.map((unit) => unit.id),
    target: { x, y },
    queued,
  };
}

function tileOccupant(entity: Entity, state: ReturnType<typeof battlefield>): number {
  const index = Math.floor(entity.position.y) * state.map.size + Math.floor(entity.position.x);
  return state.map.occupancy[index];
}

describe('attack ground', () => {
  it('rejects units without blast damage', () => {
    const state = battlefield(40);
    const ctx = context();
    const bowman = addUnit(state, 'bowman', 0, 10.5, 10.5);
    const events = run(state, ctx, 1, [attackGround([bowman], 20.5, 10.5)]);
    expect(eventsOf(events, 'commandRejected')).toHaveLength(1);
    expect(bowman.orders).toEqual([]);
  });

  it('rejects units of another owner', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 1, 10.5, 10.5);
    const events = run(state, ctx, 1, [attackGround([thrower], 20.5, 10.5)]);
    expect(eventsOf(events, 'commandRejected')).toHaveLength(1);
    expect(thrower.orders).toEqual([]);
  });

  it('orders only siege units out of a mixed group', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 10.5, 10.5);
    const bowman = addUnit(state, 'bowman', 0, 10.5, 12.5);
    run(state, ctx, 1, [attackGround([thrower, bowman], 18.5, 10.5)]);
    expect(thrower.orders[0]?.type).toBe('attackGround');
    expect(bowman.orders).toEqual([]);
  });

  it('closes the distance until the point is within range', () => {
    const state = battlefield(60);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 5.5, 10.5);
    const range = data.units.stone_thrower.range;
    const target = { x: 5.5 + range + 12, y: 10.5 };
    run(state, ctx, 1, [attackGround([thrower], target.x, target.y)]);
    const ticks = runUntil(state, ctx, seconds(60), () => state.projectiles.length > 0);
    expect(ticks).toBeLessThan(seconds(60));
    expect(thrower.position.x).toBeGreaterThan(5.5 + 10);
    const gap = Math.hypot(thrower.position.x - target.x, thrower.position.y - target.y);
    expect(gap).toBeLessThanOrEqual(range + 0.5);
    expect(gap).toBeGreaterThanOrEqual(data.units.stone_thrower.minRange);
    expect(state.projectiles[0].targetId).toBeNull();
    expect(state.projectiles[0].friendlyFire).toBe(true);
    expect(state.projectiles[0].destination).toEqual(target);
  });

  it('does not fire inside the minimum range', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 10.5, 10.5);
    const events = run(state, ctx, seconds(6), [attackGround([thrower], 11.5, 10.5)]);
    expect(eventsOf(events, 'projectileLaunched')).toHaveLength(0);
    expect(thrower.position).toEqual({ x: 10.5, y: 10.5 });
  });

  it('keeps firing at the point at the attack interval', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 5.5, 10.5);
    const events = run(state, ctx, seconds(16), [attackGround([thrower], 13.5, 10.5)]);
    const interval = data.units.stone_thrower.attackInterval;
    expect(eventsOf(events, 'projectileLaunched').length).toBeGreaterThanOrEqual(3);
    expect(eventsOf(events, 'projectileLaunched').length).toBeLessThanOrEqual(
      Math.ceil(16 / interval) + 1,
    );
    expect(thrower.orders[0]?.type).toBe('attackGround');
  });

  it('hurts units that walk into the point, own units included', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 5.5, 10.5);
    const friend = addUnit(state, 'villager', 0, 14.2, 10.5);
    const enemy = addUnit(state, 'villager', 1, 13.2, 10.5);
    const bystander = addUnit(state, 'villager', 0, 17.5, 10.5);
    run(state, ctx, 1, [attackGround([thrower], 13.5, 10.5)]);
    runUntil(state, ctx, seconds(30), () => state.entities[friend.id] === undefined);
    expect(state.entities[friend.id]).toBeUndefined();
    expect(state.entities[enemy.id]).toBeUndefined();
    expect(bystander.hp).toBe(data.units.villager.hp);
  });

  it('is replaced by a new order', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 5.5, 10.5);
    const far = addUnit(state, 'villager', 1, 5.5, 18.5);
    run(state, ctx, seconds(8), [attackGround([thrower], 13.5, 10.5)]);
    run(state, ctx, 1, [attackCommand(0, [thrower], far)]);
    expect(thrower.orders[0]).toEqual({ type: 'attack', targetId: far.id });
  });

  it('survives a serialization round trip with a queued order', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 5.5, 10.5);
    run(state, ctx, 1, [
      attackGround([thrower], 13.5, 10.5),
      attackGround([thrower], 15.5, 12.5, true),
    ]);
    expect(thrower.orders.map((order) => order.type)).toEqual(['attackGround', 'attackGround']);
    const restored = deserialize(serialize(state, {}));
    expect(restored.state.entities[thrower.id].orders).toEqual(thrower.orders);
    expect(restored.state).toEqual(state);
  });
});

describe('tree felling', () => {
  it('removes trees in the blast and frees their tiles', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 5.5, 10.5);
    const near = addTree(state, 13, 10);
    const outside = addTree(state, 18, 10);
    expect(tileOccupant(near, state)).not.toBe(TILE_FREE);
    run(state, ctx, 1, [attackGround([thrower], 13.5, 10.5)]);
    runUntil(state, ctx, seconds(30), () => state.entities[near.id] === undefined);
    expect(state.entities[near.id]).toBeUndefined();
    expect(state.map.occupancy[10 * state.map.size + 13]).toBe(TILE_FREE);
    expect(state.entities[outside.id]).toBe(outside);
    expect(state.map.occupancy[10 * state.map.size + 18]).toBe(outside.id);
  });

  it('leaves other resources standing', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 5.5, 10.5);
    const gold = addTree(state, 13, 10);
    gold.type = 'gold_mine';
    run(state, ctx, 1, [attackGround([thrower], 13.5, 10.5)]);
    run(state, ctx, seconds(12));
    expect(state.entities[gold.id]).toBe(gold);
  });

  it('is not caused by a single-target arrow', () => {
    const state = battlefield(40);
    const ctx = context();
    const bowman = addUnit(state, 'bowman', 0, 10.5, 10.5);
    const victim = addUnit(state, 'villager', 1, 14.5, 10.5);
    const tree = addTree(state, 14, 11);
    run(state, ctx, 1, [attackCommand(0, [bowman], victim)]);
    run(state, ctx, seconds(3));
    expect(victim.hp).toBeLessThan(data.units.villager.hp);
    expect(state.entities[tree.id]).toBe(tree);
  });
});
