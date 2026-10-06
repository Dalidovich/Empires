import { describe, expect, it } from 'vitest';
import { RESOURCE_KINDS } from '../../data/types';
import { removeEntity } from '../core/entities';
import {
  buildingBlockReason,
  ownedBuildings,
  resolveUnitType,
  technologyBlockReason,
  unitBlockReason,
} from '../effects/availability';
import { createGame, step } from '../engine';
import { deserialize, serialize } from '../serialize';
import { getBuildingStats, getUnitStats } from '../stats';
import { canPlace } from '../systems/construction';
import type { Entity, GameState, PlayerSetup, Settings } from '../types';
import { baseSettings, context, data } from './fixtures';

const SEED = 7;

const players: PlayerSetup[] = [
  { id: 0, kind: 'human', civilization: 'shang', team: null, color: 0x0000ff, difficulty: null },
  { id: 1, kind: 'ai', civilization: 'greek', team: null, color: 0xff0000, difficulty: 'hardest' },
];

function game(patch: Partial<Settings>): GameState {
  return createGame({ ...baseSettings, populationLimit: 50, ...patch }, players, data, SEED);
}

function owned(state: GameState, playerId: number, type: string): Entity[] {
  return Object.values(state.entities).filter(
    (entity) => entity.owner === playerId && entity.type === type,
  );
}

function reachableTechnologies(disabled: readonly string[]): string[] {
  const granted = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const def of Object.values(data.technologies)) {
      if (granted.has(def.id) || disabled.includes(def.id)) {
        continue;
      }
      if (def.requires.every((id) => granted.has(id))) {
        granted.add(def.id);
        grew = true;
      }
    }
  }
  return [...granted].sort();
}

describe('starting resource level', () => {
  it('keeps the default stockpile without the option and with the default level', () => {
    expect(game({}).players[0].resources).toEqual(data.game.startingResources);
    expect(game({ resourceLevel: 'default' }).players[0].resources).toEqual(
      data.game.startingResources,
    );
    expect(game({ resourceLevel: 'bogus' }).players[0].resources).toEqual(
      data.game.startingResources,
    );
  });

  it('gives every named level with the ai bonus on top', () => {
    const levels = Object.entries(data.game.resourceLevels ?? {});
    expect(levels.length).toBeGreaterThan(0);
    const bonus = data.aiLevels.hardest.resourceBonus;
    for (const [id, amounts] of levels) {
      const state = game({ resourceLevel: id });
      expect(state.players[0].resources).toEqual(amounts);
      for (const kind of RESOURCE_KINDS) {
        expect(state.players[1].resources[kind]).toBe(amounts[kind] + (bonus[kind] ?? 0));
      }
    }
  });
});

describe('nomad start', () => {
  const unitCount = data.game.nomadStart?.unitCount ?? data.game.start.unitCount;

  it('starts in the stone age with villagers only and no housing', () => {
    const state = game({ startMode: 'nomad', startingAge: 'iron' });
    for (const player of state.players) {
      expect(owned(state, player.id, data.game.start.building)).toHaveLength(0);
      expect(owned(state, player.id, data.game.start.unit)).toHaveLength(unitCount);
      expect(player.age).toBe('stone');
      expect(player.housing).toBe(0);
      expect(player.population).toBe(unitCount);
      expect(player.researched).toEqual([]);
    }
  });

  it('keeps homeless villagers alive and nobody defeated', () => {
    const state = game({ startMode: 'nomad' });
    const ctx = context();
    for (let tick = 0; tick < 40; tick++) {
      step(state, [], ctx);
    }
    expect(state.outcome).toBeNull();
    for (const player of state.players) {
      expect(player.defeated).toBe(false);
      expect(player.housing).toBe(0);
      expect(owned(state, player.id, data.game.start.unit)).toHaveLength(unitCount);
    }
  });

  it('allows the first town center and asks for a government center afterwards', () => {
    const state = game({ startMode: 'nomad' });
    const player = state.players[0];
    const type = data.game.start.building;
    expect(buildingBlockReason(player, type, ownedBuildings(state, 0), data)).toBeNull();
    const villager = owned(state, 0, data.game.start.unit)[0];
    const near = { x: Math.floor(villager.position.x), y: Math.floor(villager.position.y) };
    const tile = [-3, -2, -1, 0, 1]
      .flatMap((dy) => [-3, -2, -1, 0, 1].map((dx) => ({ x: near.x + dx, y: near.y + dy })))
      .find((candidate) => canPlace(state, 0, type, candidate, data));
    expect(tile).toBeDefined();
    if (!tile) {
      return;
    }
    const ctx = context();
    step(
      state,
      [
        {
          type: 'placeBuilding',
          playerId: 0,
          entityIds: [villager.id],
          building: type,
          tile,
          queued: false,
        },
      ],
      ctx,
    );
    expect(owned(state, 0, type)).toHaveLength(1);
    const limit = data.buildings[type].buildTime * data.game.tickRate * 3;
    for (let tick = 0; tick < limit && owned(state, 0, type)[0]?.buildProgress !== 1; tick++) {
      step(state, [], ctx);
    }
    expect(owned(state, 0, type)[0]?.buildProgress).toBe(1);
    step(state, [], ctx);
    expect(player.housing).toBe(getBuildingStats(state, 0, type, data).housing);
    expect(player.stats.established).toBe(1);
    expect(buildingBlockReason(player, type, ownedBuildings(state, 0), data)).toBe('prerequisite');
  });

  it('defeats a nomad who loses every villager before settling', () => {
    const state = game({ startMode: 'nomad' });
    for (const villager of owned(state, 1, data.game.start.unit)) {
      removeEntity(state, villager.id, data);
    }
    step(state, [], context());
    expect(state.players[1].defeated).toBe(true);
    expect(state.players[0].defeated).toBe(false);
  });
});

