import type { AiDifficulty, ResourceAmounts } from '../../data/types';
import {
  addBuilding,
  addUnit,
  context,
  data,
  emptyState,
  refreshFog,
} from '../../sim/__tests__/fixtures';
import type { Command } from '../../sim/commands';
import { spawnEntity } from '../../sim/core/entities';
import { step } from '../../sim/engine';
import type { SimEvent } from '../../sim/events';
import { buildPlayerView } from '../../sim/snapshot';
import type { Entity, GameState } from '../../sim/types';
import { GAIA_PLAYER_ID } from '../../sim/types';
import type { Think } from '../context';
import { createThink } from '../context';
import { resolveParams } from '../params';
import type { AiState } from '../state';
import { createAiState } from '../state';

export { addBuilding, addUnit, data };

export interface Scene {
  state: GameState;
  ai: AiState;
}

export function createScene(size = 64, players = 2, difficulty: AiDifficulty = 'moderate'): Scene {
  const state = emptyState(size, players);
  state.settings.populationLimit = 50;
  for (const player of state.players) {
    player.kind = 'ai';
    player.difficulty = difficulty;
    player.housing = 50;
  }
  return { state, ai: createAiState(0, difficulty) };
}

export function stock(state: GameState, playerId: number, resources: Partial<ResourceAmounts>): void {
  Object.assign(state.players[playerId].resources, resources);
}

export function addResource(state: GameState, type: string, x: number, y: number): Entity {
  return spawnEntity(
    state,
    { kind: 'resource', type, owner: GAIA_PLAYER_ID, position: { x: x + 0.5, y: y + 0.5 } },
    data,
  );
}

export function reveal(state: GameState, playerId: number): void {
  state.players[playerId].explored.fill(1);
}

export function addBase(state: GameState, playerId: number, x: number, y: number): Entity {
  return addBuilding(state, 'town_center', playerId, x, y);
}

export function thinkOf(scene: Scene, playerId = 0): Think {
  refreshFog(scene.state);
  const player = scene.state.players[playerId];
  const level = data.aiLevels[player.difficulty ?? 'moderate'];
  const view = buildPlayerView(scene.state, playerId, data);
  return createThink(view, data, level, resolveParams(level), scene.ai);
}

export function commandsOf<T extends Command['type']>(
  commands: readonly Command[],
  type: T,
): Extract<Command, { type: T }>[] {
  return commands.filter((command): command is Extract<Command, { type: T }> => command.type === type);
}

export function apply(scene: Scene, commands: readonly Command[]): SimEvent[] {
  return step(scene.state, commands, context());
}

export function rejections(events: readonly SimEvent[]): SimEvent[] {
  return events.filter((event) => event.type === 'commandRejected');
}
