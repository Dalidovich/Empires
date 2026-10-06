import { describe, expect, it } from 'vitest';
import { effectSchema, unitStatKeySchema } from '../../../data/schema';
import type { Effect, GameData } from '../../../data/types';
import type { PlayerModifierSet } from '../../effects';
import {
  compileModifiers,
  isEffectHandled,
  modifiedBuilding,
  modifiedUnit,
} from '../../effects';
import {
  getBuildingStats,
  getCarryCapacity,
  getConversionParams,
  getFarmFood,
  getGatherRate,
  getUnitStats,
} from '../../stats';
import { data } from '../fixtures';
import { world } from './fixtures';

interface LabelledEffect {
  label: string;
  effect: Effect;
}

function schemaEffectTypes(): string[] {
  const options = (effectSchema as unknown as { options: { shape: { type: { value: string } } }[] })
    .options;
  return options.map((option) => option.shape.type.value);
}

function dataWith(effect: Effect): GameData {
  const { condition: _condition, ...unconditional } = effect;
  return {
    ...data,
    civilizations: {
      probe: {
        id: 'probe',
        architectureSet: 'greek',
        bonuses: [unconditional as Effect],
        disabledTechs: [],
        disabledUnits: [],
        source: '1.0',
      },
    },
  };
}

function outcome(modifiers: PlayerModifierSet, source: GameData): string {
  return JSON.stringify({
    units: Object.values(source.units).map((def) => modifiedUnit(modifiers, def)),
    buildings: Object.values(source.buildings).map((def) => modifiedBuilding(modifiers, def)),
    gatherRates: modifiers.gatherRates,
    carryCapacity: modifiers.carryCapacity,
    farmFood: modifiers.farmFood,
    conversion: modifiers.conversion,
    flags: modifiers.flags,
    unitUpgrades: modifiers.unitUpgrades,
    buildingUpgrades: modifiers.buildingUpgrades,
    enabledUnits: modifiers.enabledUnits,
    enabledBuildings: modifiers.enabledBuildings,
    age: modifiers.age,
  });
}

function allEffects(): LabelledEffect[] {
  const effects: LabelledEffect[] = [];
  for (const technology of Object.values(data.technologies)) {
    technology.effects.forEach((effect, index) => {
      effects.push({ label: `tech ${technology.id}#${index} ${effect.type}`, effect });
    });
  }
  for (const civilization of Object.values(data.civilizations)) {
    civilization.bonuses.forEach((effect, index) => {
      effects.push({ label: `civ ${civilization.id}#${index} ${effect.type}`, effect });
    });
  }
  return effects;
}

function playerOf(civilization: string, researched: string[] = []) {
  const state = world();
  state.players[0].civilization = civilization;
  state.players[0].researched = researched;
  return state;
}

describe('effects engine coverage', () => {
  it('handles every effect type of the schema', () => {
    const types = schemaEffectTypes();
    expect(types.length).toBeGreaterThanOrEqual(13);
    for (const type of types) {
      expect(typeof type).toBe('string');
      expect(isEffectHandled(type), type).toBe(true);
    }
    expect(isEffectHandled('summon_dragon')).toBe(false);
  });

  it('covers every effect type used by technologies and civilization bonuses', () => {
    const used = new Set(allEffects().map((entry) => entry.effect.type));
    for (const type of used) {
      expect(schemaEffectTypes()).toContain(type);
      expect(isEffectHandled(type), type).toBe(true);
    }
  });

  it('makes every technology effect and civilization bonus change the result', () => {
    const baseline = outcome(compileModifiers('', [], data), data);
    for (const { label, effect } of allEffects()) {
      const source = dataWith(effect);
      const changed = outcome(compileModifiers('probe', [], source), source);
      expect(changed !== baseline, label).toBe(true);
    }
  });

  it('applies every stat key of the schema to a unit or a building', () => {
    const baseline = outcome(compileModifiers('', [], data), data);
    for (const stat of unitStatKeySchema.options) {
      const source = dataWith({
        type: 'modify_stat',
        target: {
          unitClasses: ['villager', 'military', 'ship', 'priest'],
          buildingClasses: ['house', 'tower'],
        },
        stat,
        op: 'add',
        value: 7,
      });
      const changed = outcome(compileModifiers('probe', [], source), source);
      expect(changed !== baseline, stat).toBe(true);
    }
  });

  it('respects effect conditions', () => {
    const speed = (researched: string[]) =>
      getUnitStats(playerOf('egyptian', researched), 0, 'villager', data).speed;
    expect(speed([])).toBe(1.1);
    expect(speed(['wheel'])).toBe(1.8);
    expect(speed(['jihad'])).toBe(1.42);
    expect(speed(['wheel', 'jihad'])).toBe(2.1);
    expect(speed(['jihad', 'wheel'])).toBe(2.1);
  });
});

