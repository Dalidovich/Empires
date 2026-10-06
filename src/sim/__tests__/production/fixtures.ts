import type { Command } from '../../commands';
import type { CommandRejectReason, SimEvent, SimEventOf, SimEventType } from '../../events';
import type { StepContext } from '../../system';
import type { Entity, GameState } from '../../types';
import { emptyState, run } from '../fixtures';

export const TICK_RATE = 20;

export function world(size = 30, playerCount = 2): GameState {
  const state = emptyState(size, playerCount);
  for (const player of state.players) {
    player.explored.fill(1);
    player.resources = { food: 5000, wood: 5000, stone: 5000, gold: 5000 };
  }
  return state;
}

export function seconds(value: number): number {
  return Math.ceil(value * TICK_RATE);
}

export function send(state: GameState, ctx: StepContext, ...commands: Command[]): SimEvent[] {
  return run(state, ctx, 1, commands);
}

export function eventsOf<T extends SimEventType>(events: readonly SimEvent[], type: T): SimEventOf<T>[] {
  return events.filter((event): event is SimEventOf<T> => event.type === type);
}

export function rejections(events: readonly SimEvent[]): CommandRejectReason[] {
  return eventsOf(events, 'commandRejected').map((event) => event.reason);
}

export function ownedOf(state: GameState, owner: number, type: string): Entity[] {
  return Object.values(state.entities).filter(
    (entity) => entity.owner === owner && entity.type === type,
  );
}
