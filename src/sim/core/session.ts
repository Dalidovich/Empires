import { createAi } from '../../ai';
import type { AiController } from '../../ai/api';
import type { GameData } from '../../data/types';
import type { Command } from '../commands';
import { createGame, step } from '../engine';
import type { SimEvent } from '../events';
import type { SerializedGame } from '../protocol';
import { serialize } from '../serialize';
import type { PlayerView } from '../snapshot';
import { buildPlayerView } from '../snapshot';
import type { SimLogger, StepContext } from '../system';
import { createStepContext } from '../system';
import type { GameState, JsonValue, PlayerId, PlayerSetup, Settings } from '../types';

export interface Session {
  state: GameState;
  data: GameData;
  ctx: StepContext;
  ais: AiController[];
  pending: Command[];
}

export function createSession(game: SerializedGame, data: GameData, log?: SimLogger): Session {
  const ais = game.state.players
    .filter((player) => player.kind === 'ai' && player.difficulty !== null)
    .map((player) =>
      createAi(player.id, player.difficulty ?? 'moderate', data, game.ai[player.id]),
    );
  return {
    state: game.state,
    data,
    ctx: createStepContext(data, log),
    ais,
    pending: [],
  };
}

export function startSession(
  settings: Settings,
  players: readonly PlayerSetup[],
  seed: number,
  data: GameData,
  log?: SimLogger,
): Session {
  return createSession({ state: createGame(settings, players, data, seed), ai: {} }, data, log);
}

export function isRunning(session: Session): boolean {
  return !session.state.paused && session.state.outcome === null;
}

export function queueCommands(session: Session, commands: readonly Command[]): void {
  session.pending.push(...commands);
}

export function advanceSession(session: Session): SimEvent[] | null {
  const { state, data } = session;
  const commands = session.pending.splice(0);
  const running = isRunning(session);
  if (running) {
    for (const ai of session.ais) {
      if (!state.players[ai.playerId].defeated && (ai.needsView?.(state.tick) ?? true)) {
        commands.push(...ai.think(buildPlayerView(state, ai.playerId, data), state.tick));
      }
    }
  }
  if (!running && commands.length === 0) {
    return null;
  }
  return step(state, commands, session.ctx);
}

export function sessionView(session: Session, viewerId: PlayerId): PlayerView {
  return buildPlayerView(session.state, viewerId, session.data);
}

export function saveSession(session: Session): SerializedGame {
  const ai: Record<string, JsonValue> = {};
  for (const controller of session.ais) {
    ai[controller.playerId] = controller.serialize();
  }
  return serialize(session.state, ai);
}