describe('technology effects from data', () => {
  it('applies Jihad to villagers', () => {
    const state = playerOf('egyptian', ['jihad']);
    const villager = getUnitStats(state, 0, 'villager', data);
    expect(villager.hp).toBe(65);
    expect(villager.attack).toBe(10);
    expect(getCarryCapacity(state, 0, 'wood', data)).toBe(data.resources.carryCapacity.wood - 8);
    expect(getCarryCapacity(state, 0, 'boat_fish', data)).toBe(data.resources.carryCapacity.boat_fish);
  });

  it('stacks additive upgrades', () => {
    const state = playerOf('greek', ['toolworking', 'metalworking']);
    expect(getUnitStats(state, 0, 'clubman', data).attack).toBe(7);
    expect(getUnitStats(state, 0, 'villager', data).attack).toBe(3);
    const ranged = playerOf('greek', ['woodworking', 'artisanship']);
    expect(getUnitStats(ranged, 0, 'bowman', data).range).toBe(7);
    expect(getBuildingStats(ranged, 0, 'watch_tower', data).range).toBe(7);
    expect(getCarryCapacity(ranged, 0, 'wood', data)).toBe(data.resources.carryCapacity.wood + 4);
  });

  it('modifies conversion parameters', () => {
    const base = getConversionParams(playerOf('greek'), 0, data);
    expect(base.chance).toBe(data.game.conversion.chance);
    expect(base.faithRechargeTime).toBe(50);
    const state = playerOf('egyptian', ['astrology', 'fanaticism']);
    const params = getConversionParams(state, 0, data);
    expect(params.chance).toBeCloseTo(data.game.conversion.chance * 1.3);
    expect(params.faithRechargeRate).toBeCloseTo(data.game.conversion.faithRechargeRate * 1.5);
    expect(params.faithRechargeTime).toBeCloseTo(50 / 1.5);
  });

  it('returns raw data for players outside the game', () => {
    const state = world();
    expect(getUnitStats(state, -1, 'gazelle', data)).toBe(data.units.gazelle);
    expect(getGatherRate(state, -1, 'wood', data)).toBe(data.resources.gatherRates.wood);
    expect(() => getBuildingStats(state, 0, 'dragon_lair', data)).toThrow();
  });
});

