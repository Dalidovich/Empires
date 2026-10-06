import { describe, expect, it } from 'vitest';
import type { GatherKind, ResourceKind } from '../../../data/types';
import { completeOrder } from '../../core/orders';
import { killEntity } from '../../core/entities';
import { acceptsDropOff, nearestDropOff } from '../../systems/gathering';
import { TERRAIN } from '../../types';
import { addBuilding, addUnit, context, data, emptyState, paint, run, runUntil } from '../fixtures';
import { addAnimal, addSource } from './fixtures';

const LAND_SOURCES: { type: string; resource: ResourceKind; kind: GatherKind }[] = [
  { type: 'berry_bush', resource: 'food', kind: 'forage' },
  { type: 'tree', resource: 'wood', kind: 'wood' },
  { type: 'gold_mine', resource: 'gold', kind: 'gold' },
  { type: 'stone_mine', resource: 'stone', kind: 'stone' },
  { type: 'gazelle_carcass', resource: 'food', kind: 'hunt' },
];

describe('gathering cycle', () => {
  for (const source of LAND_SOURCES) {
    it(`gathers ${source.type}, drops off and returns`, () => {
      const state = emptyState(24);
      const ctx = context();
      addBuilding(state, 'town_center', 0, 4, 4);
      const villager = addUnit(state, 'villager', 0, 9.5, 5.5);
      const node = addSource(state, source.type, 12, 5, 100);
      const capacity = data.resources.carryCapacity[source.kind];
      const events = run(state, ctx, 1, [
        { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: node.id, queued: false },
      ]);
      expect(events.some((event) => event.type === 'commandRejected')).toBe(false);

      runUntil(state, ctx, 4000, () => villager.carry !== null && villager.carry.amount >= capacity);
      expect(villager.carry).toEqual({ kind: source.kind, resource: source.resource, amount: capacity });
      const decayed = source.kind === 'hunt' ? 3 : 0;
      expect(node.amount).toBeLessThanOrEqual(100 - capacity);
      expect(node.amount).toBeGreaterThanOrEqual(100 - capacity - decayed);

      runUntil(state, ctx, 4000, () => state.players[0].resources[source.resource] >= capacity);
      expect(state.players[0].resources[source.resource]).toBe(capacity);
      expect(state.players[0].stats[`${source.resource}Gathered`]).toBe(capacity);

      runUntil(state, ctx, 4000, () => state.players[0].resources[source.resource] >= capacity * 2);
      expect(state.players[0].resources[source.resource]).toBe(capacity * 2);
      expect(villager.orders[0]).toEqual({ type: 'gather', targetId: node.id });
    });
  }

  it('emits gather strike events while working', () => {
    const state = emptyState(24);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 9.5, 5.5);
    const tree = addSource(state, 'tree', 10, 5);
    const events = run(state, ctx, 200, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: tree.id, queued: false },
    ]);
    const strikes = events.filter((event) => event.type === 'gatherStrike');
    expect(strikes.length).toBeGreaterThan(0);
    expect(strikes[0]).toMatchObject({ entityId: villager.id, gatherKind: 'wood' });
  });

  it('lets a villager fish from the shore', () => {
    const state = emptyState(24);
    const ctx = context();
    paint(state, 12, 0, 23, 23, TERRAIN.shallows);
    addBuilding(state, 'storage_pit', 0, 6, 4);
    const villager = addUnit(state, 'villager', 0, 10.5, 5.5);
    const fish = addSource(state, 'shore_fish', 12, 5);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: fish.id, queued: false },
    ]);
    runUntil(state, ctx, 4000, () => state.players[0].resources.food > 0);
    expect(state.players[0].resources.food).toBe(data.resources.carryCapacity.shore_fish);
  });

  it('lets a fishing boat deliver its catch to the dock', () => {
    const state = emptyState(24);
    const ctx = context();
    paint(state, 8, 0, 23, 23, TERRAIN.deepWater);
    addBuilding(state, 'dock', 0, 5, 4);
    const boat = addUnit(state, 'fishing_boat', 0, 10.5, 5.5);
    const fish = addSource(state, 'deep_fish', 14, 5);
    const events = run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [boat.id], targetId: fish.id, queued: false },
    ]);
    expect(events.some((event) => event.type === 'commandRejected')).toBe(false);
    runUntil(state, ctx, 4000, () => state.players[0].resources.food > 0);
    expect(state.players[0].resources.food).toBe(data.resources.carryCapacity.boat_fish);
  });

  it('rejects sources the unit cannot work', () => {
    const state = emptyState(24);
    const ctx = context();
    paint(state, 12, 0, 23, 23, TERRAIN.deepWater);
    const villager = addUnit(state, 'villager', 0, 9.5, 5.5);
    const boat = addUnit(state, 'fishing_boat', 0, 13.5, 5.5);
    const fish = addSource(state, 'deep_fish', 15, 5);
    const tree = addSource(state, 'tree', 5, 5);
    const events = run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: fish.id, queued: false },
      { type: 'gather', playerId: 0, entityIds: [boat.id], targetId: tree.id, queued: false },
      { type: 'gather', playerId: 1, entityIds: [villager.id], targetId: tree.id, queued: false },
    ]);
    const reasons = events
      .filter((event) => event.type === 'commandRejected')
      .map((event) => (event.type === 'commandRejected' ? event.reason : ''));
    expect(reasons).toEqual(['invalid', 'invalid', 'not_owner']);
    expect(villager.orders).toEqual([]);
  });
});

