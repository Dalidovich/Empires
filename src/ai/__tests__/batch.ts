import { loadGameData } from '../../data';
import { AI_DIFFICULTIES } from '../../data/types';
import type { AiDifficulty, GameData, MapSizeId, MapTypeId } from '../../data/types';
import { advanceSession, startSession } from '../../sim/core/session';
import type { GameState, PlayerSetup, Settings, Vec2 } from '../../sim/types';

export interface BatchGame {
  seed: number;
  map: MapTypeId;
  size: MapSizeId;
  players: { civilization: string; difficulty: AiDifficulty }[];
  maxTicks: number;
}

export interface BatchResult {
  seed: number;
  map: MapTypeId;
  levels: AiDifficulty[];
  winners: number[] | null;
  ticks: number;
  ironAgeTicks: number[];
  landings: number[];
  digest: string;
}

const LANDING_RADIUS = 12;
const LANDING_CHECK_INTERVAL = 100;

function startPositions(state: GameState, data: GameData): Vec2[] {
  return state.players.map((player) => {
    const start = Object.values(state.entities).find(
      (entity) => entity.owner === player.id && entity.type === data.game.start.building,
    );
    return start ? { x: start.position.x, y: start.position.y } : { x: 0, y: 0 };
  });
}

function recordLandings(
  state: GameState,
  data: GameData,
  homes: readonly Vec2[],
  landings: number[],
): void {
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'unit' || entity.carriedBy !== null || landings[entity.owner] !== 0) {
      continue;
    }
    const def = data.units[entity.type];
    if (!def || !def.class.includes('military') || def.domain !== 'land') {
      continue;
    }
    for (const player of state.players) {
      const home = homes[player.id];
      if (
        player.id !== entity.owner &&
        Math.hypot(entity.position.x - home.x, entity.position.y - home.y) <= LANDING_RADIUS
      ) {
        landings[entity.owner] = state.tick;
      }
    }
  }
}

function digestOf(state: GameState): string {
  const text = JSON.stringify({
    tick: state.tick,
    outcome: state.outcome,
    players: state.players.map((player) => ({ stats: player.stats, resources: player.resources })),
    entities: Object.keys(state.entities).length,
    rng: state.rngState,
  });
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  return hash.toString(16);
}

export function playGame(game: BatchGame, data: GameData): BatchResult {
  const settings: Settings = {
    mapType: game.map,
    mapSize: game.size,
    victoryMode: 'conquest',
    populationLimit: 50,
    startingAge: 'stone',
    revealMap: false,
    lockTeams: true,
    speed: 'normal',
  };
  const setups: PlayerSetup[] = game.players.map((player, index) => ({
    id: index,
    kind: 'ai',
    civilization: player.civilization,
    team: null,
    color: index,
    difficulty: player.difficulty,
  }));
  const session = startSession(settings, setups, game.seed, data, () => {});
  const { state } = session;
  const homes = startPositions(state, data);
  const landings = state.players.map(() => 0);
  while (state.outcome === null && state.tick < game.maxTicks) {
    advanceSession(session);
    if (state.tick % LANDING_CHECK_INTERVAL === 0) {
      recordLandings(state, data, homes, landings);
    }
  }
  return {
    seed: game.seed,
    map: game.map,
    levels: game.players.map((player) => player.difficulty),
    winners: state.outcome ? state.outcome.winners : null,
    ticks: state.tick,
    ironAgeTicks: state.players.map((player) => player.stats.ironAgeTick ?? 0),
    landings,
    digest: digestOf(state),
  };
}

function option(argv: readonly string[], name: string, fallback: string): string {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
}

function seedsOf(text: string): number[] {
  const [from, to = from] = text.split('-').map(Number);
  const seeds: number[] = [];
  for (let seed = from; seed <= to; seed++) {
    seeds.push(seed);
  }
  return seeds;
}

function suiteGames(argv: readonly string[]): BatchGame[] {
  const suite = option(argv, 'suite', 'mirror');
  const seeds = seedsOf(option(argv, 'seeds', '1'));
  const size = option(argv, 'size', 'tiny') as MapSizeId;
  const maxTicks = Number(option(argv, 'max-ticks', '200000'));
  const civilizations = option(argv, 'civs', 'assyrian,greek').split(',');
  const levels = option(argv, 'levels', AI_DIFFICULTIES.join(',')).split(',') as AiDifficulty[];
  const games: BatchGame[] = [];
  for (const seed of seeds) {
    if (suite === 'mirror' || suite === 'islands') {
      const map = option(argv, 'map', suite === 'islands' ? 'small_islands' : 'inland') as MapTypeId;
      for (const level of levels) {
        games.push({
          seed,
          map,
          size,
          maxTicks,
          players: civilizations.map((civilization) => ({ civilization, difficulty: level })),
        });
      }
    } else {
      const strongFirst = seed % 2 === 0;
      games.push({
        seed,
        map: option(argv, 'map', 'inland') as MapTypeId,
        size,
        maxTicks,
        players: [
          { civilization: civilizations[0], difficulty: strongFirst ? 'hardest' : 'easiest' },
          { civilization: civilizations[1], difficulty: strongFirst ? 'easiest' : 'hardest' },
        ],
      });
    }
  }
  return games;
}

export function runBatch(argv: readonly string[]): void {
  const data = loadGameData();
  for (const game of suiteGames(argv)) {
    process.stdout.write(`${JSON.stringify(playGame(game, data))}\n`);
  }
}

if (process.argv[1] && /batch\.ts$/.test(process.argv[1])) {
  runBatch(process.argv.slice(2));
}
