import type { GameData } from '../../data/types';
import type { GameOverPlayerSummary } from '../events';
import { setStat } from '../playerStats';
import type { StepContext, System } from '../system';
import type { GameState, Player } from '../types';

const UNIT_KILL_POINTS = 2;
const BUILDING_RAZE_POINTS = 4;
const CONVERSION_POINTS = 2;
const RESOURCES_PER_POINT = 10;
const TECHNOLOGY_POINTS = 10;
const AGE_POINTS = 50;

function stat(player: Player, key: string): number {
  return player.stats[key] ?? 0;
}

export function militaryScore(player: Player): number {
  return (
    stat(player, 'unitsKilled') * UNIT_KILL_POINTS +
    stat(player, 'buildingsRazed') * BUILDING_RAZE_POINTS +
    stat(player, 'conversions') * CONVERSION_POINTS
  );
}

export function economyScore(player: Player): number {
  const total =
    stat(player, 'foodGathered') +
    stat(player, 'woodGathered') +
    stat(player, 'stoneGathered') +
    stat(player, 'goldGathered') +
    stat(player, 'tradeGold') +
    stat(player, 'tributeSent');
  return Math.floor(total / RESOURCES_PER_POINT);
}

export function technologyScore(player: Player, data: GameData): number {
  const ageIndex = Math.max(
    0,
    data.game.ages.findIndex((age) => age.id === player.age),
  );
  return stat(player, 'technologiesResearched') * TECHNOLOGY_POINTS + ageIndex * AGE_POINTS;
}

export function updateScores(state: GameState, data: GameData): void {
  for (const player of state.players) {
    const military = militaryScore(player);
    const economy = economyScore(player);
    const technology = technologyScore(player, data);
    setStat(state, player.id, 'militaryScore', military);
    setStat(state, player.id, 'economyScore', economy);
    setStat(state, player.id, 'technologyScore', technology);
    setStat(state, player.id, 'score', military + economy + technology);
  }
}

export function playerSummaries(state: GameState): GameOverPlayerSummary[] {
  const winners = state.outcome?.winners ?? [];
  return state.players.map((player) => ({
    playerId: player.id,
    winner: winners.includes(player.id),
    score: stat(player, 'score'),
    stats: { ...player.stats },
  }));
}

function update(state: GameState, ctx: StepContext): void {
  updateScores(state, ctx.data);
  const outcome = state.outcome;
  if (outcome !== null && outcome.tick === state.tick) {
    ctx.events.push({
      type: 'gameOver',
      winners: [...outcome.winners],
      reason: outcome.reason,
      players: playerSummaries(state),
    });
  }
}

export const scoreSystem: System = {
  id: 'score',
  update,
};