describe('drop-off rules', () => {
  const accepted: Record<string, GatherKind[]> = {
    town_center: ['forage', 'farm', 'wood', 'stone', 'gold', 'hunt', 'shore_fish'],
    granary: ['forage', 'farm'],
    storage_pit: ['wood', 'stone', 'gold', 'hunt', 'shore_fish'],
    dock: ['boat_fish', 'trade'],
  };
  const kinds = Object.keys(data.resources.carryCapacity) as GatherKind[];

  for (const [type, allowed] of Object.entries(accepted)) {
    it(`${type} accepts only its own goods`, () => {
      const state = emptyState(24);
      const building = addBuilding(state, type, 0, 4, 4);
      for (const kind of kinds) {
        expect(acceptsDropOff(state, building, kind, data)).toBe(allowed.includes(kind));
      }
    });
  }

  it('skips nearer buildings that do not accept the carried good', () => {
    const state = emptyState(32);
    const granary = addBuilding(state, 'granary', 0, 10, 4);
    const pit = addBuilding(state, 'storage_pit', 0, 20, 4);
    const villager = addUnit(state, 'villager', 0, 14.5, 5.5);
    expect(nearestDropOff(state, villager, 'forage', data)?.id).toBe(granary.id);
    expect(nearestDropOff(state, villager, 'wood', data)?.id).toBe(pit.id);
    expect(nearestDropOff(state, villager, 'boat_fish', data)).toBeNull();
  });

  it('ignores foundations and foreign buildings', () => {
    const state = emptyState(32);
    const foundation = addBuilding(state, 'storage_pit', 0, 10, 4);
    foundation.buildProgress = 0.5;
    addBuilding(state, 'storage_pit', 1, 16, 4);
    const villager = addUnit(state, 'villager', 0, 14.5, 5.5);
    expect(nearestDropOff(state, villager, 'wood', data)).toBeNull();
  });

  it('carries wood past the granary to the storage pit', () => {
    const state = emptyState(32);
    const ctx = context();
    addBuilding(state, 'granary', 0, 10, 4);
    const pit = addBuilding(state, 'storage_pit', 0, 20, 4);
    const villager = addUnit(state, 'villager', 0, 14.5, 5.5);
    const tree = addSource(state, 'tree', 15, 5);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: tree.id, queued: false },
    ]);
    runUntil(state, ctx, 4000, () => villager.state === 'returning');
    expect(villager.target).toBe(pit.id);
    runUntil(state, ctx, 4000, () => state.players[0].resources.wood > 0);
    expect(state.players[0].resources.wood).toBe(data.resources.carryCapacity.wood);
  });

  it('delivers the load when ordered onto a drop-off building', () => {
    const state = emptyState(24);
    const ctx = context();
    const center = addBuilding(state, 'town_center', 0, 4, 4);
    const villager = addUnit(state, 'villager', 0, 9.5, 5.5);
    villager.carry = { kind: 'gold', resource: 'gold', amount: 7 };
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: center.id, queued: false },
    ]);
    runUntil(state, ctx, 2000, () => villager.orders.length === 0);
    expect(state.players[0].resources.gold).toBe(7);
    expect(villager.carry).toBeNull();
  });
});

