import { nextFloat, nextInt, nextRange } from '../sim/rng';
import type { PlayerSetup } from '../sim/types';
import type { MapContext } from './context';
import { clamp, forEachInDisc, sortedValues } from './grid';
import { noiseField } from './noise';
import { createSite, measureStarts, minPairDistance, ringPoints } from './starts';

interface Island {
  x: number;
  y: number;
  radius: number;
}

const EXTRA_ISLAND_ATTEMPTS = 400;

const ISLAND_EDGE_PADDING = 2;

function forceLand(ctx: MapContext, radius: number): void {
  for (const site of ctx.starts) {
    forEachInDisc(ctx.size, site.center.x, site.center.y, radius, (i) => {
      ctx.land[i] = 1;
    });
  }
}

function layoutLand(ctx: MapContext, players: readonly PlayerSetup[]): void {
  const { size, tiles, params, def, rng } = ctx;
  const half = size / 2;
  const extent = Math.max(
    0,
    Math.min(size * params.startRingRatio, half - params.startEdgeMargin),
  );
  const points = ringPoints(players.length, half, extent, nextFloat(rng));
  ctx.starts = points.map((point, index) => createSite(ctx, players[index].id, point.x, point.y));
  measureStarts(ctx);
  const noise = noiseField(rng, size, params.terrainNoiseScale);
  const waterCount = Math.round((1 - def.landRatio) * tiles);
  const sorted = sortedValues(noise);
  const threshold = waterCount > 0 ? sorted[Math.min(tiles - 1, waterCount)] : -1;
  for (let i = 0; i < tiles; i++) {
    ctx.land[i] = noise[i] < threshold ? 0 : 1;
  }
  forceLand(ctx, ctx.zoneRadius);
}

function layoutCoastal(ctx: MapContext, players: readonly PlayerSetup[]): void {
  const { size, tiles, params, def, rng } = ctx;
  const half = size / 2;
  const amplitude = params.coastNoise * size;
  const edge = params.edgeWater;
  const noise = noiseField(rng, size, params.terrainNoiseScale);
  const field = new Float32Array(tiles);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const i = y * size + x;
      field[i] = Math.pow(dx * dx * dx * dx + dy * dy * dy * dy, 0.25) - amplitude * (2 * noise[i] - 1);
    }
  }
  const sorted = sortedValues(field);
  const radius = sorted[clamp(Math.round(def.landRatio * tiles), 0, tiles - 1)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const inside = x >= edge && y >= edge && x < size - edge && y < size - edge;
      ctx.land[i] = inside && field[i] < radius ? 1 : 0;
    }
  }
  const points = ringPoints(players.length, half, radius, nextFloat(rng));
  ctx.starts = points.map((point, index) => {
    let reach = size;
    for (; reach > 0; reach -= 0.5) {
      const x = Math.floor(half + point.dirX * reach);
      const y = Math.floor(half + point.dirY * reach);
      if (x >= 0 && y >= 0 && x < size && y < size && ctx.land[y * size + x] === 1) {
        break;
      }
    }
    const inset = Math.max(0, reach - params.coastOffset);
    return createSite(ctx, players[index].id, half + point.dirX * inset, half + point.dirY * inset);
  });
  measureStarts(ctx);
  forceLand(ctx, params.startClearRadius + 1);
}

function fitIslandRadius(ctx: MapContext, count: number, phase: number): number {
  const { size, tiles, params, def } = ctx;
  const coverage = Math.PI * Math.pow(1 - params.islandRoughness / 2, 2);
  const wanted = Math.sqrt((def.landRatio * tiles) / (Math.max(1, count) * coverage));
  let radius = Math.floor(clamp(wanted, params.minIslandRadius, params.maxIslandRadius));
  for (; radius > params.minIslandRadius; radius--) {
    const extent = size / 2 - radius - ISLAND_EDGE_PADDING;
    const spacing = minPairDistance(ringPoints(count, size / 2, extent, phase));
    if (spacing >= 2 * radius + params.channelWidth) {
      break;
    }
  }
  return radius;
}

function addExtraIslands(ctx: MapContext, islands: Island[], budget: number): void {
  const { size, params, rng } = ctx;
  const coverage = Math.PI * Math.pow(1 - params.islandRoughness / 2, 2);
  let remaining = budget;
  for (let attempt = 0; attempt < EXTRA_ISLAND_ATTEMPTS; attempt++) {
    if (remaining < coverage * params.extraIslandMinRadius * params.extraIslandMinRadius) {
      break;
    }
    const largest = Math.min(params.extraIslandMaxRadius, Math.floor(Math.sqrt(remaining / coverage)));
    const radius = nextInt(rng, params.extraIslandMinRadius, largest + 1);
    const margin = radius + ISLAND_EDGE_PADDING;
    if (size - margin <= margin) {
      continue;
    }
    const x = nextRange(rng, margin, size - margin);
    const y = nextRange(rng, margin, size - margin);
    const fits = islands.every(
      (other) => Math.hypot(other.x - x, other.y - y) >= other.radius + radius + params.channelWidth,
    );
    if (fits) {
      islands.push({ x, y, radius });
      remaining -= coverage * radius * radius;
    }
  }
}

function layoutIslands(ctx: MapContext, players: readonly PlayerSetup[]): void {
  const { size, tiles, params, def, rng } = ctx;
  const half = size / 2;
  const phase = nextFloat(rng);
  const radius = fitIslandRadius(ctx, players.length, phase);
  const points = ringPoints(players.length, half, half - radius - ISLAND_EDGE_PADDING, phase);
  const islands: Island[] = points.map((point) => ({ x: point.x, y: point.y, radius }));
  const coverage = Math.PI * Math.pow(1 - params.islandRoughness / 2, 2);
  addExtraIslands(ctx, islands, def.landRatio * tiles - players.length * coverage * radius * radius);
  const noise = noiseField(rng, size, params.terrainNoiseScale);
  for (const island of islands) {
    forEachInDisc(size, island.x, island.y, island.radius, (i, distance) => {
      if (distance < island.radius * (1 - params.islandRoughness * noise[i])) {
        ctx.land[i] = 1;
      }
    });
  }
  const inset = Math.max(0, radius * (1 - params.islandRoughness) - params.coastOffset);
  ctx.starts = points.map((point, index) =>
    createSite(ctx, players[index].id, point.x + point.dirX * inset, point.y + point.dirY * inset),
  );
  measureStarts(ctx);
}

export function layoutMap(ctx: MapContext, players: readonly PlayerSetup[]): void {
  switch (ctx.def.layout) {
    case 'islands':
      layoutIslands(ctx, players);
      break;
    case 'coastal':
      layoutCoastal(ctx, players);
      break;
    default:
      layoutLand(ctx, players);
      break;
  }
}
