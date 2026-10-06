import type { Command, CommandOf } from '../commands';
import { rejectCommand } from '../core/orders';
import type { PlayerView } from '../snapshot';
import type { StepContext, System } from '../system';
import type { GameState, PlayerId, Stance } from '../types';

const STANCES: readonly Stance[] = ['ally', 'neutral', 'enemy'];

export function stanceOf(state: GameState, from: PlayerId, to: PlayerId): Stance {
  if (from === to) {
    return 'ally';
  }
  const player = state.players[from];
  if (!player || !state.players[to]) {
    return 'neutral';
  }
  return player.diplomacy[to] ?? 'enemy';
}

export function isEnemy(state: GameState, from: PlayerId, to: PlayerId): boolean {
  return stanceOf(state, from, to) === 'enemy';
}

export function isAlly(state: GameState, from: PlayerId, to: PlayerId): boolean {
  return stanceOf(state, from, to) === 'ally';
}

export function isNeutral(state: GameState, from: PlayerId, to: PlayerId): boolean {
  return stanceOf(state, from, to) === 'neutral';
}

export function areMutualAllies(state: GameState, a: PlayerId, b: PlayerId): boolean {
  return isAlly(state, a, b) && isAlly(state, b, a);
}

export function viewStance(view: PlayerView, other: PlayerId): Stance {
  if (other === view.playerId) {
    return 'ally';
  }
  if (!view.players[other]) {
    return 'neutral';
  }
  return view.self.diplomacy[other] ?? 'enemy';
}

export function isMutualAllyInView(view: PlayerView, other: PlayerId): boolean {
  if (other === view.playerId) {
    return true;
  }
  return (
    viewStance(view, other) === 'ally' && view.players[other]?.stanceTowardViewer === 'ally'
  );
}

function handleSetStance(
  state: GameState,
  command: CommandOf<'setStance'>,
  ctx: StepContext,
): void {
  const player = state.players[command.playerId];
  const target = state.players[command.targetPlayerId];
  if (!player || !target || target.id === player.id || !STANCES.includes(command.stance)) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  if (state.settings.lockTeams) {
    rejectCommand(ctx, command, 'teams_locked');
    return;
  }
  if (stanceOf(state, player.id, target.id) === command.stance) {
    return;
  }
  player.diplomacy[target.id] = command.stance;
  ctx.events.push({
    type: 'stanceChanged',
    playerId: player.id,
    targetPlayerId: target.id,
    stance: command.stance,
  });
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  if (command.type !== 'setStance') {
    return false;
  }
  handleSetStance(state, command, ctx);
  return true;
}

export const diplomacySystem: System = {
  id: 'diplomacy',
  handleCommand,
};
