import { describe, expect, it } from 'vitest';
import { REACH_SLACK, distance, distanceToEntity, entityDistance } from '../../core/geometry';
import { step } from '../../engine';
import type { SimEvent } from '../../events';
import type { Entity, GameState } from '../../types';
import { addBuilding, addUnit, context, data, emptyState, run, runUntil } from '../fixtures';
import { addAnimal } from './fixtures';

const MAX_CHASE = 40;

function carcassOf(state: GameState, type: string): Entity | undefined {
  return Object.values(state.entities).find((entity) => entity.type === type);
}

function gather(villagers: Entity[], target: Entity) {
  return {
    type: 'gather' as const,
    playerId: 0,
    entityIds: villagers.map((villager) => villager.id),
    targetId: target.id,
    queued: false,
  };
}

describe('hunting live animals', () => {
  it('a lone villager kills a gazelle from range and delivers its food', () => {
    const state = emptyState(128);
    const ctx = context();
    addBuilding(state, 'town_center', 0, 60, 63);
    const villager = addUnit(state, 'villager', 0, 64.5, 64.5);
    const gazelle = addAnimal(state, 'gazelle', 71.5, 64.5);
    const start = { x: gazelle.position.x, y: gazelle.position.y };
    const events = run(state, ctx, 1, [gather([villager], gazelle)]);
    expect(events.some((event) => event.type === 'commandRejected')).toBe(false);

    runUntil(state, ctx, 4000, () => state.entities[gazelle.id] === undefined);
    const carcass = carcassOf(state, 'gazelle_carcass');
    expect(carcass).toBeDefined();
    expect(distance(carcass?.position ?? { x: 0, y: 0 }, start)).toBeLessThan(MAX_CHASE);

    runUntil(state, ctx, 4000, () => state.players[0].resources.food > 0);
    expect(state.players[0].resources.food).toBe(data.resources.carryCapacity.hunt);
    expect(state.players[0].stats.foodGathered).toBe(data.resources.carryCapacity.hunt);
    expect(villager.orders[0]).toEqual({ type: 'gather', targetId: carcass?.id });
  });

  it('throws from the hunting range instead of closing in', () => {
    const state = emptyState(48);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 14.5, 20.5);
    const gazelle = addAnimal(state, 'gazelle', 21.5, 20.5);
    const hunting = data.units.villager.hunting;
    expect(hunting).toBeDefined();
    const events: SimEvent[] = run(state, ctx, 1, [gather([villager], gazelle)]);
    while (state.projectiles.length === 0 && state.tick < 400) {
      events.push(...step(state, [], ctx));
    }
    expect(events.some((event) => event.type === 'projectileLaunched')).toBe(true);
    expect(state.projectiles[0]).toMatchObject({
      sourceId: villager.id,
      targetId: gazelle.id,
      damage: hunting?.attack,
      ranged: true,
    });
    const gap = entityDistance(villager, gazelle, data);
    expect(gap).toBeGreaterThan(1);
    expect(gap).toBeLessThanOrEqual((hunting?.range ?? 0) + REACH_SLACK);
    expect(gazelle.position).toEqual({ x: 21.5, y: 20.5 });
  });

  it('several villagers bring down an elephant and gather it', () => {
    const state = emptyState(48);
    const ctx = context();
    addBuilding(state, 'storage_pit', 0, 14, 19);
    const villagers = [0, 1, 2, 3].map((index) => addUnit(state, 'villager', 0, 18.5, 18.5 + index));
    const elephant = addAnimal(state, 'elephant', 25.5, 20.5);
    run(state, ctx, 1, [gather(villagers, elephant)]);

    runUntil(state, ctx, 4000, () => state.entities[elephant.id] === undefined);
    expect(state.entities[elephant.id]).toBeUndefined();
    expect(carcassOf(state, 'elephant_carcass')).toBeDefined();

    runUntil(state, ctx, 4000, () => state.players[0].resources.food > 0);
    expect(state.players[0].resources.food).toBeGreaterThan(0);
  });

  it('moves on to the next animal of the same kind when the carcass runs out', () => {
    const state = emptyState(128);
    const ctx = context();
    addBuilding(state, 'town_center', 0, 60, 63);
    const villager = addUnit(state, 'villager', 0, 64.5, 64.5);
    const gazelle = addAnimal(state, 'gazelle', 71.5, 64.5);
    run(state, ctx, 1, [gather([villager], gazelle)]);
    runUntil(state, ctx, 4000, () => villager.state === 'gathering' && (villager.carry?.amount ?? 0) > 0);
    const carcass = carcassOf(state, 'gazelle_carcass');
    expect(carcass).toBeDefined();
    if (!carcass) {
      return;
    }
    carcass.amount = 1;
    const side = villager.position.x > 64 ? -1 : 1;
    const next = addAnimal(state, 'gazelle', villager.position.x + side * 3.4, villager.position.y);
    addAnimal(state, 'lion', villager.position.x, villager.position.y + 3.9);

    runUntil(state, ctx, 200, () => state.entities[carcass.id] === undefined);
    expect(state.entities[carcass.id]).toBeUndefined();
    runUntil(state, ctx, 5, () => villager.orders[0]?.type === 'attack');
    expect(villager.orders.slice(0, 2)).toEqual([
      { type: 'attack', targetId: next.id },
      { type: 'gather', targetId: next.id },
    ]);
  });

  it('Jihad raises the hunting attack to the villager attack', () => {
    const state = emptyState(48);
    const ctx = context();
    state.players[0].researched.push('jihad');
    const villager = addUnit(state, 'villager', 0, 14.5, 20.5);
    const elephant = addAnimal(state, 'elephant', 21.5, 20.5);
    run(state, ctx, 1, [gather([villager], elephant)]);
    runUntil(state, ctx, 400, () => state.projectiles.length > 0);
    expect(state.projectiles[0]?.damage).toBe(10);
  });
});

describe('villager combat outside hunting', () => {
  it('strikes an enemy building in melee', () => {
    const state = emptyState(48);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 14.5, 20.5);
    const house = addBuilding(state, 'house', 1, 20, 20);
    const full = house.hp;
    const events: SimEvent[] = run(state, ctx, 1, [
      { type: 'attack', playerId: 0, entityIds: [villager.id], targetId: house.id, queued: false },
    ]);
    while (house.hp === full && state.tick < 600) {
      events.push(...step(state, [], ctx));
      expect(state.projectiles).toEqual([]);
    }
    expect(house.hp).toBe(full - data.units.villager.attack);
    expect(events.some((event) => event.type === 'projectileLaunched')).toBe(false);
    const gap = distanceToEntity(villager.position, house, data) - data.units.villager.radius;
    expect(gap).toBeLessThanOrEqual(REACH_SLACK);
  });

  it('strikes an animal in melee on a plain attack order', () => {
    const state = emptyState(48);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 14.5, 20.5);
    const elephant = addAnimal(state, 'elephant', 18.5, 20.5);
    const full = elephant.hp;
    const events: SimEvent[] = run(state, ctx, 1, [
      { type: 'attack', playerId: 0, entityIds: [villager.id], targetId: elephant.id, queued: false },
    ]);
    while (elephant.hp === full && state.tick < 600) {
      events.push(...step(state, [], ctx));
    }
    expect(elephant.hp).toBe(full - data.units.villager.attack);
    expect(events.some((event) => event.type === 'projectileLaunched')).toBe(false);
  });
});
