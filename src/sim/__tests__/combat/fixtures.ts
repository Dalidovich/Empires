import type { Command } from '../../commands';
import { spawnEntity } from '../../core/entities';
import type { SimEvent, SimEventOf, SimEventType } from '../../events';
import type { Entity, GameState, Stance } from '../../types';
import { data, emptyState } from '../fixtures';

export const TICK_RATE = data.game.tickRate;

export function battlefield(size = 32, stance: Stance = 'enemy', playerCount = 2): GameState {
  const state = emptyState(size, playerCount, stance);
  for (const player of state.players) {
    player.explored.fill(1);
  }
  return state;
}

export function seconds(value: number): number {
  return Math.ceil(value * TICK_RATE);
}

export function eventsOf<T extends SimEventType>(
  events: readonly SimEvent[],
  type: T,
): SimEventOf<T>[] {
  return events.filter((event): event is SimEventOf<T> => event.type === type);
}

export function attackCommand(playerId: number, units: readonly Entity[], target: Entity): Command {
  return {
    type: 'attack',
    playerId,
    entityIds: units.map((unit) => unit.id),
    targetId: target.id,
    queued: false,
  };
}

export function research(state: GameState, playerId: number, ...technologies: string[]): void {
  state.players[playerId].researched.push(...technologies);
}

export function addFoundation(
  state: GameState,
  type: string,
  owner: number,
  tileX: number,
  tileY: number,
): Entity {
  const half = data.buildings[type].size / 2;
  return spawnEntity(
    state,
    {
      kind: 'building',
      type,
      owner,
      position: { x: tileX + half, y: tileY + half },
      buildProgress: 0.5,
    },
    data,
  );
}

export function raise(state: GameState, tileX: number, tileY: number, elevation: number): void {
  state.map.elevation[tileY * state.map.size + tileX] = elevation;
}
