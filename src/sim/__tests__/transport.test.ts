import { describe, expect, it } from 'vitest';
import { killEntity } from '../core/entities';
import { isPositionPassable } from '../core/navgrid';
import { entitiesInRadius } from '../core/spatial';
import { buildPlayerView } from '../snapshot';
import type { Entity, GameState } from '../types';
import { TERRAIN } from '../types';
import { addUnit, context, data, emptyState, paint, run, runUntil } from './fixtures';

function strait(): GameState {
  const state = emptyState(32);
  paint(state, 12, 0, 19, 31, TERRAIN.deepWater);
  return state;
}

function villagers(state: GameState, count: number): Entity[] {
  const units: Entity[] = [];
  for (let i = 0; i < count; i++) {
    units.push(addUnit(state, 'villager', 0, 8.5 + (i % 3), 9.5 + Math.floor(i / 3)));
  }
  return units;
}

describe('transport', () => {
  it('loads at the shore, sails and unloads on the far shore', () => {
    const state = strait();
    const ctx = context();
    const ship = addUnit(state, 'light_transport', 0, 15.5, 10.5);
    const passengers = villagers(state, 3);
    const ids = passengers.map((unit) => unit.id);
    run(state, ctx, 1, [
      { type: 'load', playerId: 0, entityIds: ids, transportId: ship.id, queued: false },
    ]);
    const loadTicks = runUntil(state, ctx, 1200, () => ship.cargo.length === 3);
    expect(loadTicks).toBeLessThan(1200);
    for (const unit of passengers) {
      expect(unit.carriedBy).toBe(ship.id);
      expect(unit.state).toBe('carried');
      expect(unit.orders).toHaveLength(0);
    }
    expect(entitiesInRadius(state, ship.position, 3).map((entity) => entity.id)).toEqual([ship.id]);
    const view = buildPlayerView(state, 0, data);
    expect(view.entities.map((entity) => entity.id)).toEqual([ship.id]);
    expect([...(view.entities[0].own?.cargo ?? [])].sort((a, b) => a - b)).toEqual(ids);

    run(state, ctx, 1, [
      {
        type: 'unload',
        playerId: 0,
        entityIds: [ship.id],
        target: { x: 24.5, y: 20.5 },
        queued: false,
      },
    ]);
    const sailTicks = runUntil(state, ctx, 1200, () => ship.orders.length === 0);
    expect(sailTicks).toBeLessThan(1200);
    expect(ship.cargo).toHaveLength(0);
    expect(ship.position.x).toBeGreaterThan(18);
    const tiles = new Set<string>();
    for (const unit of passengers) {
      expect(unit.carriedBy).toBeNull();
      expect(unit.state).toBe('idle');
      expect(unit.position.x).toBeGreaterThanOrEqual(20);
      expect(isPositionPassable(state, data, 'land', unit.position)).toBe(true);
      tiles.add(`${Math.floor(unit.position.x)}:${Math.floor(unit.position.y)}`);
    }
    expect(tiles.size).toBe(3);
    expect(entitiesInRadius(state, { x: 21, y: 20 }, 6).length).toBeGreaterThanOrEqual(3);
  });

  it('respects the capacity from data', () => {
    const state = strait();
    const ctx = context();
    const ship = addUnit(state, 'light_transport', 0, 13.5, 10.5);
    const capacity = data.units.light_transport.transportCapacity ?? 0;
    const passengers = villagers(state, capacity + 1);
    run(state, ctx, 1, [
      {
        type: 'load',
        playerId: 0,
        entityIds: passengers.map((unit) => unit.id),
        transportId: ship.id,
        queued: false,
      },
    ]);
    runUntil(state, ctx, 1200, () => passengers.every((unit) => unit.orders.length === 0));
    expect(ship.cargo).toHaveLength(capacity);
    const left = passengers.filter((unit) => unit.carriedBy === null);
    expect(left).toHaveLength(1);
    expect(left[0].orders).toHaveLength(0);

    const events = run(state, ctx, 1, [
      { type: 'load', playerId: 0, entityIds: [left[0].id], transportId: ship.id, queued: false },
    ]);
    expect(events).toContainEqual({
      type: 'commandRejected',
      playerId: 0,
      command: 'load',
      reason: 'busy',
    });
  });

  it('rejects ships as passengers and foreign transports', () => {
    const state = strait();
    const ctx = context();
    const ship = addUnit(state, 'light_transport', 0, 13.5, 10.5);
    const other = addUnit(state, 'light_transport', 0, 13.5, 14.5);
    const foreign = addUnit(state, 'light_transport', 1, 13.5, 18.5);
    const [villager] = villagers(state, 1);
    const events = run(state, ctx, 1, [
      { type: 'load', playerId: 0, entityIds: [other.id], transportId: ship.id, queued: false },
      { type: 'load', playerId: 0, entityIds: [villager.id], transportId: foreign.id, queued: false },
    ]);
    expect(events.filter((event) => event.type === 'commandRejected')).toHaveLength(2);
    expect(other.orders).toHaveLength(0);
    expect(villager.orders).toHaveLength(0);
  });

  it('keeps the cargo aboard when there is no shore in reach', () => {
    const state = emptyState(48);
    paint(state, 8, 0, 47, 47, TERRAIN.deepWater);
    const ctx = context();
    const ship = addUnit(state, 'light_transport', 0, 9.5, 10.5);
    const [villager] = villagers(state, 1);
    villager.position.x = 7.5;
    villager.position.y = 10.5;
    run(state, ctx, 1, [
      { type: 'load', playerId: 0, entityIds: [villager.id], transportId: ship.id, queued: false },
    ]);
    runUntil(state, ctx, 400, () => ship.cargo.length === 1);
    run(state, ctx, 1, [
      { type: 'unload', playerId: 0, entityIds: [ship.id], target: { x: 30.5, y: 30.5 }, queued: false },
    ]);
    runUntil(state, ctx, 1500, () => ship.orders.length === 0);
    expect(ship.orders).toHaveLength(0);
    expect(ship.cargo).toEqual([villager.id]);
    expect(villager.carriedBy).toBe(ship.id);
  });

  it('kills the cargo together with the transport', () => {
    const state = strait();
    const ctx = context();
    const ship = addUnit(state, 'light_transport', 0, 13.5, 10.5);
    const passengers = villagers(state, 2);
    run(state, ctx, 1, [
      {
        type: 'load',
        playerId: 0,
        entityIds: passengers.map((unit) => unit.id),
        transportId: ship.id,
        queued: false,
      },
    ]);
    runUntil(state, ctx, 1200, () => ship.cargo.length === 2);
    killEntity(state, ship.id, ctx, 1);
    expect(Object.keys(state.entities)).toHaveLength(0);
    const died = ctx.events.filter((event) => event.type === 'entityDied');
    expect(died).toHaveLength(3);
    expect(state.players[0].stats.unitsLost).toBe(3);
    expect(state.players[1].stats.unitsKilled).toBe(3);
  });
});
