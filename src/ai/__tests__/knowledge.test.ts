import { describe, expect, it } from 'vitest';
import {
  buildingAvailable,
  hasTech,
  nextAgeTechnology,
  techAllowed,
  techAvailable,
  unitAllowed,
  unitStats,
  unitTrainable,
} from '../knowledge';
import { chooseRoster, unitValue } from '../roster';
import { createScene, data, thinkOf } from './helpers';

function knowledgeOf(
  civilization: string,
  age: 'stone' | 'tool' | 'bronze' | 'iron',
  researched: string[] = [],
  fullTechTree = false,
) {
  const scene = createScene(24);
  scene.state.settings.fullTechTree = fullTechTree;
  const player = scene.state.players[0];
  player.civilization = civilization;
  player.age = age;
  player.researched = researched;
  return thinkOf(scene).know;
}

describe('ai knowledge', () => {
  it('derives trainable units from age, upgrades and required technologies', () => {
    const stone = knowledgeOf('greek', 'stone');
    expect(unitTrainable(stone, 'clubman')).toBe(true);
    expect(unitTrainable(stone, 'axeman')).toBe(false);
    expect(unitTrainable(stone, 'bowman')).toBe(false);

    const tool = knowledgeOf('greek', 'tool', ['battle_axe']);
    expect(unitTrainable(tool, 'clubman')).toBe(false);
    expect(unitTrainable(tool, 'axeman')).toBe(true);
    expect(unitTrainable(tool, 'bowman')).toBe(true);
  });

  it('never offers units disabled for the civilization', () => {
    expect(unitTrainable(knowledgeOf('greek', 'bronze'), 'cavalry')).toBe(true);
    expect(unitTrainable(knowledgeOf('egyptian', 'bronze'), 'cavalry')).toBe(false);
    expect(unitTrainable(knowledgeOf('assyrian', 'iron'), 'war_elephant')).toBe(false);
  });

  it('treats reached ages as known technologies', () => {
    const bronze = knowledgeOf('greek', 'bronze');
    expect(hasTech(bronze, 'tool_age')).toBe(true);
    expect(hasTech(bronze, 'bronze_age')).toBe(true);
    expect(hasTech(bronze, 'iron_age')).toBe(false);
    expect(nextAgeTechnology(bronze)?.id).toBe('iron_age');
    expect(nextAgeTechnology(knowledgeOf('greek', 'iron'))).toBeNull();
  });

  it('requires qualifying buildings before an age advance', () => {
    const stone = knowledgeOf('greek', 'stone');
    expect(techAvailable(stone, 'tool_age', { granary: 1 }, [])).toBe(false);
    expect(techAvailable(stone, 'tool_age', { granary: 1, storage_pit: 1 }, [])).toBe(true);
    expect(techAvailable(stone, 'tool_age', { granary: 1, storage_pit: 1 }, ['tool_age'])).toBe(false);
    expect(techAvailable(stone, 'bronze_age', { market: 1, stable: 1 }, [])).toBe(false);
  });

  it('checks building prerequisites', () => {
    const tool = knowledgeOf('greek', 'tool');
    expect(buildingAvailable(tool, 'farm', { granary: 1 }, { granary: 1 })).toBe(false);
    expect(buildingAvailable(tool, 'farm', { market: 1 }, { market: 1 })).toBe(true);
    expect(buildingAvailable(tool, 'academy', { stable: 1 }, { stable: 1 })).toBe(false);
    expect(buildingAvailable(tool, 'watch_tower', {}, {})).toBe(false);
  });

  it('applies civilization bonuses to unit statistics', () => {
    const base = data.units.bowman.attack;
    expect(unitStats(knowledgeOf('hittite', 'tool'), 'bowman')?.attack).toBe(base + 1);
    expect(unitStats(knowledgeOf('greek', 'tool'), 'bowman')?.attack).toBe(base);
    const cheap = unitStats(knowledgeOf('shang', 'stone'), 'villager')?.cost.food ?? 0;
    expect(cheap).toBeLessThan(data.units.villager.cost.food ?? 0);
  });

  it('ignores civilization limits and bonuses with the full tech tree', () => {
    const civilization = data.civilizations.shang;
    const limited = knowledgeOf('shang', 'iron');
    const full = knowledgeOf('shang', 'iron', [], true);
    for (const id of civilization.disabledTechs) {
      expect(techAllowed(limited, id)).toBe(false);
      expect(techAllowed(full, id)).toBe(true);
    }
    for (const id of civilization.disabledUnits) {
      expect(unitAllowed(limited, id)).toBe(false);
      expect(unitAllowed(full, id)).toBe(true);
    }
    expect(unitStats(limited, 'villager')?.cost).not.toEqual(data.units.villager.cost);
    expect(unitStats(full, 'villager')?.cost).toEqual(data.units.villager.cost);
  });

  it('builds the roster from units the civilization can field', () => {
    for (const civilization of Object.values(data.civilizations)) {
      const roster = chooseRoster(knowledgeOf(civilization.id, 'iron'));
      expect(roster.melee).toBeDefined();
      for (const entry of Object.values(roster)) {
        expect(civilization.disabledUnits).not.toContain(entry.unit);
        if (entry.unlock !== null) {
          expect(civilization.disabledTechs).not.toContain(entry.unlock);
        }
      }
    }
  });

  it('values stronger units higher within the same cost', () => {
    expect(unitValue(data.units.axeman)).toBeGreaterThan(unitValue(data.units.clubman));
    expect(unitValue(data.units.legion)).toBeGreaterThan(unitValue(data.units.short_swordsman));
  });

  it('adapts the roster to the technology tree', () => {
    const greek = chooseRoster(knowledgeOf('greek', 'iron'));
    const egyptian = chooseRoster(knowledgeOf('egyptian', 'iron'));
    expect(greek.melee?.unit).not.toBe(egyptian.melee?.unit);
    expect(chooseRoster(knowledgeOf('greek', 'stone')).ranged).toBeUndefined();
  });
});
