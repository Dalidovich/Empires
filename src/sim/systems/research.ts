import type { Command, CommandOf } from '../commands';
import { rejectCommand } from '../core/orders';
import { completeResearch } from '../effects/apply';
import {
  missingResource,
  ownedBuildings,
  payCost,
  refreshBuildingState,
  refundCost,
  technologyBlockReason,
} from '../effects/availability';
import type { StepContext, System } from '../system';
import type { Entity, GameState, PlayerId } from '../types';

function ownBuilding(state: GameState, playerId: PlayerId, id: number): Entity | null {
  const building = state.entities[id];
  if (!building || building.kind !== 'building' || building.owner !== playerId) {
    return null;
  }
  return building;
}

function handleResearch(state: GameState, command: CommandOf<'research'>, ctx: StepContext): void {
  const data = ctx.data;
  const player = state.players[command.playerId];
  const building = ownBuilding(state, command.playerId, command.buildingId);
  if (!player || !building) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  const technology = data.technologies[command.technology];
  if (!technology || technology.building !== building.type || building.buildProgress !== 1) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  const blocked = technologyBlockReason(
    player,
    technology.id,
    ownedBuildings(state, player.id),
    data,
  );
  if (blocked !== null) {
    rejectCommand(ctx, command, blocked);
    return;
  }
  if (building.research !== null || building.queue.length > 0) {
    rejectCommand(ctx, command, 'busy');
    return;
  }
  const lacking = missingResource(player, technology.cost);
  if (lacking !== null) {
    ctx.events.push({ type: 'insufficientResources', playerId: player.id, resource: lacking });
    rejectCommand(ctx, command, 'resources');
    return;
  }
  payCost(player, technology.cost);
  building.research = { technology: technology.id, progress: 0, paid: { ...technology.cost } };
  refreshBuildingState(building);
}

function handleCancelResearch(
  state: GameState,
  command: CommandOf<'cancelResearch'>,
  ctx: StepContext,
): void {
  const building = ownBuilding(state, command.playerId, command.buildingId);
  if (!building) {
    rejectCommand(ctx, command, 'not_owner');
    return;
  }
  if (building.research === null) {
    rejectCommand(ctx, command, 'invalid');
    return;
  }
  refundCost(state.players[command.playerId], building.research.paid);
  building.research = null;
  refreshBuildingState(building);
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  switch (command.type) {
    case 'research':
      handleResearch(state, command, ctx);
      return true;
    case 'cancelResearch':
      handleCancelResearch(state, command, ctx);
      return true;
    default:
      return false;
  }
}

function update(state: GameState, ctx: StepContext): void {
  for (const building of Object.values(state.entities)) {
    const slot = building.research;
    if (building.kind !== 'building' || slot === null || building.buildProgress !== 1) {
      continue;
    }
    const player = state.players[building.owner];
    const technology = ctx.data.technologies[slot.technology];
    if (!player || !technology || player.researched.includes(technology.id)) {
      refundCost(player, slot.paid);
      building.research = null;
      refreshBuildingState(building);
      continue;
    }
    const duration = Math.max(1, technology.researchTime * ctx.data.game.tickRate);
    slot.progress = Math.min(1, slot.progress + 1 / duration);
    if (slot.progress >= 1) {
      building.research = null;
      completeResearch(state, player.id, technology.id, ctx, building.position);
    }
    refreshBuildingState(building);
  }
}

export const researchSystem: System = {
  id: 'research',
  handleCommand,
  update,
};
