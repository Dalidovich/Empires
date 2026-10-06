import { describe, expect, it } from 'vitest';
import { availableActions, hasTechnology } from '../../effects';
import { addBuilding, context, data, run } from '../fixtures';
import { eventsOf, rejections, seconds, send, world } from './fixtures';

function town() {
  const state = world();
  const center = addBuilding(state, 'town_center', 0, 2, 2);
  return { state, center, ctx: context() };
}

describe('ages', () => {
  it('requires two different qualifying buildings of the current age', () => {
    const { state, center, ctx } = town();
    const advance = () =>
      rejections(
        send(state, ctx, { type: 'research', playerId: 0, buildingId: center.id, technology: 'tool_age' }),
      );
    expect(advance()).toEqual(['prerequisite']);
    addBuilding(state, 'barracks', 0, 8, 2);
    addBuilding(state, 'barracks', 0, 12, 2);
    expect(advance()).toEqual(['prerequisite']);
    const granary = addBuilding(state, 'granary', 0, 16, 2);
    granary.buildProgress = 0.5;
    expect(advance()).toEqual(['prerequisite']);
    granary.buildProgress = 1;
    expect(advance()).toEqual([]);
    expect(center.research?.technology).toBe('tool_age');
  });

  it('advances after the research time, charges the cost and notifies', () => {
    const { state, center, ctx } = town();
    addBuilding(state, 'barracks', 0, 8, 2);
    addBuilding(state, 'granary', 0, 12, 2);
    send(state, ctx, { type: 'research', playerId: 0, buildingId: center.id, technology: 'tool_age' });
    expect(state.players[0].resources.food).toBe(5000 - 500);

    const early = run(state, ctx, seconds(119));
    expect(state.players[0].age).toBe('stone');
    expect(eventsOf(early, 'ageAdvanced')).toHaveLength(0);

    const events = run(state, ctx, seconds(1));
    expect(state.players[0].age).toBe('tool');
    expect(eventsOf(events, 'ageAdvanced')).toEqual([{ type: 'ageAdvanced', playerId: 0, age: 'tool' }]);
    expect(state.players[0].stats.toolAgeTick).toBeGreaterThan(seconds(119));
    expect(state.players[1].age).toBe('stone');
  });

  it('takes the costs and times of the three transitions from data', () => {
    expect(data.technologies.tool_age.cost).toEqual({ food: 500 });
    expect(data.technologies.bronze_age.cost).toEqual({ food: 800 });
    expect(data.technologies.iron_age.cost).toEqual({ food: 1000, gold: 800 });
    expect(data.technologies.tool_age.researchTime).toBe(120);
    expect(data.technologies.bronze_age.researchTime).toBe(140);
    expect(data.technologies.iron_age.researchTime).toBe(160);
  });

  it('rejects the transition without resources', () => {
    const { state, center, ctx } = town();
    addBuilding(state, 'barracks', 0, 8, 2);
    addBuilding(state, 'granary', 0, 12, 2);
    state.players[0].resources.food = 499;
    const events = send(state, ctx, {
      type: 'research',
      playerId: 0,
      buildingId: center.id,
      technology: 'tool_age',
    });
    expect(rejections(events)).toEqual(['resources']);
    expect(state.players[0].resources.food).toBe(499);
  });

  it('treats the transitions up to the starting age as done', () => {
    const { state, center, ctx } = town();
    state.players[0].age = 'bronze';
    expect(hasTechnology(state.players[0], 'tool_age', data)).toBe(true);
    expect(hasTechnology(state.players[0], 'bronze_age', data)).toBe(true);
    expect(hasTechnology(state.players[0], 'iron_age', data)).toBe(false);

    const repeat = send(state, ctx, {
      type: 'research',
      playerId: 0,
      buildingId: center.id,
      technology: 'bronze_age',
    });
    expect(rejections(repeat)).toEqual(['unavailable']);

    addBuilding(state, 'government_center', 0, 8, 2);
    addBuilding(state, 'temple', 0, 12, 2);
    const next = send(state, ctx, {
      type: 'research',
      playerId: 0,
      buildingId: center.id,
      technology: 'iron_age',
    });
    expect(rejections(next)).toEqual([]);
    run(state, ctx, seconds(160));
    expect(state.players[0].age).toBe('iron');
    expect(state.players[0].stats.ironAgeTick).toBeGreaterThan(0);
  });

  it('unlocks content of the new age in the available actions', () => {
    const { state, center, ctx } = town();
    addBuilding(state, 'barracks', 0, 8, 2);
    const pit = addBuilding(state, 'storage_pit', 0, 12, 2);
    const reasonOf = (id: string) =>
      availableActions(state, 0, pit, data).find((action) => action.id === id)?.reason;
    expect(reasonOf('toolworking')).toBe('age');
    send(state, ctx, { type: 'research', playerId: 0, buildingId: center.id, technology: 'tool_age' });
    run(state, ctx, seconds(120));
    expect(reasonOf('toolworking')).toBeNull();
    expect(reasonOf('metalworking')).toBe('age');
    const offered = availableActions(state, 0, center, data).map((action) => action.id);
    expect(offered).toContain('bronze_age');
    expect(offered).not.toContain('tool_age');
  });
});
