import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS } from '../../sim/types';
import {
  HUMAN_PLAYER_ID,
  MAX_SEED,
  MIN_PLAYERS,
  RANDOM_CIVILIZATION,
  buildNewGame,
  defaultSetup,
  parseSeed,
  randomSeed,
  rememberedSetup,
  resourceLevelIds,
  setPlayerCount,
  setSeedText,
  setupFromSaved,
  startChoiceOf,
  startChoicePatch,
  startChoices,
  updatePlayer,
  updateSettings,
  validateSetup,
} from '../setup/model';
import en from '../../locales/en.json';
import ru from '../../locales/ru.json';
import type { Settings } from '../../sim/types';
import { data } from './fixtures';

describe('setup model', () => {
  it('starts valid with two players of distinct colors and no teams', () => {
    const state = defaultSetup(data, 42);
    expect(state.players).toHaveLength(MIN_PLAYERS);
    expect(state.seedText).toBe('42');
    expect(validateSetup(state)).toEqual([]);
  });

  it('keeps the player count between 2 and 8 with unique colors', () => {
    let state = defaultSetup(data, 1);
    state = setPlayerCount(state, 20);
    expect(state.players).toHaveLength(MAX_PLAYERS);
    expect(new Set(state.players.map((player) => player.color)).size).toBe(MAX_PLAYERS);
    expect(validateSetup(state)).toEqual([]);
    state = setPlayerCount(state, 0);
    expect(state.players).toHaveLength(MIN_PLAYERS);
  });

  it('blocks the start while all players share one team', () => {
    let state = setPlayerCount(defaultSetup(data, 1), 3);
    for (let index = 0; index < 3; index++) {
      state = updatePlayer(state, index, { team: 1 });
    }
    expect(validateSetup(state)).toEqual(['single_team']);
    state = updatePlayer(state, 2, { team: 2 });
    expect(validateSetup(state)).toEqual([]);
    state = updatePlayer(state, 2, { team: null });
    expect(validateSetup(state)).toEqual([]);
  });

  it('swaps colors instead of duplicating them', () => {
    const state = defaultSetup(data, 1);
    const [first, second] = state.players.map((player) => player.color);
    const next = updatePlayer(state, 0, { color: second });
    expect(next.players.map((player) => player.color)).toEqual([second, first]);
  });

  it('parses and validates the seed', () => {
    expect(parseSeed(' 123 ')).toBe(123);
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed(String(MAX_SEED))).toBe(MAX_SEED);
    expect(parseSeed(String(MAX_SEED + 1))).toBeNull();
    expect(parseSeed('-5')).toBeNull();
    expect(parseSeed('1.5')).toBeNull();
    expect(parseSeed('abc')).toBeNull();
    expect(parseSeed('')).toBeNull();
    const state = setSeedText(defaultSetup(data, 9), 'x');
    expect(state.seed).toBe(9);
    expect(validateSetup(state)).toEqual(['invalid_seed']);
    expect(setSeedText(state, '77').seed).toBe(77);
    expect(randomSeed(() => 0.5)).toBe(Math.floor(0.5 * MAX_SEED));
  });

  it('builds simulation players and resolves random civilizations', () => {
    let state = setPlayerCount(defaultSetup(data, 5), 3);
    state = updatePlayer(state, 1, { civilization: 'greek', difficulty: 'hard', team: 2 });
    const game = buildNewGame(state, data, () => 0);
    const firstCivilization = Object.keys(data.civilizations)[0];
    expect(game.seed).toBe(5);
    expect(game.players.map((player) => player.id)).toEqual([0, 1, 2]);
    expect(game.players[HUMAN_PLAYER_ID]).toMatchObject({
      kind: 'human',
      difficulty: null,
      civilization: firstCivilization,
    });
    expect(game.players[1]).toMatchObject({
      kind: 'ai',
      civilization: 'greek',
      difficulty: 'hard',
      team: 2,
    });
    expect(game.players[2].civilization).toBe(firstCivilization);
    expect(buildNewGame(state, data, () => 0.9999).players[2].civilization in data.civilizations).toBe(true);
  });

  it('remembers the last setup and sanitizes stored values', () => {
    let state = setPlayerCount(defaultSetup(data, 5), 4);
    state = updatePlayer(state, 3, { civilization: 'yamato', team: 3 });
    const remembered = rememberedSetup(state);
    expect(remembered.players[0].civilization).toBe(RANDOM_CIVILIZATION);
    const restored = setupFromSaved(remembered, data, 11);
    expect(restored.seed).toBe(11);
    expect(restored.players).toEqual(state.players);
    expect(restored.settings).toEqual(state.settings);
    const broken = structuredClone(remembered);
    broken.players[1].civilization = 'atlantean';
    broken.players[1].color = broken.players[0].color;
    broken.settings.populationLimit = 9999;
    const fixed = setupFromSaved(broken, data, 1);
    expect(fixed.players[1].civilization).toBe(RANDOM_CIVILIZATION);
    expect(validateSetup(fixed)).toEqual([]);
    expect(fixed.settings.populationLimit).toBe(data.game.populationLimits[0]);
    expect(setupFromSaved(null, data, 3).players).toHaveLength(MIN_PLAYERS);
  });

  it('defaults the match options to the classic start', () => {
    const settings = defaultSetup(data, 1).settings;
    expect(settings.resourceLevel).toBe('default');
    expect(settings.startMode).toBe('standard');
    expect(settings.fullTechTree).toBe(false);
    expect(startChoiceOf(settings)).toBe('stone');
    expect(resourceLevelIds(data)).toEqual(['default', ...Object.keys(data.game.resourceLevels ?? {})]);
  });

  it('maps the starting age selector to the age and the start mode', () => {
    expect(startChoices()).toEqual(['nomad', 'stone', 'tool', 'bronze', 'iron', 'post_iron']);
    let state = defaultSetup(data, 1);
    state = updateSettings(state, startChoicePatch('nomad'));
    expect(state.settings).toMatchObject({ startMode: 'nomad', startingAge: 'stone' });
    expect(startChoiceOf(state.settings)).toBe('nomad');
    state = updateSettings(state, startChoicePatch('post_iron'));
    expect(state.settings).toMatchObject({ startMode: 'post_iron', startingAge: 'iron' });
    state = updateSettings(state, startChoicePatch('bronze'));
    expect(state.settings).toMatchObject({ startMode: 'standard', startingAge: 'bronze' });
    expect(startChoiceOf(state.settings)).toBe('bronze');
  });

  it('restores the match options and fills them in for setups stored before they existed', () => {
    let state = defaultSetup(data, 5);
    state = updateSettings(state, {
      ...startChoicePatch('post_iron'),
      resourceLevel: 'high',
      fullTechTree: true,
    });
    const remembered = rememberedSetup(state);
    expect(buildNewGame(state, data, () => 0).settings).toMatchObject({
      startMode: 'post_iron',
      resourceLevel: 'high',
      fullTechTree: true,
    });
    expect(setupFromSaved(remembered, data, 5).settings).toEqual(state.settings);

    const old = structuredClone(remembered);
    delete old.settings.resourceLevel;
    delete old.settings.startMode;
    delete old.settings.fullTechTree;
    old.settings.startingAge = 'tool';
    expect(setupFromSaved(old, data, 5).settings).toMatchObject({
      startingAge: 'tool',
      resourceLevel: 'default',
      startMode: 'standard',
      fullTechTree: false,
    });

    const broken = structuredClone(remembered);
    broken.settings.resourceLevel = 'infinite';
    broken.settings.startMode = 'regicide' as Settings['startMode'];
    broken.settings.fullTechTree = 'yes' as unknown as boolean;
    expect(setupFromSaved(broken, data, 5).settings).toMatchObject({
      resourceLevel: 'default',
      startMode: 'standard',
      fullTechTree: false,
    });

    const nomad = structuredClone(remembered);
    nomad.settings.startMode = 'nomad';
    nomad.settings.startingAge = 'iron';
    expect(setupFromSaved(nomad, data, 5).settings).toMatchObject({
      startMode: 'nomad',
      startingAge: 'stone',
    });
  });

  it('has labels for every resource level and start choice in both languages', () => {
    const keys = [
      ...resourceLevelIds(data).map((id) => `ui.resource_level.${id}`),
      'ui.start.nomad',
      'ui.start.post_iron',
      'ui.start.nomad.desc',
      'ui.start.post_iron.desc',
      'ui.setup.resource_level',
      'ui.setup.full_tech_tree',
      'ui.setup.full_tech_tree_hint',
    ];
    for (const key of keys) {
      expect(en).toHaveProperty([key]);
      expect(ru).toHaveProperty([key]);
    }
  });
});
