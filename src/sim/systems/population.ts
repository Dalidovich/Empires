import type { GameData } from '../../data/types';
import { syncPlayerModifiers } from '../effects/apply';
import { populationCap } from '../effects/availability';
import { getBuildingStats } from '../stats';
import type { StepContext, System } from '../system';
import type { GameState, PlayerId } from '../types';

export function recountPopulation(state: GameState, data: GameData): void {
  for (const player of state.players) {
    player.population = 0;
    player.housing = 0;
  }
  for (const entity of Object.values(state.entities)) {
    const player = state.players[entity.owner];
    if (!player) {
      continue;
    }
    if (entity.kind === 'unit') {
      player.population += data.units[entity.type]?.population ?? 0;
    } else if (entity.kind === 'building' && entity.buildProgress === 1 && data.buildings[entity.type]) {
      player.housing += getBuildingStats(state, entity.owner, entity.type, data).housing;
    }
  }
}

export function freePopulation(state: GameState, playerId: PlayerId): number {
  const player = state.players[playerId];
  if (!player) {
    return 0;
  }
  return Math.max(0, populationCap(state, player) - player.population);
}

function update(state: GameState, ctx: StepContext): void {
  syncPlayerModifiers(state, ctx.data);
  recountPopulation(state, ctx.data);
}

export const populationSystem: System = {
  id: 'population',
  update,
};
