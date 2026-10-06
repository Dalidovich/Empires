import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../data';
import { AI_DIFFICULTIES } from '../../data/types';
import type { BatchGame } from './batch';
import { playGame } from './batch';

const data = loadGameData();
const enabled = process.env.AI_BATCH === '1';
const MAX_TICKS = 200000;
const GAME_TIMEOUT = 900000;

function mirror(level: (typeof AI_DIFFICULTIES)[number], map: BatchGame['map']): BatchGame {
  return {
    seed: 1,
    map,
    size: 'tiny',
    maxTicks: MAX_TICKS,
    players: [
      { civilization: 'assyrian', difficulty: level },
      { civilization: 'greek', difficulty: level },
    ],
  };
}

describe.runIf(enabled)('ai headless batches', () => {
  for (const level of AI_DIFFICULTIES) {
    it(
      `${level} against ${level} reaches the Iron Age and finishes with a winner`,
      () => {
        const result = playGame(mirror(level, 'inland'), data);
        expect(result.winners).toHaveLength(1);
        expect(result.ticks).toBeLessThan(MAX_TICKS);
        const winner = result.winners?.[0] ?? 0;
        expect(result.ironAgeTicks[winner]).toBeGreaterThan(0);
      },
      GAME_TIMEOUT,
    );
  }

  it(
    'hardest beats easiest in at least 9 of 10 seeds',
    () => {
      let wins = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const strongFirst = seed % 2 === 0;
        const result = playGame(
          {
            seed,
            map: 'inland',
            size: 'tiny',
            maxTicks: MAX_TICKS,
            players: [
              { civilization: 'assyrian', difficulty: strongFirst ? 'hardest' : 'easiest' },
              { civilization: 'greek', difficulty: strongFirst ? 'easiest' : 'hardest' },
            ],
          },
          data,
        );
        const strong = strongFirst ? 0 : 1;
        if (result.winners?.length === 1 && result.winners[0] === strong) {
          wins += 1;
        }
      }
      expect(wins).toBeGreaterThanOrEqual(9);
    },
    GAME_TIMEOUT * 4,
  );

  it(
    'lands troops on the enemy island on Small Islands',
    () => {
      const result = playGame(mirror('hard', 'small_islands'), data);
      expect(result.landings.some((tick) => tick > 0)).toBe(true);
    },
    GAME_TIMEOUT,
  );

  it(
    'gives byte-identical results for equal parameters',
    () => {
      const game = { ...mirror('hardest', 'inland'), maxTicks: 20000 };
      expect(JSON.stringify(playGame(game, data))).toBe(JSON.stringify(playGame(game, data)));
    },
    GAME_TIMEOUT,
  );
});
