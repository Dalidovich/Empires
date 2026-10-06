import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { AI_DIFFICULTIES } from '../../src/data/types';
import type { AiDifficulty, MapSizeId, MapTypeId } from '../../src/data/types';
import type { BatchResult } from '../../src/ai/__tests__/batch';
import { STAT_KEYS } from '../../src/sim/playerStats';
import type { CliRun } from './support/cli';
import { runPool, runScript, runSim, simResult } from './support/cli';

const MAP_TYPES: readonly MapTypeId[] = ['small_islands', 'large_islands', 'coastal', 'inland', 'highland'];
const MAP_SIZES: readonly MapSizeId[] = ['tiny', 'small', 'medium', 'large', 'huge'];
const MAX_TICKS = 200000;
const SUITE_TIMEOUT_MS = 60 * 60 * 1000;
const DOMINANCE_SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const LOG_LINE = /^\[(warn|error)\] \[tick \d+\] .+$/;
const RESULTS_FILE = join(process.cwd(), 'tests', 'acceptance', 'results', 'headless.json');

function simArgs(
  map: MapTypeId,
  size: MapSizeId,
  first: AiDifficulty,
  second: AiDifficulty,
  seed: number,
  maxTicks = MAX_TICKS,
): string[] {
  return [
    '--seed',
    String(seed),
    '--map',
    map,
    '--size',
    size,
    '--players',
    `assyrian:${first},greek:${second}`,
    '--max-ticks',
    String(maxTicks),
  ];
}

interface Suite {
  matrix: Map<string, CliRun>;
  mirror: Map<AiDifficulty, CliRun>;
  dominance: Map<number, CliRun>;
  islands: Map<AiDifficulty, BatchResult>;
  repeat: [CliRun, CliRun];
  limited: [CliRun, CliRun];
  invalid: CliRun;
}

function strongSide(seed: number): number {
  return seed % 2 === 0 ? 0 : 1;
}

async function runSuite(): Promise<Suite> {
  const suite: Suite = {
    matrix: new Map(),
    mirror: new Map(),
    dominance: new Map(),
    islands: new Map(),
    repeat: [] as unknown as [CliRun, CliRun],
    limited: [] as unknown as [CliRun, CliRun],
    invalid: null as unknown as CliRun,
  };
  const tasks: (() => Promise<void>)[] = [];
  for (const size of [...MAP_SIZES].reverse()) {
    for (const map of MAP_TYPES) {
      tasks.push(async () => {
        suite.matrix.set(`${map}/${size}`, await runSim(simArgs(map, size, 'moderate', 'moderate', 1)));
      });
    }
  }
  for (const level of AI_DIFFICULTIES) {
    tasks.push(async () => {
      suite.mirror.set(level, await runSim(simArgs('inland', 'tiny', level, level, 1)));
    });
    tasks.push(async () => {
      const run = await runScript('src/ai/__tests__/batch.ts', [
        '--suite',
        'islands',
        '--levels',
        level,
        '--seeds',
        '1',
        '--max-ticks',
        String(MAX_TICKS),
      ]);
      suite.islands.set(level, JSON.parse(run.stdout) as BatchResult);
    });
  }
  for (const seed of DOMINANCE_SEEDS) {
    tasks.push(async () => {
      const strongFirst = strongSide(seed) === 0;
      suite.dominance.set(
        seed,
        await runSim(
          simArgs('inland', 'tiny', strongFirst ? 'hardest' : 'easiest', strongFirst ? 'easiest' : 'hardest', seed),
        ),
      );
    });
  }
  for (const index of [0, 1]) {
    tasks.push(async () => {
      suite.repeat[index] = await runSim(simArgs('coastal', 'tiny', 'hard', 'hard', 7));
    });
    tasks.push(async () => {
      suite.limited[index] = await runSim(simArgs('highland', 'small', 'hardest', 'easy', 11, 6000));
    });
  }
  tasks.push(async () => {
    suite.invalid = await runSim(['--map', 'moon']);
  });
  await runPool(tasks);
  return suite;
}

function brief(run: CliRun): Record<string, unknown> {
  if (run.code === 1) {
    return { code: run.code, seconds: run.seconds, stderr: run.stderr.trim() };
  }
  const result = simResult(run);
  return {
    code: run.code,
    seconds: Math.round(run.seconds),
    winner: result.winner,
    ticks: result.ticks,
    ironAgeTicks: result.players.map((player) => player.stats.ironAgeTick),
    scores: result.players.map((player) => player.stats.score),
  };
}

