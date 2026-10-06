import { describe, expect, it } from 'vitest';
import { createAi } from '../../ai';
import { loadGameData } from '../../data';
import type { Command } from '../commands';
import { PIPELINE, createGame, step } from '../engine';
import { deserialize, serialize } from '../serialize';
import { buildPlayerView } from '../snapshot';
import { getBuildingStats, getUnitStats } from '../stats';
import { recordStat } from '../playerStats';
import { createStepContext } from '../system';
import type { PlayerSetup, Settings } from '../types';

const data = loadGameData();

const settings: Settings = {
  mapType: 'inland',
  mapSize: 'tiny',
  victoryMode: 'conquest',
  populationLimit: 50,
  startingAge: 'stone',
  revealMap: false,
  lockTeams: true,
  speed: 'normal',
};

const players: PlayerSetup[] = [
  { id: 0, kind: 'human', civilization: 'assyrian', team: 1, color: 0x0000ff, difficulty: null },
  { id: 1, kind: 'ai', civilization: 'greek', team: 1, color: 0xff0000, difficulty: 'hardest' },
  { id: 2, kind: 'ai', civilization: 'greek', team: null, color: 0x00ff00, difficulty: 'easy' },
];

describe('engine on stubs', () => {
  it('creates a game with a town center and three villagers per player', () => {
    const state = createGame(settings, players, data, 7);
    const entities = Object.values(state.entities);
    for (const player of players) {
      const own = entities.filter((entity) => entity.owner === player.id);
      expect(own.filter((entity) => entity.type === 'town_center')).toHaveLength(1);
      expect(own.filter((entity) => entity.type === 'villager')).toHaveLength(3);
    }
    expect(state.map.size).toBe(72);
    expect(state.map.terrain).toHaveLength(72 * 72);
    expect(state.players[0].population).toBe(3);
    expect(state.players[0].housing).toBe(4);
  });

  it('derives stances from teams and applies the hardest resource bonus', () => {
    const state = createGame(settings, players, data, 7);
    expect(state.players[0].diplomacy).toEqual({ 1: 'ally', 2: 'enemy' });
    expect(state.players[2].diplomacy).toEqual({ 0: 'enemy', 1: 'enemy' });
    expect(state.players[0].resources).toEqual(data.game.startingResources);
    expect(state.players[1].resources.food).toBeGreaterThan(data.game.startingResources.food);
    expect(state.players[2].resources).toEqual(data.game.startingResources);
  });

  it('marks building footprints in tile occupancy', () => {
    const state = createGame(settings, players, data, 7);
    const townCenter = Object.values(state.entities).find((entity) => entity.type === 'town_center');
    expect(townCenter).toBeDefined();
    const occupied = state.map.occupancy.filter((value) => value === townCenter?.id);
    expect(occupied).toHaveLength(9);
  });

  it('rejects non-contiguous player ids and unknown civilizations', () => {
    expect(() => createGame(settings, [{ ...players[0], id: 3 }], data, 1)).toThrow();
    expect(() => createGame(settings, [{ ...players[0], civilization: 'atlantean' }], data, 1)).toThrow();
  });

  it('advances ticks and handles speed and pause commands', () => {
    const state = createGame(settings, players, data, 7);
    const ctx = createStepContext(data);
    step(state, [], ctx);
    expect(state.tick).toBe(1);

    const pause: Command = { type: 'pause', playerId: 0, paused: true };
    step(state, [pause, { type: 'setSpeed', playerId: 0, speed: 'fast' }], ctx);
    expect(state.paused).toBe(true);
    expect(state.settings.speed).toBe('fast');
    expect(state.tick).toBe(1);

    step(state, [{ type: 'pause', playerId: 0, paused: false }], ctx);
    expect(state.tick).toBe(2);
  });

  it('has one pipeline entry per system with unique ids', () => {
    const ids = PIPELINE.map((system) => system.id);
    expect(ids).toHaveLength(21);
    expect(new Set(ids).size).toBe(21);
  });

  it('is deterministic and JSON-serializable', () => {
    const run = (): string => {
      const state = createGame(settings, players, data, 42);
      const ctx = createStepContext(data);
      for (let i = 0; i < 20; i++) {
        step(state, [], ctx);
      }
      return JSON.stringify(state);
    };
    const first = run();
    expect(run()).toBe(first);
    expect(JSON.stringify(JSON.parse(first))).toBe(first);
  });

  it('round-trips through serialize and deserialize', () => {
    const state = createGame(settings, players, data, 42);
    const restored = deserialize(serialize(state, { 1: { note: 'saved' } }));
    expect(restored.state).toEqual(state);
    expect(restored.state).not.toBe(state);
    expect(restored.ai).toEqual({ 1: { note: 'saved' } });
  });

  it('builds a player view and feeds the stub AI', () => {
    const state = createGame(settings, players, data, 7);
    const view = buildPlayerView(state, 0, data);
    expect(view.playerId).toBe(0);
    expect(view.entities.find((entity) => entity.owner === 0)?.own).not.toBeNull();
    expect(view.entities.find((entity) => entity.owner === 1)?.own).toBeNull();
    expect(view.entities.some((entity) => entity.owner === 2)).toBe(false);
    expect(view.players[1].stanceTowardViewer).toBe('ally');

    const ai = createAi(1, 'hardest', data);
    expect(ai.think(buildPlayerView(state, 1, data), state.tick)).toEqual([]);
    expect(JSON.stringify(ai.serialize())).toBeTypeOf('string');
  });

  it('exposes base stats and stat counters', () => {
    const state = createGame(settings, players, data, 7);
    expect(getUnitStats(state, 0, 'villager', data).hp).toBe(25);
    expect(getBuildingStats(state, 0, 'house', data).housing).toBe(4);
    expect(() => getUnitStats(state, 0, 'dragon', data)).toThrow();
    recordStat(state, 0, 'foodGathered', 10);
    recordStat(state, 0, 'foodGathered', 5);
    expect(state.players[0].stats.foodGathered).toBe(15);
  });
});
