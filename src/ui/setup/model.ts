import type { AgeId, AiDifficulty, GameData, MapSizeId, MapTypeId } from '../../data/types';
import { AGE_ORDER, AI_DIFFICULTIES } from '../../data/types';
import type { PlayerSetup, Settings, StartMode, VictoryMode } from '../../sim/types';
import { DEFAULT_RESOURCE_LEVEL, MAX_PLAYERS, START_MODES } from '../../sim/types';
import type { NewGameSetup } from '../../storage/api';

export const HUMAN_PLAYER_ID = 0;

export const RANDOM_CIVILIZATION = 'random';

export const MIN_PLAYERS = 2;

export const TEAM_COUNT = 4;

export const MAX_SEED = 0xffffffff;

export const PLAYER_COLORS: readonly number[] = [
  0x2f6fde, 0xd9412f, 0xe8c531, 0x3aa655, 0x8e44ad, 0xe67e22, 0x1abc9c, 0x9aa0a6,
];

export const VICTORY_MODES: readonly VictoryMode[] = ['conquest', 'standard'];

export type StartChoice = AgeId | Exclude<StartMode, 'standard'>;

const DEFAULT_DIFFICULTY: AiDifficulty = 'moderate';

export interface SetupPlayer {
  civilization: string;
  team: number | null;
  color: number;
  difficulty: AiDifficulty;
}

export interface SetupState {
  settings: Settings;
  seed: number;
  seedText: string;
  players: SetupPlayer[];
}

export type SetupIssue = 'single_team' | 'invalid_seed' | 'player_count' | 'duplicate_color';

export type RandomSource = () => number;

export function randomSeed(random: RandomSource = Math.random): number {
  return Math.floor(random() * MAX_SEED) >>> 0;
}

export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,10}$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return value <= MAX_SEED ? value : null;
}

function freeColor(players: readonly SetupPlayer[]): number {
  const used = new Set(players.map((player) => player.color));
  return PLAYER_COLORS.find((color) => !used.has(color)) ?? PLAYER_COLORS[0];
}

function newPlayer(players: readonly SetupPlayer[]): SetupPlayer {
  return {
    civilization: RANDOM_CIVILIZATION,
    team: null,
    color: freeColor(players),
    difficulty: DEFAULT_DIFFICULTY,
  };
}

export function defaultSettings(data: GameData): Settings {
  return {
    mapType: 'inland',
    mapSize: 'small',
    victoryMode: 'standard',
    populationLimit: data.game.populationLimits[0] ?? 50,
    startingAge: 'stone',
    revealMap: false,
    lockTeams: false,
    speed: 'normal',
    resourceLevel: DEFAULT_RESOURCE_LEVEL,
    startMode: 'standard',
    fullTechTree: false,
    noFog: false,
    sandbox: false,
  };
}

export function resourceLevelIds(data: GameData): string[] {
  return [DEFAULT_RESOURCE_LEVEL, ...Object.keys(data.game.resourceLevels ?? {})];
}

export function startChoices(): readonly StartChoice[] {
  return ['nomad', ...AGE_ORDER, 'post_iron'];
}

export function startChoiceOf(settings: Settings): StartChoice {
  const mode = settings.startMode ?? 'standard';
  return mode === 'standard' ? settings.startingAge : mode;
}

export function startChoicePatch(choice: StartChoice): Partial<Settings> {
  if (choice === 'nomad') {
    return { startMode: 'nomad', startingAge: AGE_ORDER[0] };
  }
  if (choice === 'post_iron') {
    return { startMode: 'post_iron', startingAge: AGE_ORDER[AGE_ORDER.length - 1] };
  }
  return { startMode: 'standard', startingAge: choice };
}

export function defaultSetup(data: GameData, seed: number): SetupState {
  const players: SetupPlayer[] = [];
  for (let index = 0; index < MIN_PLAYERS; index++) {
    players.push(newPlayer(players));
  }
  return { settings: defaultSettings(data), seed, seedText: String(seed), players };
}

function sanitizeSettings(saved: Settings, data: GameData): Settings {
  const fallback = defaultSettings(data);
  const settings: Settings = {
    mapType: saved.mapType in data.mapTypes ? saved.mapType : fallback.mapType,
    mapSize: saved.mapSize in data.mapSizes ? saved.mapSize : fallback.mapSize,
    victoryMode: VICTORY_MODES.includes(saved.victoryMode) ? saved.victoryMode : fallback.victoryMode,
    populationLimit: data.game.populationLimits.includes(saved.populationLimit)
      ? saved.populationLimit
      : fallback.populationLimit,
    startingAge: AGE_ORDER.includes(saved.startingAge) ? saved.startingAge : fallback.startingAge,
    revealMap: saved.revealMap === true,
    lockTeams: saved.lockTeams === true,
    speed: saved.speed in data.game.speedMultipliers ? saved.speed : fallback.speed,
    resourceLevel:
      saved.resourceLevel !== undefined && resourceLevelIds(data).includes(saved.resourceLevel)
        ? saved.resourceLevel
        : fallback.resourceLevel,
    startMode:
      saved.startMode !== undefined && START_MODES.includes(saved.startMode)
        ? saved.startMode
        : fallback.startMode,
    fullTechTree: saved.fullTechTree === true,
    noFog: saved.noFog === true,
    sandbox: saved.sandbox === true,
  };
  return { ...settings, ...startChoicePatch(startChoiceOf(settings)) };
}