describe('post-iron start', () => {
  it('starts in the iron age with the whole civilization tree researched', () => {
    const state = game({ startMode: 'post_iron', startingAge: 'stone' });
    const trees = state.players.map((player) => data.civilizations[player.civilization].disabledTechs);
    expect([...trees[0]].sort()).not.toEqual([...trees[1]].sort());
    for (const player of state.players) {
      const disabled = data.civilizations[player.civilization].disabledTechs;
      expect(player.age).toBe('iron');
      expect([...player.researched].sort()).toEqual(reachableTechnologies(disabled));
      for (const id of disabled) {
        expect(player.researched).not.toContain(id);
      }
      for (const id of player.researched) {
        const def = data.technologies[id];
        const at = player.researched.indexOf(id);
        for (const required of def.requires) {
          expect(player.researched.indexOf(required)).toBeLessThan(at);
        }
      }
    }
    expect(state.players[0].researched).not.toEqual(state.players[1].researched);
  });

  it('applies the researched effects to stats, upgrades and starting entities', () => {
    const state = game({ startMode: 'post_iron' });
    for (const player of state.players) {
      for (const id of player.researched) {
        for (const effect of data.technologies[id].effects) {
          if (effect.type === 'upgrade_unit') {
            expect(resolveUnitType(player, effect.from, data)).not.toBe(effect.from);
          }
        }
      }
      for (const entity of Object.values(state.entities)) {
        if (entity.owner !== player.id) {
          continue;
        }
        const max =
          entity.kind === 'unit'
            ? getUnitStats(state, player.id, entity.type, data).hp
            : getBuildingStats(state, player.id, entity.type, data).hp;
        expect(entity.hp).toBe(max);
      }
    }
    const boosted = Object.values(data.units).some(
      (def) => getUnitStats(state, 1, def.id, data).hp !== getUnitStats(game({}), 1, def.id, data).hp,
    );
    expect(boosted).toBe(true);
    const ctx = context();
    for (let tick = 0; tick < 5; tick++) {
      step(state, [], ctx);
    }
    expect(state.players[0].age).toBe('iron');
    expect(state.outcome).toBeNull();
  });
});

describe('full tech tree', () => {
  it('keeps civilization restrictions and bonuses with the option off', () => {
    const state = game({ startingAge: 'iron' });
    const player = state.players[0];
    const civilization = data.civilizations[player.civilization];
    const none = ownedBuildings(state, 0);
    for (const id of civilization.disabledUnits) {
      expect(unitBlockReason(player, id, data)).toBe('unavailable');
    }
    for (const id of civilization.disabledTechs) {
      expect(technologyBlockReason(player, id, none, data)).toBe('unavailable');
    }
    expect(getUnitStats(state, 0, 'villager', data).cost).not.toEqual(data.units.villager.cost);
  });

  it('lifts civilization restrictions and removes civilization bonuses', () => {
    const state = game({ startingAge: 'iron', fullTechTree: true });
    for (const player of state.players) {
      const civilization = data.civilizations[player.civilization];
      const none = ownedBuildings(state, player.id);
      for (const id of civilization.disabledUnits) {
        expect(unitBlockReason(player, id, data)).not.toBe('unavailable');
      }
      for (const id of civilization.disabledTechs) {
        expect(technologyBlockReason(player, id, none, data)).not.toBe('unavailable');
      }
      for (const def of Object.values(data.units)) {
        expect(getUnitStats(state, player.id, def.id, data)).toEqual(def);
      }
    }
  });

  it('researches every technology on a post-iron start', () => {
    const state = game({ startMode: 'post_iron', fullTechTree: true });
    for (const player of state.players) {
      expect([...player.researched].sort()).toEqual(Object.keys(data.technologies).sort());
    }
  });
});

describe('saves with setup options', () => {
  it('round-trips a game created with the new settings', () => {
    const state = game({ resourceLevel: 'high', startMode: 'post_iron', fullTechTree: true });
    const ctx = context();
    for (let tick = 0; tick < 5; tick++) {
      step(state, [], ctx);
    }
    const restored = deserialize(serialize(state)).state as unknown as GameState;
    expect(restored).toEqual(state);
    expect(restored.settings.startMode).toBe('post_iron');
    step(state, [], ctx);
    step(restored, [], context());
    expect(JSON.stringify(restored)).toBe(JSON.stringify(state));
  });

  it('loads a save made before the options existed', () => {
    const saved = serialize(game({}));
    const old = deserialize(saved).state as unknown as GameState;
    expect(old.settings.resourceLevel).toBeUndefined();
    expect(old.settings.startMode).toBeUndefined();
    expect(old.settings.fullTechTree).toBeUndefined();
    expect(old.players[0].fullTechTree).toBeUndefined();
    const fresh = game({ resourceLevel: 'default', startMode: 'standard', fullTechTree: false });
    const ctx = context();
    for (let tick = 0; tick < 20; tick++) {
      step(old, [], ctx);
      step(fresh, [], ctx);
    }
    expect(old.outcome).toBeNull();
    expect(old.players).toEqual(fresh.players);
    expect(old.entities).toEqual(fresh.entities);
    const disabled = data.civilizations[old.players[0].civilization].disabledUnits[0];
    expect(unitBlockReason(old.players[0], disabled, data)).toBe('unavailable');
  });
});
