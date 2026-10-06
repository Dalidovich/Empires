import { describe, expect, it } from 'vitest';
import { killEntity } from '../../core/entities';
import { distance } from '../../core/geometry';
import { addUnit, context, data, emptyState, run } from '../fixtures';
import { addAnimal, addSource } from './fixtures';

describe('carcasses', () => {
  it('appear with the animal food when the animal dies', () => {
    const state = emptyState(24);
    const ctx = context();
    const gazelle = addAnimal(state, 'gazelle', 12.5, 5.5);
    killEntity(state, gazelle.id, ctx, 0);
    const carcass = Object.values(state.entities).find((entity) => entity.type === 'gazelle_carcass');
    expect(carcass?.amount).toBe(data.units.gazelle.animal?.food);
  });

  it('lose food over time and vanish when empty', () => {
    const state = emptyState(24);
    const ctx = context();
    const carcass = addSource(state, 'gazelle_carcass', 12, 5, 3);
    const tree = addSource(state, 'tree', 14, 5, 3);
    const ticksPerFood = data.game.tickRate / data.resources.carcassDecayRate;
    run(state, ctx, Math.ceil(ticksPerFood) + 1);
    expect(carcass.amount).toBe(2);
    expect(tree.amount).toBe(3);
    run(state, ctx, Math.ceil(ticksPerFood * 2));
    expect(state.entities[carcass.id]).toBeUndefined();
    expect(state.entities[tree.id]).toBeDefined();
  });
});

describe('animal behaviour', () => {
  it('gazelles run away from nearby units', () => {
    const state = emptyState(32);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 14.5, 15.5);
    const gazelle = addAnimal(state, 'gazelle', 16.5, 15.5);
    const before = distance(villager.position, gazelle.position);
    run(state, ctx, 60);
    expect(distance(villager.position, gazelle.position)).toBeGreaterThan(before + 2);
    expect(gazelle.position.x).toBeGreaterThan(16.5);
  });

  it('gazelles ignore units outside the aggression radius', () => {
    const state = emptyState(32);
    const ctx = context();
    addUnit(state, 'villager', 0, 6.5, 15.5);
    const gazelle = addAnimal(state, 'gazelle', 16.5, 15.5);
    run(state, ctx, 40);
    expect(gazelle.position).toEqual({ x: 16.5, y: 15.5 });
    expect(gazelle.state).toBe('idle');
  });

  it('lions attack units inside the aggression radius', () => {
    const state = emptyState(32);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 14.5, 15.5);
    const lion = addAnimal(state, 'lion', 16.5, 15.5);
    const far = addAnimal(state, 'lion', 26.5, 15.5);
    run(state, ctx, 6);
    expect(lion.orders).toEqual([{ type: 'attack', targetId: villager.id }]);
    expect(far.orders).toEqual([]);
  });

  it('alligators attack units inside the aggression radius', () => {
    const state = emptyState(32);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 14.5, 15.5);
    const alligator = addAnimal(state, 'alligator', 16.5, 15.5);
    run(state, ctx, 6);
    expect(alligator.orders).toEqual([{ type: 'attack', targetId: villager.id }]);
  });

  it('predators give up on targets that got away', () => {
    const state = emptyState(48);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 40.5, 15.5);
    const lion = addAnimal(state, 'lion', 16.5, 15.5);
    lion.orders = [{ type: 'attack', targetId: villager.id }];
    run(state, ctx, 6);
    expect(lion.orders).toEqual([]);
  });

  it('elephants leave units alone until attacked, then retaliate', () => {
    const state = emptyState(32);
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 15.5, 15.5);
    const elephant = addAnimal(state, 'elephant', 16.5, 15.5);
    run(state, ctx, 6);
    expect(elephant.orders).toEqual([]);
    elephant.lastAttackedTick = state.tick;
    elephant.lastAttackerId = villager.id;
    run(state, ctx, 6);
    expect(elephant.orders).toEqual([{ type: 'attack', targetId: villager.id }]);
  });
});