function sanitizePlayer(saved: PlayerSetup, players: readonly SetupPlayer[], data: GameData): SetupPlayer {
  const used = new Set(players.map((player) => player.color));
  const team =
    typeof saved.team === 'number' && saved.team >= 1 && saved.team <= TEAM_COUNT ? saved.team : null;
  return {
    civilization: saved.civilization in data.civilizations ? saved.civilization : RANDOM_CIVILIZATION,
    team,
    color: PLAYER_COLORS.includes(saved.color) && !used.has(saved.color) ? saved.color : freeColor(players),
    difficulty:
      saved.difficulty !== null && AI_DIFFICULTIES.includes(saved.difficulty)
        ? saved.difficulty
        : DEFAULT_DIFFICULTY,
  };
}

export function setupFromSaved(saved: NewGameSetup | null, data: GameData, seed: number): SetupState {
  if (!saved || !Array.isArray(saved.players) || saved.players.length < MIN_PLAYERS) {
    return defaultSetup(data, seed);
  }
  const players: SetupPlayer[] = [];
  for (const player of saved.players.slice(0, MAX_PLAYERS)) {
    players.push(sanitizePlayer(player, players, data));
  }
  return { settings: sanitizeSettings(saved.settings, data), seed, seedText: String(seed), players };
}

export function setPlayerCount(state: SetupState, count: number): SetupState {
  const target = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(count)));
  const players = state.players.slice(0, target);
  while (players.length < target) {
    players.push(newPlayer(players));
  }
  return { ...state, players };
}

export function updatePlayer(state: SetupState, index: number, patch: Partial<SetupPlayer>): SetupState {
  const players = state.players.map((player, at) => {
    if (at === index) {
      return { ...player, ...patch };
    }
    if (patch.color !== undefined && player.color === patch.color) {
      return { ...player, color: state.players[index].color };
    }
    return player;
  });
  return { ...state, players };
}

export function updateSettings(state: SetupState, patch: Partial<Settings>): SetupState {
  return { ...state, settings: { ...state.settings, ...patch } };
}

export function setSeedText(state: SetupState, text: string): SetupState {
  const parsed = parseSeed(text);
  return { ...state, seedText: text, seed: parsed ?? state.seed };
}

export function validateSetup(state: SetupState): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const count = state.players.length;
  if (count < MIN_PLAYERS || count > MAX_PLAYERS) {
    issues.push('player_count');
  }
  if (parseSeed(state.seedText) === null) {
    issues.push('invalid_seed');
  }
  const firstTeam = state.players[0]?.team ?? null;
  if (firstTeam !== null && state.players.every((player) => player.team === firstTeam)) {
    issues.push('single_team');
  }
  if (new Set(state.players.map((player) => player.color)).size !== count) {
    issues.push('duplicate_color');
  }
  return issues;
}

function toPlayerSetups(state: SetupState, civilizationOf: (player: SetupPlayer) => string): PlayerSetup[] {
  return state.players.map((player, index) => ({
    id: index,
    kind: index === HUMAN_PLAYER_ID ? 'human' : 'ai',
    civilization: civilizationOf(player),
    team: player.team,
    color: player.color,
    difficulty: index === HUMAN_PLAYER_ID ? null : player.difficulty,
  }));
}

export function rememberedSetup(state: SetupState): NewGameSetup {
  return {
    settings: { ...state.settings },
    seed: state.seed,
    players: toPlayerSetups(state, (player) => player.civilization),
  };
}

export function buildNewGame(
  state: SetupState,
  data: GameData,
  random: RandomSource = Math.random,
): NewGameSetup {
  const civilizations = Object.keys(data.civilizations);
  const pick = (player: SetupPlayer): string => {
    if (player.civilization !== RANDOM_CIVILIZATION) {
      return player.civilization;
    }
    const index = Math.min(civilizations.length - 1, Math.floor(random() * civilizations.length));
    return civilizations[index];
  };
  return {
    settings: { ...state.settings },
    seed: state.seed,
    players: toPlayerSetups(state, pick),
  };
}

export function mapTypeIds(data: GameData): MapTypeId[] {
  return data.maps.types.map((type) => type.id);
}

export function mapSizeIds(data: GameData): MapSizeId[] {
  return data.maps.sizes.map((size) => size.id);
}

export function ageIds(): readonly AgeId[] {
  return AGE_ORDER;
}
