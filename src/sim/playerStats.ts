import type { GameState, PlayerId, PlayerStats } from './types';

export const STAT_KEYS = [
  'unitsKilled',
  'unitsLost',
  'buildingsRazed',
  'buildingsLost',
  'unitsTrained',
  'buildingsBuilt',
  'conversions',
  'foodGathered',
  'woodGathered',
  'stoneGathered',
  'goldGathered',
  'tradeGold',
  'tributeSent',
  'tributeReceived',
  'technologiesResearched',
  'toolAgeTick',
  'bronzeAgeTick',
  'ironAgeTick',
  'score',
  'militaryScore',
  'economyScore',
  'technologyScore',
  'established',
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export function createPlayerStats(): PlayerStats {
  const stats: PlayerStats = {};
  for (const key of STAT_KEYS) {
    stats[key] = 0;
  }
  return stats;
}

export function recordStat(
  state: GameState,
  playerId: PlayerId,
  key: StatKey,
  amount: number,
): void {
  const player = state.players[playerId];
  if (!player) {
    return;
  }
  player.stats[key] = (player.stats[key] ?? 0) + amount;
}

export function setStat(state: GameState, playerId: PlayerId, key: StatKey, value: number): void {
  const player = state.players[playerId];
  if (!player) {
    return;
  }
  player.stats[key] = value;
}
