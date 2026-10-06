import { TERRAIN } from '../sim/types';
import type { MapContext } from './context';
import { clamp, distanceField, forEachInDisc, sortedValues } from './grid';
import { noiseField } from './noise';

const SHORE_DEPTH = 1;

export function classifyTerrain(ctx: MapContext): void {
  const { size, tiles, params, def, rng, land } = ctx;
  ctx.landDepth = distanceField(size, land, 0);
  ctx.coastDist = distanceField(size, land, 1);
  const shallowNoise = noiseField(rng, size, params.terrainNoiseScale / 2, 2);
  const desertNoise = noiseField(rng, size, params.terrainNoiseScale * 1.5);
  const inner: number[] = [];
  for (let i = 0; i < tiles; i++) {
    if (land[i] === 1 && ctx.landDepth[i] > SHORE_DEPTH) {
      inner.push(desertNoise[i]);
    }
  }
  const desertCount = Math.round(def.desertRatio * inner.length);
  const sorted = sortedValues(inner);
  const desertThreshold = desertCount > 0 ? sorted[Math.max(0, sorted.length - desertCount)] : Infinity;
  for (let i = 0; i < tiles; i++) {
    if (land[i] === 0) {
      const shallow = ctx.coastDist[i] === 1 && shallowNoise[i] < params.shallowsRatio;
      ctx.terrain[i] = shallow ? TERRAIN.shallows : TERRAIN.deepWater;
    } else if (ctx.landDepth[i] <= SHORE_DEPTH) {
      ctx.terrain[i] = TERRAIN.shore;
    } else {
      ctx.terrain[i] = desertNoise[i] >= desertThreshold ? TERRAIN.desert : TERRAIN.grass;
    }
  }
}

function relaxSlopes(elevation: Uint8Array, size: number): void {
  const lower = (i: number, x: number, y: number, dx: number, dy: number): void => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
      return;
    }
    const limit = elevation[ny * size + nx] + 1;
    if (elevation[i] > limit) {
      elevation[i] = limit;
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      lower(i, x, y, -1, 0);
      lower(i, x, y, -1, -1);
      lower(i, x, y, 0, -1);
      lower(i, x, y, 1, -1);
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = y * size + x;
      lower(i, x, y, 1, 0);
      lower(i, x, y, 1, 1);
      lower(i, x, y, 0, 1);
      lower(i, x, y, -1, 1);
    }
  }
}

function flattenStarts(ctx: MapContext): void {
  for (const site of ctx.starts) {
    let lowest = 255;
    forEachInDisc(ctx.size, site.center.x, site.center.y, ctx.params.startClearRadius, (i) => {
      lowest = Math.min(lowest, ctx.elevation[i]);
    });
    forEachInDisc(ctx.size, site.center.x, site.center.y, ctx.params.startClearRadius, (i) => {
      ctx.elevation[i] = lowest;
    });
  }
}

export function buildElevation(ctx: MapContext): void {
  const { size, tiles, params, def, rng } = ctx;
  const noise = noiseField(rng, size, params.elevationNoiseScale);
  const contrast = 1 + 2 * def.elevationRoughness;
  const span = Math.max(1e-6, 1 - params.elevationFloor);
  for (let i = 0; i < tiles; i++) {
    if (ctx.land[i] === 0) {
      ctx.elevation[i] = 0;
      continue;
    }
    const shaped = clamp(0.5 + (noise[i] - 0.5) * contrast, 0, 1);
    const height = Math.round((Math.max(0, shaped - params.elevationFloor) / span) * def.maxElevation);
    ctx.elevation[i] = Math.min(height, Math.max(0, ctx.landDepth[i] - 1));
  }
  relaxSlopes(ctx.elevation, size);
  flattenStarts(ctx);
  relaxSlopes(ctx.elevation, size);
}
