import { describe, expect, it } from 'vitest';
import { STAT_KEYS, recordStat } from '../../playerStats';
import { buildPlayerView } from '../../snapshot';
import { economyScore, militaryScore, technologyScore } from '../../systems/score';
import { context, data, run } from '../fixtures';
import { addBases, arena, eventsOf } from './fixtures';

describe('score', () => {
  it('combines military, economy and technology into the total', () => {
    const state = arena({ players: 2 });
    const ctx = context();
    addBases(state);
    recordStat(state, 0, 'unitsKilled', 5);
    recordStat(state, 0, 'buildingsRazed', 2);
    recordStat(state, 0, 'conversions', 1);
    recordStat(state, 0, 'unitsLost', 4);
    recordStat(state, 0, 'foodGathered', 300);
    recordStat(state, 0, 'woodGathered', 120);
    recordStat(state, 0, 'stoneGathered', 40);
    recordStat(state, 0, 'goldGathered', 60);
    recordStat(state, 0, 'tradeGold', 30);
    recordStat(state, 0, 'tributeSent', 100);
    recordStat(state, 0, 'technologiesResearched', 3);
    state.players[0].age = 'bronze';
    run(state, ctx, 1);

    const player = state.players[0];
    expect(militaryScore(player)).toBe(5 * 2 + 2 * 4 + 1 * 2);
    expect(economyScore(player)).toBe(65);
    expect(technologyScore(player, data)).toBe(3 * 10 + 2 * 50);
    expect(player.stats.militaryScore).toBe(20);
    expect(player.stats.economyScore).toBe(65);
    expect(player.stats.technologyScore).toBe(130);
    expect(player.stats.score).toBe(215);
    expect(state.players[1].stats.score).toBe(0);
    expect(buildPlayerView(state, 1, data).players[0].score).toBe(215);
  });

  it('reports every stat key of every player when the game ends', () => {
    const state = arena({ players: 3 });
    const ctx = context();
    addBases(state);
    recordStat(state, 2, 'woodGathered', 500);
    run(state, ctx, 1);
    const events = run(state, ctx, 1, [
      { type: 'resign', playerId: 0 },
      { type: 'resign', playerId: 1 },
    ]);
    const over = eventsOf(events, 'gameOver');
    expect(over).toHaveLength(1);
    expect(over[0].winners).toEqual([2]);
    expect(over[0].players).toHaveLength(3);
    for (const summary of over[0].players) {
      expect(Object.keys(summary.stats).sort()).toEqual([...STAT_KEYS].sort());
      expect(summary.stats).toEqual(state.players[summary.playerId].stats);
      expect(summary.stats).not.toBe(state.players[summary.playerId].stats);
    }
    expect(over[0].players[2].score).toBe(50);
  });
});
