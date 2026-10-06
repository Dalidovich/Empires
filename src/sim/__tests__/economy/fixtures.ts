import { spawnEntity } from '../../core/entities';
import type { Entity, GameState } from '../../types';
import { GAIA_PLAYER_ID } from '../../types';
import { data } from '../fixtures';

export function addSource(state: GameState, type: string, tileX: number, tileY: number, amount?: number): Entity {
  return spawnEntity(
    state,
    {
      kind: 'resource',
      type,
      owner: GAIA_PLAYER_ID,
      position: { x: tileX + 0.5, y: tileY + 0.5 },
      amount,
    },
    data,
  );
}

export function addAnimal(state: GameState, type: string, x: number, y: number): Entity {
  return spawnEntity(state, { kind: 'unit', type, owner: GAIA_PLAYER_ID, position: { x, y } }, data);
}

export function totalGathered(state: GameState, playerId: number): number {
  const stats = state.players[playerId].stats;
  return stats.foodGathered + stats.woodGathered + stats.stoneGathered + stats.goldGathered;
}
