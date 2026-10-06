import type { GameData } from '../data/types';
import type { EntitySpec, GameMap, PlayerSetup, Settings, Vec2 } from '../sim/types';

export interface GeneratedMap {
  map: GameMap;
  entities: EntitySpec[];
  startPositions: Record<string, Vec2>;
}

export type GenerateMap = (
  settings: Settings,
  players: readonly PlayerSetup[],
  seed: number,
  data: GameData,
) => GeneratedMap;
