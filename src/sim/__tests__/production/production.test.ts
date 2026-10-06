import { describe, expect, it } from 'vitest';
import { distanceToEntity } from '../../core/geometry';
import { MAX_QUEUE_LENGTH } from '../../effects';
import { addBuilding, addTree, context, data, run, runUntil } from '../fixtures';
import { eventsOf, ownedOf, rejections, seconds, send, world } from './fixtures';

function camp() {
  const state = world();
  const center = addBuilding(state, 'town_center', 0, 2, 2);
  addBuilding(state, 'house', 0, 8, 2);
  addBuilding(state, 'house', 0, 8, 5);
  const barracks = addBuilding(state, 'barracks', 0, 14, 2);
  return { state, center, barracks, ctx: context() };
}

describe('production', () => {
  it('queues several units, charges each and trains them one after another', () => {
    const { state, barracks, ctx } = camp();
    send(state, ctx, { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 3 });
    expect(barracks.queue).toHaveLength(3);
    expect(state.players[0].resources.food).toBe(5000 - 150);
    expect(barracks.state).toBe('producing');

    const first = run(state, ctx, seconds(27));
    expect(eventsOf(first, 'unitTrained')).toHaveLength(1);
    expect(barracks.queue).toHaveLength(2);
    const clubman = ownedOf(state, 0, 'clubman')[0];
    expect(distanceToEntity(clubman.position, barracks, data)).toBeLessThan(2);
    expect(clubman.hp).toBe(40);

    run(state, ctx, seconds(27 * 2));
    expect(ownedOf(state, 0, 'clubman')).toHaveLength(3);
    expect(barracks.queue).toHaveLength(0);
    expect(barracks.state).toBe('idle');
    expect(state.players[0].stats.unitsTrained).toBe(3);
  });

  it('cancels any queue item with a full refund', () => {
    const { state, barracks, ctx } = camp();
    send(state, ctx, { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 3 });
    run(state, ctx, seconds(5));
    const progress = barracks.queue[0].progress;
    send(state, ctx, { type: 'cancelQueueItem', playerId: 0, buildingId: barracks.id, index: 1 });
    expect(barracks.queue).toHaveLength(2);
    expect(state.players[0].resources.food).toBe(5000 - 100);
    expect(barracks.queue[0].progress).toBeGreaterThanOrEqual(progress);

    send(state, ctx, { type: 'cancelQueueItem', playerId: 0, buildingId: barracks.id, index: 0 });
    expect(barracks.queue).toHaveLength(1);
    expect(barracks.queue[0].progress).toBeLessThan(progress);
    expect(state.players[0].resources.food).toBe(5000 - 50);

    const events = send(state, ctx, {
      type: 'cancelQueueItem',
      playerId: 0,
      buildingId: barracks.id,
      index: 5,
    });
    expect(rejections(events)).toEqual(['invalid']);
  });

  it('queues only what the player can afford', () => {
    const { state, barracks, ctx } = camp();
    state.players[0].resources.food = 120;
    send(state, ctx, { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 5 });
    expect(barracks.queue).toHaveLength(2);
    expect(state.players[0].resources.food).toBe(20);
    const events = send(state, ctx, {
      type: 'train',
      playerId: 0,
      buildingId: barracks.id,
      unit: 'clubman',
      count: 1,
    });
    expect(rejections(events)).toEqual(['resources']);
    expect(eventsOf(events, 'insufficientResources')[0].resource).toBe('food');
  });

  it('caps the queue length', () => {
    const { state, barracks, ctx } = camp();
    send(state, ctx, { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 99 });
    expect(barracks.queue).toHaveLength(MAX_QUEUE_LENGTH);
    const events = send(state, ctx, {
      type: 'train',
      playerId: 0,
      buildingId: barracks.id,
      unit: 'clubman',
      count: 1,
    });
    expect(rejections(events)).toEqual(['busy']);
  });

  it('rejects units of another building, age, civilization or owner', () => {
    const { state, center, barracks, ctx } = camp();
    const train = (buildingId: number, unit: string, playerId = 0) =>
      rejections(send(state, ctx, { type: 'train', playerId, buildingId, unit, count: 1 }));
    expect(train(center.id, 'clubman')).toEqual(['invalid']);
    expect(train(barracks.id, 'axeman')).toEqual(['age']);
    expect(train(barracks.id, 'clubman', 1)).toEqual(['not_owner']);
    state.players[0].age = 'iron';
    expect(train(barracks.id, 'short_swordsman')).toEqual(['prerequisite']);
    const stable = addBuilding(state, 'stable', 0, 14, 8);
    expect(train(stable.id, 'chariot')).toEqual(['unavailable']);
    state.players[0].researched.push('short_sword');
    expect(train(barracks.id, 'short_swordsman')).toEqual([]);
  });

  it('trains the upgraded unit of a line after the upgrade', () => {
    const { state, barracks, ctx } = camp();
    state.players[0].age = 'tool';
    state.players[0].researched.push('battle_axe');
    send(state, ctx, { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 1 });
    expect(barracks.queue[0].unit).toBe('axeman');
  });

  it('sends new units to the rally point', () => {
    const { state, barracks, ctx } = camp();
    send(
      state,
      ctx,
      { type: 'setRallyPoint', playerId: 0, buildingIds: [barracks.id], position: { x: 20.5, y: 20.5 }, targetId: null },
      { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 1 },
    );
    runUntil(state, ctx, seconds(40), () => ownedOf(state, 0, 'clubman').length > 0);
    const clubman = ownedOf(state, 0, 'clubman')[0];
    expect(clubman.orders[0]).toEqual({ type: 'move', target: { x: 20.5, y: 20.5 } });
    run(state, ctx, seconds(30));
    expect(Math.hypot(clubman.position.x - 20.5, clubman.position.y - 20.5)).toBeLessThan(1.5);
  });

  it('makes new villagers gather the resource under the rally point', () => {
    const { state, center, ctx } = camp();
    const tree = addTree(state, 4, 12);
    send(
      state,
      ctx,
      { type: 'setRallyPoint', playerId: 0, buildingIds: [center.id], position: { x: 4.5, y: 12.5 }, targetId: tree.id },
      { type: 'train', playerId: 0, buildingId: center.id, unit: 'villager', count: 1 },
    );
    runUntil(state, ctx, seconds(30), () => ownedOf(state, 0, 'villager').length > 0);
    const villager = ownedOf(state, 0, 'villager')[0];
    expect(villager.orders[0]).toEqual({ type: 'gather', targetId: tree.id });
    runUntil(state, ctx, seconds(60), () => (villager.carry?.amount ?? 0) > 0);
    expect(villager.carry?.resource).toBe('wood');
  });

  it('rejects a rally point for foreign buildings', () => {
    const { state, barracks, ctx } = camp();
    const events = send(state, ctx, {
      type: 'setRallyPoint',
      playerId: 1,
      buildingIds: [barracks.id],
      position: { x: 5, y: 5 },
      targetId: null,
    });
    expect(rejections(events)).toEqual(['not_owner']);
    expect(barracks.rallyPoint).toBeNull();
  });
});
