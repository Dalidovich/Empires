import type { GameData } from '../data/types';
import type { EntitySpec, PlayerSetup, Settings, Vec2 } from '../sim/types';
import { TILE_FREE } from '../sim/types';
import type { GeneratedMap } from './api';
import { placeCliffs } from './cliffs';
import { connectStarts } from './connectivity';
import { createContext } from './context';
import { layoutMap } from './land';
import {
  growForests,
  placeAnimals,
  placeAreaResources,
  placeRelics,
  placeStartResources,
  placeStarts,
} from './objects';
import { orderPlayers } from './starts';
import { buildElevation, classifyTerrain } from './terrain';

export type { GeneratedMap, GenerateMap } from './api';
export { renderAscii } from './ascii';

export function generateMap(
  settings: Settings,
  players: readonly PlayerSetup[],
  seed: number,
  data: GameData,
): GeneratedMap {
  const ctx = createContext(settings, seed, data);
  layoutMap(ctx, orderPlayers(ctx.rng, players));
  classifyTerrain(ctx);
  buildElevation(ctx);
  placeCliffs(ctx);
  placeStarts(ctx);
  placeStartResources(ctx);
  growForests(ctx);
  placeAreaResources(ctx);
  placeAnimals(ctx);
  if (settings.victoryMode === 'standard') {
    placeRelics(ctx);
  }
  if (ctx.def.layout !== 'islands') {
    connectStarts(ctx);
  }
  const startPositions: Record<string, Vec2> = {};
  for (const site of ctx.starts) {
    startPositions[site.playerId] = { x: site.center.x, y: site.center.y };
  }
  return {
    map: {
      size: ctx.size,
      terrain: Array.from(ctx.terrain),
      elevation: Array.from(ctx.elevation),
      occupancy: new Array<number>(ctx.tiles).fill(TILE_FREE),
    },
    entities: ctx.entities.filter((spec): spec is EntitySpec => spec !== null),
    startPositions,
  };
}
