import type { GameData } from '../../data/types';
import { RESOURCE_KINDS } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import { rejectCommand } from '../core/orders';
import { recordStat } from '../playerStats';
import type { StepContext, System } from '../system';
import type { GameState, PlayerId } from '../types';

export function isTributeTaxFree(state: GameState, playerId: PlayerId): boolean {
  return state.players[playerId]?.modifiers.flags.no_tribute_tax === true;
}

export function tributeTax(
  state: GameState,
  playerId: PlayerId,
  amount: number,
  data: GameData,
): number {
  if (isTributeTaxFree(state, playerId)) {
    return 0;
  }
  return Math.round(amount * data.game.tributeTax);
}

function handleTribute(state: GameState, command: CommandOf<'tribute'>, ctx: StepContext): void {
  const sender = state.players[command.playerId];
  const receiver = state.players[command.targetPlayerId];
  const amount = Math.floor(command.amount);
  if (
    !sender ||
    !receiver ||
    receiver.id === sender.id ||
    receiver.defeated ||
    !RESOURCE_KINDS.includes(command.resource) ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const total = amount + tributeTax(state, sender.id, amount, ctx.data);
  if (sender.resources[command.resource] < total) {
    rejectCommand(ctx, command, 'resources');
    return;
  }
  sender.resources[command.resource] -= total;
  receiver.resources[command.resource] += amount;
  recordStat(state, sender.id, 'tributeSent', amount);
  recordStat(state, receiver.id, 'tributeReceived', amount);
  ctx.events.push({
    type: 'tribute',
    fromPlayerId: sender.id,
    toPlayerId: receiver.id,
    resource: command.resource,
    amount,
  });
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  if (command.type !== 'tribute') {
    return false;
  }
  handleTribute(state, command, ctx);
  return true;
}

export const tributeSystem: System = {
  id: 'tribute',
  handleCommand,
};
