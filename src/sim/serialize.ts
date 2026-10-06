import type { SerializedGame } from './protocol';
import type { GameState, JsonValue } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertState(value: unknown): asserts value is GameState {
  if (!isRecord(value)) {
    throw new Error('Saved game has no state');
  }
  const map = value.map;
  if (!isRecord(map) || typeof map.size !== 'number' || !Array.isArray(map.terrain)) {
    throw new Error('Saved game has no map');
  }
  const tiles = map.size * map.size;
  if (
    map.terrain.length !== tiles ||
    !Array.isArray(map.elevation) ||
    map.elevation.length !== tiles ||
    !Array.isArray(map.occupancy) ||
    map.occupancy.length !== tiles
  ) {
    throw new Error('Saved game map is inconsistent');
  }
  if (
    typeof value.tick !== 'number' ||
    typeof value.rngState !== 'number' ||
    typeof value.nextEntityId !== 'number' ||
    !Array.isArray(value.players) ||
    !isRecord(value.entities) ||
    !isRecord(value.settings) ||
    !Array.isArray(value.projectiles) ||
    !Array.isArray(value.victoryTimers)
  ) {
    throw new Error('Saved game state is incomplete');
  }
}

export function serialize(state: GameState, ai: Record<string, JsonValue> = {}): SerializedGame {
  return structuredClone({ state, ai });
}

export function deserialize(game: SerializedGame): SerializedGame {
  if (!isRecord(game)) {
    throw new Error('Saved game is not an object');
  }
  assertState(game.state);
  return structuredClone({ state: game.state, ai: isRecord(game.ai) ? game.ai : {} });
}
