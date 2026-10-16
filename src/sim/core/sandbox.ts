import { RESOURCE_KINDS } from '../../data/types';
import type { Command, CommandOf } from '../commands';
import type { StepContext } from '../system';
import type { EntityId, GameState, Player } from '../types';
import { AI_DIRECTIVE_MODES } from '../types';
import { rejectCommand } from './orders';

export type CommandDispatch = (command: Command) => void;

function freeze(state: GameState, target: Player, dispatch: CommandDispatch): void {
  const unitIds: EntityId[] = [];
  const cancels: Command[] = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.owner !== target.id) {
      continue;
    }
    if (entity.kind === 'unit') {
      unitIds.push(entity.id);
    }
    for (let index = entity.queue.length - 1; index >= 0; index--) {
      cancels.push({ type: 'cancelQueueItem', playerId: target.id, buildingId: entity.id, index });
    }
    if (entity.research !== null) {
      cancels.push({ type: 'cancelResearch', playerId: target.id, buildingId: entity.id });
    }
  }
  if (unitIds.length > 0) {
    dispatch({ type: 'stop', playerId: target.id, entityIds: unitIds });
  }
  for (const cancel of cancels) {
    dispatch(cancel);
  }
}

function handleDirective(
  state: GameState,
  target: Player,
  command: CommandOf<'sandboxAi'>,
  ctx: StepContext,
  dispatch: CommandDispatch,
): void {
  if (target.kind !== 'ai' || target.defeated || !AI_DIRECTIVE_MODES.includes(command.mode)) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  if (command.mode === 'free') {
    delete target.aiDirective;
    return;
  }
  if (command.mode !== 'attack') {
    target.aiDirective = { mode: command.mode, victimId: null };
    if (command.mode === 'frozen') {
      freeze(state, target, dispatch);
    }
    return;
  }
  const victim = command.victimId === null ? undefined : state.players[command.victimId];
  if (!victim || victim.id === target.id || victim.defeated) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  target.aiDirective = { mode: 'attack', victimId: victim.id };
  if (target.diplomacy[victim.id] !== 'enemy') {
    target.diplomacy[victim.id] = 'enemy';
    ctx.events.push({
      type: 'stanceChanged',
      playerId: target.id,
      targetPlayerId: victim.id,
      stance: 'enemy',
    });
  }
}

function handleResources(
  state: GameState,
  target: Player,
  command: CommandOf<'sandboxResources'>,
  ctx: StepContext,
): void {
  const amount = Math.floor(command.amount);
  if (target.defeated || !Number.isFinite(amount) || amount <= 0) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  for (const kind of RESOURCE_KINDS) {
    target.resources[kind] += amount;
  }
  target.sandboxGrantTick = state.tick + 1;
}

export function handleSandboxCommand(
  state: GameState,
  command: Command,
  ctx: StepContext,
  dispatch: CommandDispatch,
): boolean {
  if (command.type !== 'sandboxAi' && command.type !== 'sandboxResources') {
    return false;
  }
  const issuer = state.players[command.playerId];
  const target = state.players[command.targetPlayerId];
  if (state.settings.sandbox !== true || issuer?.kind !== 'human' || !target) {
    rejectCommand(ctx, command, 'invalid');
    return true;
  }
  if (command.type === 'sandboxAi') {
    handleDirective(state, target, command, ctx, dispatch);
  } else {
    handleResources(state, target, command, ctx);
  }
  return true;
}
