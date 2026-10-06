import { describe, expect, it } from 'vitest';
import type { Command } from '../../commands';
import type { Entity, GameState } from '../../types';
import { addUnit, context, run, runUntil } from '../fixtures';
import { attackCommand, battlefield, eventsOf, research, seconds } from './fixtures';

function runner(state: GameState, x: number): { clubman: Entity; command: Command } {
  const clubman = addUnit(state, 'clubman', 1, x, 6.5);
  return {
    clubman,
    command: {
      type: 'move',
      playerId: 1,
      entityIds: [clubman.id],
      target: { x, y: 24.5 },
      queued: false,
    },
  };
}

describe('projectiles', () => {
  it('deal damage only after the flight time', () => {
    const state = battlefield();
    const ctx = context();
    const bowman = addUnit(state, 'bowman', 0, 10.5, 10.5);
    const villager = addUnit(state, 'villager', 1, 14.5, 10.5);
    const events = run(state, ctx, 1, [attackCommand(0, [bowman], villager)]);
    expect(eventsOf(events, 'projectileLaunched')).toHaveLength(1);
    expect(state.projectiles).toHaveLength(1);
    const projectile = state.projectiles[0];
    expect(projectile.arriveTick - projectile.launchTick).toBe(Math.ceil((4 / 7) * 20));
    expect(villager.hp).toBe(25);
    run(state, ctx, projectile.arriveTick - state.tick);
    expect(villager.hp).toBe(25);
    const impact = run(state, ctx, 1);
    expect(villager.hp).toBe(22);
    expect(eventsOf(impact, 'attackHit')).toHaveLength(1);
    expect(state.projectiles.some((flying) => flying.id === projectile.id)).toBe(false);
  });

  it('miss a moving target without ballistics', () => {
    const state = battlefield();
    const ctx = context();
    const { clubman, command } = runner(state, 15);
    run(state, ctx, seconds(2.5), [command]);
    const bowman = addUnit(state, 'bowman', 0, 10.5, 10.5);
    run(state, ctx, 1, [attackCommand(0, [bowman], clubman)]);
    expect(state.projectiles).toHaveLength(1);
    const arrive = state.projectiles[0].arriveTick;
    run(state, ctx, arrive - state.tick + 1);
    expect(clubman.hp).toBe(40);
  });

  it('lead a moving target with ballistics', () => {
    const state = battlefield();
    const ctx = context();
    research(state, 0, 'ballistics');
    const { clubman, command } = runner(state, 15);
    run(state, ctx, seconds(2.5), [command]);
    const bowman = addUnit(state, 'bowman', 0, 10.5, 10.5);
    run(state, ctx, 1, [attackCommand(0, [bowman], clubman)]);
    expect(state.projectiles).toHaveLength(1);
    const arrive = state.projectiles[0].arriveTick;
    run(state, ctx, arrive - state.tick + 1);
    expect(clubman.hp).toBe(37);
  });

  it('explode over the blast radius including friendly units', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 5.5, 10.5);
    const enemy = addUnit(state, 'villager', 1, 13.5, 10.5);
    const friend = addUnit(state, 'villager', 0, 14.2, 10.5);
    const bystander = addUnit(state, 'villager', 0, 17.5, 10.5);
    const events = run(state, ctx, 1, [attackCommand(0, [thrower], enemy)]);
    expect(eventsOf(events, 'projectileLaunched')).toHaveLength(1);
    expect(state.projectiles[0].friendlyFire).toBe(true);
    runUntil(state, ctx, 200, () => state.entities[enemy.id] === undefined);
    expect(state.entities[enemy.id]).toBeUndefined();
    expect(state.entities[friend.id]).toBeUndefined();
    expect(state.entities[bystander.id]).toBe(bystander);
    expect(bystander.hp).toBe(25);
    expect(state.players[0].stats.unitsKilled).toBe(1);
    expect(state.players[0].stats.unitsLost).toBe(1);
  });

  it('are not launched inside the minimum range', () => {
    const state = battlefield(40);
    const ctx = context();
    const thrower = addUnit(state, 'stone_thrower', 0, 10.5, 10.5);
    const close = addUnit(state, 'villager', 1, 12.0, 10.5);
    const far = addUnit(state, 'villager', 1, 10.5, 16.5);
    const blocked = run(state, ctx, seconds(6), [attackCommand(0, [thrower], close)]);
    expect(eventsOf(blocked, 'projectileLaunched')).toHaveLength(0);
    expect(close.hp).toBe(25);
    expect(thrower.position).toEqual({ x: 10.5, y: 10.5 });
    const allowed = run(state, ctx, 1, [attackCommand(0, [thrower], far)]);
    expect(eventsOf(allowed, 'projectileLaunched')).toHaveLength(1);
  });
});
