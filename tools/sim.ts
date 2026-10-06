import { loadGameData } from '../src/data';
import { AI_DIFFICULTIES } from '../src/data/types';
import type { AiDifficulty, GameData, MapSizeId, MapTypeId } from '../src/data/types';
import { advanceSession, startSession } from '../src/sim/core/session';
import type { SimLogger } from '../src/sim/system';
import type { PlayerSetup, PlayerStats, Settings, StartMode } from '../src/sim/types';
import { DEFAULT_RESOURCE_LEVEL, START_MODES } from '../src/sim/types';

const EXIT_FINISHED = 0;
const EXIT_ERROR = 1;
const EXIT_MAX_TICKS = 2;

const PLAYER_COLORS = [
  0x2f6fde, 0xd9412f, 0xe8c63a, 0x3fae5a, 0x8e52c7, 0xe58a2b, 0x4fc3d9, 0x9a9a9a,
];

export interface SimArgs {
  seed: number;
  map: MapTypeId;
  size: MapSizeId;
  players: { civilization: string; difficulty: AiDifficulty }[];
  maxTicks: number;
  resources?: string;
  start?: StartMode;
  fullTechTree?: boolean;
}

export interface SimResult {
  winner: number[] | null;
  ticks: number;
  players: {
    id: number;
    civilization: string;
    difficulty: AiDifficulty | null;
    defeated: boolean;
    stats: PlayerStats;
  }[];
}

export class SimulationError extends Error {
  readonly tick: number;

  constructor(tick: number, message: string) {
    super(message);
    this.name = 'SimulationError';
    this.tick = tick;
  }
}

const DEFAULT_ARGS: SimArgs = {
  seed: 1,
  map: 'inland',
  size: 'tiny',
  players: [
    { civilization: 'assyrian', difficulty: 'moderate' },
    { civilization: 'greek', difficulty: 'moderate' },
  ],
  maxTicks: 200000,
};

function readInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${name}: ${value}`);
  }
  return parsed;
}

function parsePlayers(value: string, data: GameData): SimArgs['players'] {
  const players = value.split(',').map((entry) => {
    const [civilization, level = 'moderate'] = entry.split(':');
    if (!data.civilizations[civilization]) {
      throw new Error(`Unknown civilization: ${civilization}`);
    }
    if (!AI_DIFFICULTIES.includes(level as AiDifficulty)) {
      throw new Error(`Unknown difficulty: ${level}`);
    }
    return { civilization, difficulty: level as AiDifficulty };
  });
  if (players.length < 2 || players.length > 8) {
    throw new Error('Expected 2 to 8 players');
  }
  return players;
}

export function parseArgs(argv: readonly string[], data: GameData): SimArgs {
  const args: SimArgs = { ...DEFAULT_ARGS };
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${name}`);
    }
    switch (name) {
      case '--seed':
        args.seed = readInteger(name, value);
        break;
      case '--map':
        if (!(value in data.mapTypes)) {
          throw new Error(`Unknown map type: ${value}`);
        }
        args.map = value as MapTypeId;
        break;
      case '--size':
        if (!(value in data.mapSizes)) {
          throw new Error(`Unknown map size: ${value}`);
        }
        args.size = value as MapSizeId;
        break;
      case '--players':
        args.players = parsePlayers(value, data);
        break;
      case '--max-ticks':
        args.maxTicks = readInteger(name, value);
        break;
      case '--resources':
        if (value !== DEFAULT_RESOURCE_LEVEL && !data.game.resourceLevels?.[value]) {
          throw new Error(`Unknown resource level: ${value}`);
        }
        args.resources = value;
        break;
      case '--start':
        if (!START_MODES.includes(value as StartMode)) {
          throw new Error(`Unknown start mode: ${value}`);
        }
        args.start = value as StartMode;
        break;
      case '--full-tech-tree':
        if (value !== 'true' && value !== 'false') {
          throw new Error(`Invalid value for ${name}: ${value}`);
        }
        args.fullTechTree = value === 'true';
        break;
      default:
        throw new Error(`Unknown argument: ${name}`);
    }
  }
  return args;
}

export function runSimulation(args: SimArgs, data: GameData, log: SimLogger): SimResult {
  const settings: Settings = {
    mapType: args.map,
    mapSize: args.size,
    victoryMode: 'conquest',
    populationLimit: 50,
    startingAge: 'stone',
    revealMap: false,
    lockTeams: true,
    speed: 'normal',
  };
  if (args.resources !== undefined) {
    settings.resourceLevel = args.resources;
  }
  if (args.start !== undefined) {
    settings.startMode = args.start;
  }
  if (args.fullTechTree !== undefined) {
    settings.fullTechTree = args.fullTechTree;
  }
  const setups: PlayerSetup[] = args.players.map((player, index) => ({
    id: index,
    kind: 'ai',
    civilization: player.civilization,
    team: null,
    color: PLAYER_COLORS[index],
    difficulty: player.difficulty,
  }));
  const session = startSession(settings, setups, args.seed, data, log);
  const { state } = session;

  while (state.outcome === null && state.tick < args.maxTicks) {
    try {
      advanceSession(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log('error', state.tick, message);
      throw new SimulationError(state.tick, message);
    }
  }

  return {
    winner: state.outcome ? state.outcome.winners : null,
    ticks: state.tick,
    players: state.players.map((player) => ({
      id: player.id,
      civilization: player.civilization,
      difficulty: player.difficulty,
      defeated: player.defeated,
      stats: player.stats,
    })),
  };
}

const stderrLogger: SimLogger = (level, tick, message) => {
  process.stderr.write(`[${level}] [tick ${tick}] ${message}\n`);
};

export function main(argv: readonly string[]): number {
  try {
    const data = loadGameData();
    const result = runSimulation(parseArgs(argv, data), data, stderrLogger);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.winner === null ? EXIT_MAX_TICKS : EXIT_FINISHED;
  } catch (error) {
    process.stderr.write(`[error] ${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_ERROR;
  }
}

if (process.argv[1] && /sim\.ts$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
