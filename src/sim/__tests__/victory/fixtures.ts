import { spawnEntity } from '../../core/entities';
import type { SimEvent, SimEventOf, SimEventType } from '../../events';
import { countdownTicks } from '../../systems/victory';
import type { Entity, GameState, PlayerKind, Stance, VictoryMode } from '../../types';
import { GAIA_PLAYER_ID } from '../../types';
import { addBuilding, addUnit, data, emptyState } from '../fixtures';

export const COUNTDOWN = countdownTicks(data);

export interface ArenaOptions {
  players?: number;
  mode?: VictoryMode;
  lockTeams?: boolean;
  kinds?: PlayerKind[];
}

export function arena(options: ArenaOptions = {}): GameState {
  const count = options.players ?? 2;
  const state = emptyState(48, count, 'enemy');
  state.settings.victoryMode = options.mode ?? 'conquest';
  state.settings.lockTeams = options.lockTeams ?? false;
  state.players.forEach((player, index) => {
    player.kind = options.kinds?.[index] ?? 'ai';
    player.explored.fill(1);
  });
  return state;
}

export function baseTile(playerId: number): { x: number; y: number } {
  return { x: 4 + (playerId % 4) * 10, y: playerId < 4 ? 4 : 38 };
}

export function addBase(state: GameState, playerId: number): Entity {
  const tile = baseTile(playerId);
  return addBuilding(state, 'town_center', playerId, tile.x, tile.y);
}

export function addBases(state: GameState): Entity[] {
  return state.players.map((player) => addBase(state, player.id));
}

export function addGuard(state: GameState, playerId: number): Entity {
  const tile = baseTile(playerId);
  return addUnit(state, 'villager', playerId, tile.x + 4.5, tile.y + 1.5);
}

export function ally(state: GameState, a: number, b: number): void {
  setStance(state, a, b, 'ally');
  setStance(state, b, a, 'ally');
}

export function setStance(state: GameState, from: number, to: number, stance: Stance): void {
  state.players[from].diplomacy[to] = stance;
}

export function addRelic(state: GameState, type: 'ruin' | 'artifact', x: number, y: number): Entity {
  return spawnEntity(
    state,
    { kind: 'object', type, owner: GAIA_PLAYER_ID, position: { x, y } },
    data,
  );
}

export function eventsOf<T extends SimEventType>(
  events: readonly SimEvent[],
  type: T,
): SimEventOf<T>[] {
  return events.filter((event): event is SimEventOf<T> => event.type === type);
}
