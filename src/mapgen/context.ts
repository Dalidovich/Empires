import type { GameData, MapTypeDef } from '../data/types';
import type { RngHolder } from '../sim/rng';
import { seedRng } from '../sim/rng';
import type { EntitySpec, Settings, TileCoord, Vec2 } from '../sim/types';
import { TERRAIN } from '../sim/types';
import { FAR } from './grid';
import type { MapParams } from './params';
import { readParams } from './params';

export interface StartSite {
  playerId: number;
  origin: TileCoord;
  center: Vec2;
  access: number;
}

export const FOREST_CLUMP = 1;

export interface MapContext {
  size: number;
  tiles: number;
  def: MapTypeDef;
  params: MapParams;
  data: GameData;
  settings: Settings;
  rng: RngHolder;
  land: Uint8Array;
  terrain: Uint8Array;
  elevation: Uint8Array;
  landDepth: Int16Array;
  coastDist: Int16Array;
  blocked: Uint8Array;
  fixed: Uint8Array;
  taken: Uint8Array;
  reserved: Uint8Array;
  clump: Int32Array;
  nextClump: number;
  entities: (EntitySpec | null)[];
  entityAt: Int32Array;
  starts: StartSite[];
  zoneRadius: number;
  startDist: Float32Array;
  nearestStart: Int16Array;
}

export function createContext(settings: Settings, seed: number, data: GameData): MapContext {
  const def = data.mapTypes[settings.mapType];
  const size = data.mapSizes[settings.mapSize].tiles;
  const tiles = size * size;
  return {
    size,
    tiles,
    def,
    params: readParams(def),
    data,
    settings,
    rng: { rngState: seedRng(seed) },
    land: new Uint8Array(tiles),
    terrain: new Uint8Array(tiles).fill(TERRAIN.deepWater),
    elevation: new Uint8Array(tiles),
    landDepth: new Int16Array(tiles).fill(FAR),
    coastDist: new Int16Array(tiles).fill(FAR),
    blocked: new Uint8Array(tiles),
    fixed: new Uint8Array(tiles),
    taken: new Uint8Array(tiles),
    reserved: new Uint8Array(tiles),
    clump: new Int32Array(tiles),
    nextClump: FOREST_CLUMP + 1,
    entities: [],
    entityAt: new Int32Array(tiles),
    starts: [],
    zoneRadius: def.startZoneRadius,
    startDist: new Float32Array(tiles).fill(FAR),
    nearestStart: new Int16Array(tiles).fill(-1),
  };
}

export function inBounds(ctx: MapContext, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < ctx.size && y < ctx.size;
}

export function tileCenterOf(ctx: MapContext, index: number): Vec2 {
  const x = index % ctx.size;
  return { x: x + 0.5, y: (index - x) / ctx.size + 0.5 };
}

export function isWater(ctx: MapContext, index: number): boolean {
  return ctx.land[index] === 0;
}
