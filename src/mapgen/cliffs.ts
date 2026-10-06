import { chance, nextInt, pick } from '../sim/rng';
import { TERRAIN } from '../sim/types';
import type { MapContext } from './context';
import { NEIGHBORS_4, NEIGHBORS_8 } from './grid';
import { optionalParam } from './params';

const MIN_CLIFF_DEPTH = 3;

const TURN_CHANCE = 0.25;

const ATTEMPTS_PER_RIDGE = 6;

function canHoldCliff(ctx: MapContext, i: number): boolean {
  if (ctx.land[i] === 0 || ctx.landDepth[i] < MIN_CLIFF_DEPTH || ctx.startDist[i] <= ctx.zoneRadius) {
    return false;
  }
  return ctx.terrain[i] === TERRAIN.grass || ctx.terrain[i] === TERRAIN.desert;
}

function touchesCliff(ctx: MapContext, i: number, ridge: Int32Array, ridgeId: number): boolean {
  const x = i % ctx.size;
  const y = (i - x) / ctx.size;
  for (const [dx, dy] of NEIGHBORS_8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= ctx.size || ny >= ctx.size) {
      continue;
    }
    const other = ridge[ny * ctx.size + nx];
    if (other !== 0 && other !== ridgeId) {
      return true;
    }
  }
  return false;
}

export function countLandComponents(ctx: MapContext): number {
  const { size, tiles } = ctx;
  const seen = new Uint8Array(tiles);
  const queue = new Int32Array(tiles);
  let components = 0;
  for (let from = 0; from < tiles; from++) {
    const walkable = ctx.land[from] === 1 && ctx.terrain[from] !== TERRAIN.cliff;
    if (!walkable || seen[from] === 1) {
      continue;
    }
    components++;
    let head = 0;
    let tail = 0;
    seen[from] = 1;
    queue[tail++] = from;
    while (head < tail) {
      const i = queue[head++];
      const x = i % size;
      const y = (i - x) / size;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
          continue;
        }
        const j = ny * size + nx;
        if (seen[j] === 0 && ctx.land[j] === 1 && ctx.terrain[j] !== TERRAIN.cliff) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
  }
  return components;
}

function walkRidge(
  ctx: MapContext,
  start: number,
  length: number,
  ridge: Int32Array,
  ridgeId: number,
): number[] {
  const tiles: number[] = [];
  let [dx, dy] = pick(ctx.rng, NEIGHBORS_4);
  let i = start;
  while (tiles.length < length) {
    if (!canHoldCliff(ctx, i) || ridge[i] !== 0 || touchesCliff(ctx, i, ridge, ridgeId)) {
      break;
    }
    ridge[i] = ridgeId;
    tiles.push(i);
    if (chance(ctx.rng, TURN_CHANCE)) {
      [dx, dy] = dx === 0 ? [chance(ctx.rng, 0.5) ? 1 : -1, 0] : [0, chance(ctx.rng, 0.5) ? 1 : -1];
    }
    const x = (i % ctx.size) + dx;
    const y = Math.floor(i / ctx.size) + dy;
    if (x < 0 || y < 0 || x >= ctx.size || y >= ctx.size) {
      break;
    }
    i = y * ctx.size + x;
  }
  return tiles;
}

export function placeCliffs(ctx: MapContext): void {
  const density = optionalParam(ctx.def, 'cliffDensity', 0);
  const minLength = Math.max(1, Math.round(optionalParam(ctx.def, 'cliffRidgeMin', 1)));
  const maxLength = Math.max(minLength, Math.round(optionalParam(ctx.def, 'cliffRidgeMax', minLength)));
  if (density <= 0) {
    return;
  }
  const eligible: number[] = [];
  for (let i = 0; i < ctx.tiles; i++) {
    if (canHoldCliff(ctx, i)) {
      eligible.push(i);
    }
  }
  const wanted = Math.round(density * eligible.length);
  if (wanted <= 0) {
    return;
  }
  const ridge = new Int32Array(ctx.tiles);
  let components = countLandComponents(ctx);
  let placed = 0;
  let attempts = Math.ceil(wanted / minLength) * ATTEMPTS_PER_RIDGE;
  let ridgeId = 1;
  while (placed < wanted && attempts > 0) {
    attempts--;
    const start = eligible[nextInt(ctx.rng, 0, eligible.length)];
    const length = nextInt(ctx.rng, minLength, maxLength + 1);
    const tiles = walkRidge(ctx, start, length, ridge, ridgeId);
    if (tiles.length < minLength) {
      for (const i of tiles) {
        ridge[i] = 0;
      }
      continue;
    }
    const previous = tiles.map((i) => ctx.terrain[i]);
    for (const i of tiles) {
      ctx.terrain[i] = TERRAIN.cliff;
    }
    const after = countLandComponents(ctx);
    if (after > components) {
      tiles.forEach((i, n) => {
        ctx.terrain[i] = previous[n];
        ridge[i] = 0;
      });
      continue;
    }
    components = after;
    ridgeId++;
    placed += tiles.length;
    for (const i of tiles) {
      ctx.reserved[i] = 1;
    }
  }
}
