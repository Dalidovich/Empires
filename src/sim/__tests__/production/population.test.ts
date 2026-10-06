import { describe, expect, it } from 'vitest';
import { freePopulation } from '../../systems/population';
import { addBuilding, addUnit, context, run } from '../fixtures';
import { eventsOf, ownedOf, seconds, send, world } from './fixtures';

function settlement() {
  const state = world();
  const center = addBuilding(state, 'town_center', 0, 2, 2);
  for (let i = 0; i < 4; i++) {
    addUnit(state, 'villager', 0, 8.5 + i, 8.5);
  }
  return { state, center, ctx: context() };
}

describe('population', () => {
  it('counts four housing per town center and per house', () => {
    const { state, ctx } = settlement();
    run(state, ctx, 1);
    expect(state.players[0].population).toBe(4);
    expect(state.players[0].housing).toBe(4);
    addBuilding(state, 'house', 0, 12, 2);
    run(state, ctx, 1);
    expect(state.players[0].housing).toBe(8);
    expect(freePopulation(state, 0)).toBe(4);
  });

  it('ignores unfinished houses and drops housing when a house is lost', () => {
    const { state, ctx } = settlement();
    const house = addBuilding(state, 'house', 0, 12, 2);
    house.buildProgress = 0.5;
    run(state, ctx, 1);
    expect(state.players[0].housing).toBe(4);
    house.buildProgress = 1;
    run(state, ctx, 1);
    expect(state.players[0].housing).toBe(8);
    send(state, ctx, { type: 'delete', playerId: 0, entityIds: [house.id] });
    run(state, ctx, 1);
    expect(state.players[0].housing).toBe(4);
  });

  it('pauses production without housing, notifies once and resumes automatically', () => {
    const { state, center, ctx } = settlement();
    const events = run(state, ctx, seconds(30), [
      { type: 'train', playerId: 0, buildingId: center.id, unit: 'villager', count: 2 },
    ]);
    expect(eventsOf(events, 'housingShort')).toHaveLength(1);
    expect(center.queue).toHaveLength(2);
    expect(center.queue[0].progress).toBe(0);
    expect(ownedOf(state, 0, 'villager')).toHaveLength(4);

    addBuilding(state, 'house', 0, 12, 2);
    const resumed = run(state, ctx, seconds(45));
    expect(eventsOf(resumed, 'unitTrained')).toHaveLength(2);
    expect(ownedOf(state, 0, 'villager')).toHaveLength(6);
    expect(state.players[0].population).toBe(6);
  });

  it('stops at the population limit of the game', () => {
    const { state, center, ctx } = settlement();
    state.settings.populationLimit = 5;
    addBuilding(state, 'house', 0, 12, 2);
    const events = run(state, ctx, seconds(60), [
      { type: 'train', playerId: 0, buildingId: center.id, unit: 'villager', count: 2 },
    ]);
    expect(ownedOf(state, 0, 'villager')).toHaveLength(5);
    expect(center.queue).toHaveLength(1);
    expect(eventsOf(events, 'populationLimit')).toHaveLength(1);
    expect(eventsOf(events, 'housingShort')).toHaveLength(0);
  });

  it('does not start more units than the free housing across buildings', () => {
    const { state, center, ctx } = settlement();
    addBuilding(state, 'house', 0, 12, 2);
    state.settings.populationLimit = 5;
    const barracks = addBuilding(state, 'barracks', 0, 16, 2);
    run(state, ctx, seconds(5), [
      { type: 'train', playerId: 0, buildingId: center.id, unit: 'villager', count: 1 },
      { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 1 },
    ]);
    expect(center.queue[0].progress).toBeGreaterThan(0);
    expect(barracks.queue[0].progress).toBe(0);
  });
});