describe('depletion', () => {
  it('removes the depleted source and moves to the nearest one in sight', () => {
    const state = emptyState(24);
    const ctx = context();
    addBuilding(state, 'town_center', 0, 4, 4);
    const villager = addUnit(state, 'villager', 0, 9.5, 5.5);
    const first = addSource(state, 'tree', 10, 5, 3);
    const near = addSource(state, 'tree', 10, 7);
    addSource(state, 'tree', 10, 2);
    addSource(state, 'gold_mine', 10, 6);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: first.id, queued: false },
    ]);
    runUntil(state, ctx, 2000, () => state.entities[first.id] === undefined);
    expect(state.entities[first.id]).toBeUndefined();
    expect(state.map.occupancy[5 * 24 + 10]).toBe(0);
    run(state, ctx, 2);
    expect(villager.orders[0]).toEqual({ type: 'gather', targetId: near.id });
    expect(villager.carry?.amount).toBe(3);
  });

  it('delivers the load and idles when nothing of the same kind is in sight', () => {
    const state = emptyState(40);
    const ctx = context();
    addBuilding(state, 'town_center', 0, 4, 4);
    const villager = addUnit(state, 'villager', 0, 9.5, 5.5);
    const first = addSource(state, 'tree', 10, 5, 3);
    addSource(state, 'tree', 30, 30);
    addSource(state, 'gold_mine', 10, 7);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: first.id, queued: false },
    ]);
    runUntil(state, ctx, 4000, () => villager.orders.length === 0);
    expect(villager.orders).toEqual([]);
    expect(villager.state).toBe('idle');
    expect(villager.carry).toBeNull();
    expect(state.players[0].resources.wood).toBe(3);
  });
});

describe('hunting', () => {
  it('turns a gather order on a live animal into an attack followed by gathering', () => {
    const state = emptyState(24);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 9.5, 5.5);
    const elephant = addAnimal(state, 'elephant', 12.5, 5.5);
    run(state, ctx, 1, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: elephant.id, queued: false },
    ]);
    expect(villager.orders).toEqual([
      { type: 'attack', targetId: elephant.id },
      { type: 'gather', targetId: elephant.id },
    ]);
  });

  it('gathers the carcass once the animal is dead', () => {
    const state = emptyState(24);
    const ctx = context();
    addBuilding(state, 'storage_pit', 0, 4, 4);
    const villager = addUnit(state, 'villager', 0, 9.5, 5.5);
    const elephant = addAnimal(state, 'elephant', 12.5, 5.5);
    run(state, ctx, 2, [
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: elephant.id, queued: false },
    ]);
    killEntity(state, elephant.id, ctx, 0);
    completeOrder(villager);
    run(state, ctx, 2);
    const carcass = Object.values(state.entities).find((entity) => entity.type === 'elephant_carcass');
    expect(carcass).toBeDefined();
    expect(villager.orders[0]).toEqual({ type: 'gather', targetId: carcass?.id });
    runUntil(state, ctx, 4000, () => state.players[0].resources.food > 0);
    expect(state.players[0].resources.food).toBe(data.resources.carryCapacity.hunt);
  });
});
