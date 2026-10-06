import { describe, expect, it } from 'vitest';
import type { Command } from '../../commands';
import { distance } from '../../core/geometry';
import type { Entity } from '../../types';
import { addBuilding, addUnit, context, run, runUntil } from '../fixtures';
import { addFoundation, attackCommand, battlefield, eventsOf, seconds } from './fixtures';

function moveCommand(unit: Entity, x: number, y: number): Command {
  return {
    type: 'move',
    playerId: unit.owner,
    entityIds: [unit.id],
    target: { x, y },
    queued: false,
  };
}

describe('towers', () => {
  it('shoot enemies in range automatically', () => {
    const state = battlefield();
    const ctx = context();
    const tower = addBuilding(state, 'watch_tower', 0, 10, 10);
    const villager = addUnit(state, 'villager', 1, 14.5, 11);
    const outside = addUnit(state, 'villager', 1, 22.5, 11);
    const events = run(state, ctx, seconds(3));
    expect(eventsOf(events, 'projectileLaunched')[0]).toMatchObject({ sourceId: tower.id });
    expect(villager.hp).toBeLessThan(25);
    expect(outside.hp).toBe(25);
  });

  it('stay silent while under construction', () => {
    const state = battlefield();
    const ctx = context();
    addFoundation(state, 'watch_tower', 0, 10, 10);
    const villager = addUnit(state, 'villager', 1, 14.5, 11);
    const events = run(state, ctx, seconds(3));
    expect(eventsOf(events, 'projectileLaunched')).toHaveLength(0);
    expect(villager.hp).toBe(25);
  });

  it('ignore neutral and allied units', () => {
    for (const stance of ['neutral', 'ally'] as const) {
      const state = battlefield(32, stance);
      const ctx = context();
      addBuilding(state, 'watch_tower', 0, 10, 10);
      const villager = addUnit(state, 'villager', 1, 14.5, 11);
      run(state, ctx, seconds(3));
      expect(villager.hp).toBe(25);
    }
  });
});

describe('idle auto-targeting', () => {
  it('engages an enemy entering the line of sight and returns afterwards', () => {
    const state = battlefield();
    const ctx = context();
    const clubman = addUnit(state, 'clubman', 0, 10.5, 10.5);
    const villager = addUnit(state, 'villager', 1, 13.5, 10.5);
    const hidden = addUnit(state, 'villager', 1, 20.5, 10.5);
    runUntil(state, ctx, 600, () => state.entities[villager.id] === undefined);
    expect(state.entities[villager.id]).toBeUndefined();
    expect(clubman.position.x).toBeGreaterThan(12);
    runUntil(state, ctx, 200, () => clubman.orders.length === 0 && clubman.anchor === null);
    expect(distance(clubman.position, { x: 10.5, y: 10.5 })).toBeLessThan(0.5);
    expect(clubman.state).toBe('idle');
    expect(hidden.hp).toBe(25);
  });

  it('gives up the chase and returns when the target gets away', () => {
    const state = battlefield(48);
    const ctx = context();
    const clubman = addUnit(state, 'clubman', 0, 10.5, 10.5);
    const scout = addUnit(state, 'scout', 1, 13.5, 10.5);
    run(state, ctx, 10);
    expect(clubman.orders[0]).toEqual({ type: 'attack', targetId: scout.id });
    run(state, ctx, seconds(20), [moveCommand(scout, 44.5, 10.5)]);
    expect(clubman.orders).toHaveLength(0);
    expect(clubman.anchor).toBeNull();
    expect(distance(clubman.position, { x: 10.5, y: 10.5 })).toBeLessThan(0.5);
  });

  it('does not engage for civilians', () => {
    const state = battlefield();
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 10.5, 10.5);
    const enemy = addUnit(state, 'villager', 1, 12.5, 10.5);
    run(state, ctx, seconds(2));
    expect(villager.orders).toHaveLength(0);
    expect(enemy.hp).toBe(25);
  });

  it('respects stand ground', () => {
    const state = battlefield();
    const ctx = context();
    const clubman = addUnit(state, 'clubman', 0, 10.5, 10.5);
    const bowman = addUnit(state, 'bowman', 0, 10.5, 20.5);
    const beyondReach = addUnit(state, 'villager', 1, 13.5, 10.5);
    const inRange = addUnit(state, 'villager', 1, 14.5, 20.5);
    const beyondRange = addUnit(state, 'villager', 1, 10.5, 26.9);
    run(state, ctx, seconds(4), [
      { type: 'standGround', playerId: 0, entityIds: [clubman.id, bowman.id], enabled: true },
    ]);
    expect(clubman.position).toEqual({ x: 10.5, y: 10.5 });
    expect(bowman.position).toEqual({ x: 10.5, y: 20.5 });
    expect(beyondReach.hp).toBe(25);
    expect(inRange.hp).toBeLessThan(25);
    expect(beyondRange.hp).toBe(25);
  });

  it('drops the return trip when the player takes over', () => {
    const state = battlefield();
    const ctx = context();
    const clubman = addUnit(state, 'clubman', 0, 10.5, 10.5);
    addUnit(state, 'villager', 1, 13.5, 10.5);
    run(state, ctx, 10);
    expect(clubman.anchor).toEqual({ x: 10.5, y: 10.5 });
    run(state, ctx, 2, [moveCommand(clubman, 10.5, 25.5)]);
    expect(clubman.anchor).toBeNull();
    runUntil(state, ctx, 600, () => clubman.orders.length === 0);
    run(state, ctx, 20);
    expect(distance(clubman.position, { x: 10.5, y: 25.5 })).toBeLessThan(0.5);
  });
});

