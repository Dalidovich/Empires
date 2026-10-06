import type { Command } from './commands';
import type { SimEvent } from './events';
import type { PlayerView } from './snapshot';
import type { GameState, JsonValue, PlayerId, PlayerSetup, Settings } from './types';

export interface SerializedGame {
  state: GameState;
  ai: Record<string, JsonValue>;
}

export interface InitMessage {
  type: 'init';
  settings: Settings;
  players: PlayerSetup[];
  seed: number;
  viewerId: PlayerId;
}

export interface LoadMessage {
  type: 'load';
  game: SerializedGame;
  viewerId: PlayerId;
}

export interface CommandsMessage {
  type: 'commands';
  commands: Command[];
}

export interface SaveRequestMessage {
  type: 'saveRequest';
  requestId: number;
}

export interface StopMessage {
  type: 'stop';
}

export type MainToWorkerMessage =
  | InitMessage
  | LoadMessage
  | CommandsMessage
  | SaveRequestMessage
  | StopMessage;

export interface ReadyMessage {
  type: 'ready';
  viewerId: PlayerId;
  tickRate: number;
}

export interface SnapshotMessage {
  type: 'snapshot';
  view: PlayerView;
}

export interface EventsMessage {
  type: 'events';
  tick: number;
  events: SimEvent[];
}

export interface SaveResponseMessage {
  type: 'saveResponse';
  requestId: number;
  game: SerializedGame;
}

export type SimErrorCode = 'simulation_error' | 'invalid_message' | 'load_failed';

export interface ErrorMessage {
  type: 'error';
  code: SimErrorCode;
  tick: number;
  message: string;
}

export type WorkerToMainMessage =
  | ReadyMessage
  | SnapshotMessage
  | EventsMessage
  | SaveResponseMessage
  | ErrorMessage;
