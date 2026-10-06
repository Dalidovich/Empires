import { describe, expect, it } from 'vitest';
import { completeResearch } from '../../effects';
import {
  getBuildingStats,
  getCarryCapacity,
  getFarmFood,
  getGatherRate,
  getUnitStats,
  hasPlayerFlag,
} from '../../stats';
import { addBuilding, addUnit, context, data, run } from '../fixtures';
import { eventsOf, ownedOf, rejections, seconds, send, world } from './fixtures';

function lab(age: 'stone' | 'tool' | 'bronze' | 'iron' = 'tool') {
  const state = world();
  state.players[0].age = age;
  addBuilding(state, 'town_center', 0, 2, 2);
  const pit = addBuilding(state, 'storage_pit', 0, 8, 2);
  return { state, pit, ctx: context() };
}

describe('research', () => {
  it('researches a technology once, keeps the building busy and applies the effect', () => {
    const { state, pit, ctx } = lab();
    const clubman = addUnit(state, 'clubman', 0, 15.5, 15.5);
    expect(getUnitStats(state, 0, 'clubman', data).attack).toBe(3);

    send(state, ctx, { type: 'research', playerId: 0, buildingId: pit.id, technology: 'toolworking' });
    expect(pit.research?.technology).toBe('toolworking');
    expect(state.players[0].resources.food).toBe(5000 - 100);
    expect(pit.state).toBe('producing');

    const busy = send(state, ctx, {
      type: 'research',
      playerId: 0,
      buildingId: pit.id,
      technology: 'leather_armor_infantry',
    });
    expect(rejections(busy)).toEqual(['busy']);

    const events = run(state, ctx, seconds(30));
    expect(eventsOf(events, 'researchCompleted').map((event) => event.technology)).toEqual(['toolworking']);
    expect(state.players[0].researched).toEqual(['toolworking']);
    expect(state.players[0].stats.technologiesResearched).toBe(1);
    expect(pit.research).toBeNull();
    expect(pit.state).toBe('idle');
    expect(getUnitStats(state, 0, clubman.type, data).attack).toBe(5);
    expect(getUnitStats(state, 1, 'clubman', data).attack).toBe(3);

    const again = send(state, ctx, {
      type: 'research',
      playerId: 0,
      buildingId: pit.id,
      technology: 'toolworking',
    });
    expect(rejections(again)).toEqual(['unavailable']);
  });

  it('refunds the full cost on cancel', () => {
    const { state, pit, ctx } = lab();
    send(state, ctx, { type: 'research', playerId: 0, buildingId: pit.id, technology: 'toolworking' });
    run(state, ctx, seconds(10));
    send(state, ctx, { type: 'cancelResearch', playerId: 0, buildingId: pit.id });
    expect(pit.research).toBeNull();
    expect(state.players[0].resources.food).toBe(5000);
    expect(state.players[0].researched).toEqual([]);
    const events = send(state, ctx, { type: 'cancelResearch', playerId: 0, buildingId: pit.id });
    expect(rejections(events)).toEqual(['invalid']);
  });

  it('checks building, age, prerequisites, civilization and resources', () => {
    const { state, pit, ctx } = lab();
    const market = addBuilding(state, 'market', 0, 14, 2);
    const research = (buildingId: number, technology: string) =>
      rejections(send(state, ctx, { type: 'research', playerId: 0, buildingId, technology }));
    expect(research(pit.id, 'woodworking')).toEqual(['invalid']);
    expect(research(pit.id, 'metalworking')).toEqual(['age']);
    state.players[0].age = 'iron';
    expect(research(market.id, 'siegecraft')).toEqual(['prerequisite']);
    expect(research(pit.id, 'metallurgy')).toEqual(['unavailable']);
    state.players[0].resources.food = 10;
    expect(research(pit.id, 'toolworking')).toEqual(['resources']);
  });

  it('does not research the same technology in two buildings and blocks training meanwhile', () => {
    const { state, pit, ctx } = lab();
    const second = addBuilding(state, 'storage_pit', 0, 14, 2);
    const barracks = addBuilding(state, 'barracks', 0, 20, 2);
    send(state, ctx, { type: 'research', playerId: 0, buildingId: pit.id, technology: 'toolworking' });
    const duplicate = send(state, ctx, {
      type: 'research',
      playerId: 0,
      buildingId: second.id,
      technology: 'toolworking',
    });
    expect(rejections(duplicate)).toEqual(['busy']);

    send(state, ctx, { type: 'research', playerId: 0, buildingId: barracks.id, technology: 'battle_axe' });
    const train = send(state, ctx, {
      type: 'train',
      playerId: 0,
      buildingId: barracks.id,
      unit: 'clubman',
      count: 1,
    });
    expect(rejections(train)).toEqual(['busy']);
  });

  it('replaces every unit of an upgraded line and keeps the damage taken', () => {
    const { state, ctx } = lab();
    addBuilding(state, 'house', 0, 20, 10);
    const barracks = addBuilding(state, 'barracks', 0, 20, 2);
    const healthy = addUnit(state, 'clubman', 0, 15.5, 15.5);
    const wounded = addUnit(state, 'clubman', 0, 16.5, 15.5);
    const foreign = addUnit(state, 'clubman', 1, 17.5, 15.5);
    wounded.hp = 30;
    send(state, ctx, { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 1 });
    completeResearch(state, 0, 'battle_axe', ctx, barracks.position);
    expect(healthy.type).toBe('axeman');
    expect(healthy.hp).toBe(50);
    expect(wounded.type).toBe('axeman');
    expect(wounded.hp).toBe(40);
    expect(foreign.type).toBe('clubman');
    expect(barracks.queue[0].unit).toBe('axeman');
    expect(ownedOf(state, 0, 'clubman')).toHaveLength(0);
  });

  it('upgrades existing walls and towers of the line', () => {
    const { state, ctx } = lab('bronze');
    state.players[0].researched.push('small_wall', 'watch_tower');
    const wall = addBuilding(state, 'small_wall', 0, 20, 20);
    const tower = addBuilding(state, 'watch_tower', 0, 22, 20);
    completeResearch(state, 0, 'medium_wall', ctx, wall.position);
    completeResearch(state, 0, 'sentry_tower', ctx, wall.position);
    expect(wall.type).toBe('medium_wall');
    expect(wall.hp).toBe(getBuildingStats(state, 0, 'medium_wall', data).hp);
    expect(tower.type).toBe('sentry_tower');
    expect(state.map.occupancy[20 * state.map.size + 20]).toBe(wall.id);
  });

  it('changes hit points of living units and standing buildings instantly', () => {
    const { state, pit, ctx } = lab('bronze');
    const house = addBuilding(state, 'house', 0, 20, 2);
    const damaged = addBuilding(state, 'house', 0, 20, 6);
    damaged.hp = 50;
    completeResearch(state, 0, 'architecture', ctx, pit.position);
    expect(getBuildingStats(state, 0, 'house', data).hp).toBe(90);
    expect(house.hp).toBe(90);
    expect(damaged.hp).toBe(65);
    expect(getBuildingStats(state, 0, 'house', data).buildTime).toBeCloseTo(20 * 0.67);

    const priest = addUnit(state, 'priest', 0, 15.5, 15.5);
    completeResearch(state, 0, 'mysticism', ctx, pit.position);
    expect(priest.hp).toBe(50);
  });

  it('sets player flags and economy modifiers', () => {
    const { state, pit, ctx } = lab('iron');
    completeResearch(state, 0, 'writing', ctx, pit.position);
    expect(state.players[0].sharedExploration).toBe(true);
    expect(hasPlayerFlag(state, 0, 'shared_exploration', data)).toBe(true);
    expect(hasPlayerFlag(state, 1, 'shared_exploration', data)).toBe(false);

    state.players[0].researched.push('gold_mining');
    completeResearch(state, 0, 'coinage', ctx, pit.position);
    expect(state.players[0].modifiers.flags.no_tribute_tax).toBe(true);
    expect(getGatherRate(state, 0, 'gold', data)).toBeCloseTo(data.resources.gatherRates.gold * 1.25);
    expect(getCarryCapacity(state, 0, 'gold', data)).toBe(data.resources.carryCapacity.gold + 3);
  });

  it('adds farm food to existing farms', () => {
    const { state, pit, ctx } = lab();
    const farm = addBuilding(state, 'farm', 0, 20, 20);
    farm.amount = 100;
    completeResearch(state, 0, 'domestication', ctx, pit.position);
    expect(getFarmFood(state, 0, data)).toBe(data.resources.farmFood + 75);
    expect(farm.amount).toBe(175);
  });

  it('picks up technologies written straight into the researched list', () => {
    const { state, ctx } = lab('iron');
    state.players[0].researched.push('ballistics');
    run(state, ctx, 1);
    expect(state.players[0].modifiers.flags.ballistics).toBe(true);
  });
});