describe('diplomacy', () => {
  it('never auto-attacks neutral or allied players', () => {
    for (const stance of ['neutral', 'ally'] as const) {
      const state = battlefield(32, stance);
      const ctx = context();
      const clubman = addUnit(state, 'clubman', 0, 10.5, 10.5);
      const other = addUnit(state, 'clubman', 1, 12.5, 10.5);
      run(state, ctx, seconds(3));
      expect(clubman.orders).toHaveLength(0);
      expect(other.orders).toHaveLength(0);
      expect(other.hp).toBe(40);
    }
  });

  it('attacks neutrals on a direct order and neutrals retaliate', () => {
    const state = battlefield(32, 'neutral');
    const ctx = context();
    const clubman = addUnit(state, 'clubman', 0, 10.5, 10.5);
    const neutral = addUnit(state, 'clubman', 1, 11.3, 10.5);
    run(state, ctx, seconds(4), [attackCommand(0, [clubman], neutral)]);
    expect(neutral.hp).toBeLessThan(40);
    expect(neutral.orders[0]).toEqual({ type: 'attack', targetId: clubman.id });
    expect(clubman.hp).toBeLessThan(40);
  });
});

describe('attack-move', () => {
  it('fights enemies met on the way and then resumes the march', () => {
    const state = battlefield(40);
    const ctx = context();
    const clubman = addUnit(state, 'clubman', 0, 5.5, 10.5);
    const villager = addUnit(state, 'villager', 1, 15.5, 12.5);
    run(state, ctx, 1, [
      {
        type: 'attackMove',
        playerId: 0,
        entityIds: [clubman.id],
        target: { x: 28.5, y: 10.5 },
        queued: false,
      },
    ]);
    expect(clubman.orders[0].type).toBe('attackMove');
    runUntil(state, ctx, 900, () => state.entities[villager.id] === undefined);
    expect(state.entities[villager.id]).toBeUndefined();
    run(state, ctx, 2);
    expect(clubman.orders[0]?.type).toBe('attackMove');
    runUntil(state, ctx, 600, () => clubman.orders.length === 0);
    expect(distance(clubman.position, { x: 28.5, y: 10.5 })).toBeLessThan(0.5);
  });

  it('is a plain march for units that cannot fight', () => {
    const state = battlefield(40);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 5.5, 10.5);
    const enemy = addUnit(state, 'villager', 1, 10.5, 11.5);
    run(state, ctx, 1, [
      {
        type: 'attackMove',
        playerId: 0,
        entityIds: [villager.id],
        target: { x: 15.5, y: 10.5 },
        queued: false,
      },
    ]);
    runUntil(state, ctx, 600, () => villager.orders.length === 0);
    expect(distance(villager.position, { x: 15.5, y: 10.5 })).toBeLessThan(0.5);
    expect(enemy.hp).toBe(25);
  });
});
