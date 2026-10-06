import { describe, expect, it } from 'vitest';
import { GameDataError, RAW_GAME_DATA, buildGameData, loadGameData } from '../index';

describe('game data loader', () => {
  it('loads and indexes the seed data', () => {
    const data = loadGameData();
    expect(data.units.villager.hp).toBe(25);
    expect(data.buildings.town_center.housing).toBe(4);
    expect(data.technologies.tool_age.effects[0]).toEqual({ type: 'advance_age', age: 'tool' });
    expect(Object.keys(data.civilizations)).toHaveLength(12);
    expect(data.mapSizes.huge.tiles).toBe(200);
    expect(data.aiLevels.hardest.resourceBonus.food).toBeGreaterThan(0);
    expect(data.game.tickRate).toBe(20);
    expect(data.resourceSources.tree.resource).toBe('wood');
    expect(data.mapObjects.ruin.kind).toBe('ruin');
  });

  it('returns the same immutable object', () => {
    const data = loadGameData();
    expect(loadGameData()).toBe(data);
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.units.villager.cost)).toBe(true);
    expect(() => {
      (data.units.villager as { hp: number }).hp = 1;
    }).toThrow();
  });

  it('rejects records that violate the schema', () => {
    const broken = structuredClone(RAW_GAME_DATA) as { units: Record<string, unknown>[] };
    broken.units[0].hp = -5;
    expect(() => buildGameData(broken as never)).toThrow(GameDataError);
  });

  it('rejects unknown fields and bad ids', () => {
    const extra = structuredClone(RAW_GAME_DATA) as { units: Record<string, unknown>[] };
    extra.units[0].displayName = 'Villager';
    expect(() => buildGameData(extra as never)).toThrow(GameDataError);

    const badId = structuredClone(RAW_GAME_DATA) as { units: Record<string, unknown>[] };
    badId.units[0].id = 'Town Center';
    expect(() => buildGameData(badId as never)).toThrow(GameDataError);
  });

  it('rejects duplicate ids', () => {
    const duplicated = structuredClone(RAW_GAME_DATA) as { units: unknown[] };
    duplicated.units.push(duplicated.units[0]);
    expect(() => buildGameData(duplicated as never)).toThrow(/duplicate id/);
  });

  it('rejects unknown effect types', () => {
    const broken = structuredClone(RAW_GAME_DATA) as {
      technologies: { effects: unknown[] }[];
    };
    broken.technologies[0].effects = [{ type: 'summon_dragon' }];
    expect(() => buildGameData(broken as never)).toThrow(GameDataError);
  });
});