function writeResults(suite: Suite): void {
  const entries = <K, V>(map: Map<K, V>, format: (value: V) => unknown): Record<string, unknown> =>
    Object.fromEntries([...map.entries()].map(([key, value]) => [String(key), format(value)]));
  mkdirSync(join(RESULTS_FILE, '..'), { recursive: true });
  writeFileSync(
    RESULTS_FILE,
    `${JSON.stringify(
      {
        matrix: entries(suite.matrix, brief),
        mirror: entries(suite.mirror, brief),
        dominance: entries(suite.dominance, brief),
        islands: entries(suite.islands, (result) => result),
        repeat: suite.repeat.map(brief),
        limited: suite.limited.map(brief),
      },
      null,
      2,
    )}\n`,
  );
}

describe('headless games through the CLI', () => {
  let suite: Suite;

  beforeAll(async () => {
    suite = await runSuite();
    writeResults(suite);
  }, SUITE_TIMEOUT_MS);

  describe('criterion 1: every map type and size plays to the end', () => {
    for (const map of MAP_TYPES) {
      for (const size of MAP_SIZES) {
        it(`${map} / ${size}`, () => {
          const run = suite.matrix.get(`${map}/${size}`);
          expect(run?.code, run?.stderr).toBe(0);
          if (!run) {
            return;
          }
          const result = simResult(run);
          expect(result.winner?.length).toBeGreaterThan(0);
          expect(result.ticks).toBeLessThan(MAX_TICKS);
          expect(result.players).toHaveLength(2);
          for (const player of result.players) {
            expect(Object.keys(player.stats).sort()).toEqual([...STAT_KEYS].sort());
            expect(player.defeated).toBe(!result.winner?.includes(player.id));
          }
        });
      }
    }
  });

  describe('criterion 5: AI levels', () => {
    for (const level of AI_DIFFICULTIES) {
      it(`${level} against ${level} reaches the Iron Age and one side wins`, () => {
        const run = suite.mirror.get(level);
        expect(run?.code, run?.stderr).toBe(0);
        if (!run) {
          return;
        }
        const result = simResult(run);
        expect(result.winner).toHaveLength(1);
        expect(result.ticks).toBeLessThan(MAX_TICKS);
        const winner = result.winner?.[0] ?? 0;
        expect(result.players[winner].stats.ironAgeTick).toBeGreaterThan(0);
      });
    }

    it('hardest beats easiest in at least 9 of 10 seeds', () => {
      let wins = 0;
      for (const seed of DOMINANCE_SEEDS) {
        const run = suite.dominance.get(seed);
        expect(run?.code, run?.stderr).toBe(0);
        if (!run) {
          continue;
        }
        const result = simResult(run);
        const strong = strongSide(seed);
        expect(result.players[strong].difficulty).toBe('hardest');
        if (result.winner?.length === 1 && result.winner[0] === strong) {
          wins += 1;
        }
      }
      expect(wins).toBeGreaterThanOrEqual(9);
    });
  });

  describe('criterion 6: island landings', () => {
    for (const level of AI_DIFFICULTIES) {
      it(`${level} lands troops near the enemy start on Small Islands`, () => {
        const result = suite.islands.get(level);
        expect(result?.map).toBe('small_islands');
        expect(result?.landings.some((tick) => tick > 0)).toBe(true);
      });
    }
  });

  describe('criterion 13: equal parameters give byte-identical output', () => {
    it('for a game played to the end', () => {
      const [first, second] = suite.repeat;
      expect(first.code).toBe(0);
      expect(first.stdout.length).toBeGreaterThan(0);
      expect(Buffer.from(second.stdout).equals(Buffer.from(first.stdout))).toBe(true);
      expect(second.code).toBe(first.code);
    });

    it('for a game stopped by the tick limit', () => {
      const [first, second] = suite.limited;
      expect(first.code).toBe(2);
      expect(simResult(first).winner).toBeNull();
      expect(simResult(first).ticks).toBe(6000);
      expect(Buffer.from(second.stdout).equals(Buffer.from(first.stdout))).toBe(true);
    });
  });

  describe('CLI contract', () => {
    it('prints only the JSON result on stdout', () => {
      for (const run of [...suite.matrix.values(), ...suite.mirror.values()]) {
        expect(run.stdout.trim().split('\n')).toHaveLength(1);
        const result = simResult(run);
        expect(Object.keys(result).sort()).toEqual(['players', 'ticks', 'winner']);
      }
    });

    it('writes the log to stderr with the simulation tick', () => {
      const lines = [...suite.matrix.values(), ...suite.mirror.values(), ...suite.dominance.values()]
        .flatMap((run) => run.stderr.split('\n'))
        .filter((line) => line.trim().length > 0);
      expect(lines.filter((line) => !LOG_LINE.test(line))).toEqual([]);
      expect(lines.filter((line) => line.startsWith('[error]'))).toEqual([]);
    });

    it('exits with code 1 and an error line on invalid input', () => {
      expect(suite.invalid.code).toBe(1);
      expect(suite.invalid.stdout).toBe('');
      expect(suite.invalid.stderr).toMatch(/^\[error\] /);
    });
  });
});