describe('civilization bonuses from data', () => {
  it('Assyrian and Yamato villagers are faster', () => {
    expect(getUnitStats(playerOf('assyrian'), 0, 'villager', data).speed).toBeCloseTo(1.1 * 1.3333);
    expect(getUnitStats(playerOf('yamato'), 0, 'villager', data).speed).toBeCloseTo(1.1 * 1.3333);
    expect(getUnitStats(playerOf('assyrian'), 0, 'bowman', data).attackInterval).toBeCloseTo(1.4 * 0.75);
  });

  it('Babylonian walls, towers, priests and stone', () => {
    const state = playerOf('babylonian');
    expect(getBuildingStats(state, 0, 'small_wall', data).hp).toBe(400);
    expect(getBuildingStats(state, 0, 'watch_tower', data).hp).toBe(200);
    expect(getBuildingStats(state, 0, 'house', data).hp).toBe(75);
    expect(getConversionParams(state, 0, data).faithRechargeTime).toBeCloseTo(38);
    expect(getGatherRate(state, 0, 'stone', data)).toBeCloseTo(data.resources.gatherRates.stone * 1.3);
  });

  it('Choson swordsmen, towers and priests', () => {
    const state = playerOf('choson');
    expect(getUnitStats(state, 0, 'legion', data).hp).toBe(240);
    expect(getUnitStats(state, 0, 'long_swordsman', data).hp).toBe(160);
    expect(getBuildingStats(state, 0, 'watch_tower', data).range).toBe(7);
    expect(getUnitStats(state, 0, 'priest', data).cost).toEqual({ gold: 83 });
  });

  it('cost discounts of Shang, Minoan, Phoenician and Yamato', () => {
    expect(getUnitStats(playerOf('shang'), 0, 'villager', data).cost).toEqual({ food: 35 });
    expect(getUnitStats(playerOf('minoan'), 0, 'scout_ship', data).cost).toEqual({ wood: 90 });
    expect(getUnitStats(playerOf('phoenician'), 0, 'war_elephant', data).cost).toEqual({
      food: 128,
      gold: 30,
    });
    expect(getUnitStats(playerOf('yamato'), 0, 'scout', data).cost).toEqual({ food: 75 });
    expect(getUnitStats(playerOf('greek'), 0, 'villager', data).cost).toEqual({ food: 50 });
  });

  it('farm food of Minoan, Persian and Sumerian', () => {
    expect(getFarmFood(playerOf('minoan'), 0, data)).toBe(Math.round(data.resources.farmFood * 1.25));
    expect(getFarmFood(playerOf('persian'), 0, data)).toBe(Math.round(data.resources.farmFood * 0.7));
    expect(getFarmFood(playerOf('sumerian'), 0, data)).toBe(data.resources.farmFood * 2);
    expect(getFarmFood(playerOf('sumerian', ['domestication']), 0, data)).toBe(
      (data.resources.farmFood + 75) * 2,
    );
  });

  it('remaining stat bonuses', () => {
    expect(getUnitStats(playerOf('sumerian'), 0, 'villager', data).hp).toBe(40);
    expect(getUnitStats(playerOf('egyptian'), 0, 'priest', data).range).toBe(13);
    expect(getUnitStats(playerOf('egyptian'), 0, 'chariot', data).hp).toBe(133);
    expect(getUnitStats(playerOf('greek'), 0, 'hoplite', data).speed).toBeCloseTo(0.9 * 1.3);
    expect(getUnitStats(playerOf('hittite'), 0, 'stone_thrower', data).hp).toBe(150);
    expect(getUnitStats(playerOf('hittite'), 0, 'bowman', data).attack).toBe(4);
    expect(getUnitStats(playerOf('persian'), 0, 'war_elephant', data).speed).toBeCloseTo(0.9 * 1.5);
    expect(getCarryCapacity(playerOf('phoenician'), 0, 'wood', data)).toBe(
      data.resources.carryCapacity.wood + 2,
    );
    expect(getGatherRate(playerOf('persian'), 0, 'hunt', data)).toBeCloseTo(
      data.resources.gatherRates.hunt * 1.3,
    );
    expect(getUnitStats(playerOf('yamato'), 0, 'fishing_boat', data).hp).toBe(60);
  });

  it('raises the hit points of starting units to the civilization values', async () => {
    const { addUnit, context, run } = await import('../fixtures');
    const state = playerOf('sumerian');
    const villager = addUnit(state, 'villager', 0, 5.5, 5.5);
    const foreign = addUnit(state, 'villager', 1, 8.5, 5.5);
    run(state, context(), 1);
    expect(villager.hp).toBe(40);
    expect(foreign.hp).toBe(25);
  });
});
