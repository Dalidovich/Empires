import type { AiDifficulty, GameData } from '../data/types';
import type { Command } from '../sim/commands';
import type { PlayerView } from '../sim/snapshot';
import type { JsonValue, PlayerId } from '../sim/types';

export interface AiController {
  readonly playerId: PlayerId;
  think(view: PlayerView, tick: number): Command[];
  serialize(): JsonValue;
  needsView?(tick: number): boolean;
}

export type CreateAi = (
  playerId: PlayerId,
  difficulty: AiDifficulty,
  data: GameData,
  savedState?: JsonValue,
) => AiController;
