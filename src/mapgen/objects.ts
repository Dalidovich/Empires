import { nextInt, pick } from '../sim/rng';
import type { EntityKind } from '../sim/types';
import { GAIA_PLAYER_ID, TERRAIN } from '../sim/types';
import type { MapContext } from './context';
import { FOREST_CLUMP, inBounds, tileCenterOf } from './context';
import { NEIGHBORS_4, NEIGHBORS_8, forEachInDisc, sortedValues } from './grid';
import { noiseField } from './noise';
import { CLUSTER_PREFIX, WATERSIDE_PREFIX, optionalParam, sizeScale } from './params';

interface Placeable {
  id: string;
  kind: EntityKind;
  blocking: boolean;
  water: boolean;
  shoreline: boolean;
  waterside: boolean;
  forest: boolean;
  aggressive: boolean;
}

type TilePredicate = (index: number) => boolean;

const AREA_UNIT = 1000;

const SEED_FAILURES = 30;

const GROW_ATTEMPTS_PER_ITEM = 24;

const SPREAD_SAMPLES = 10;

const HERD_REACH = 2;

const OPEN_WATER_DISTANCE = 3;

const WATERSIDE_DEPTH = 2;

function resolvePlaceable(ctx: MapContext, id: string): Placeable {
  const source = ctx.data.resourceSources[id];
  if (source) {
    return {
      id,
      kind: 'resource',
      blocking: source.blocksMovement,
      water: source.domain === 'water',
      shoreline: source.gatherKind === 'shore_fish',
      waterside: false,
      forest: source.gatherKind === 'wood',
      aggressive: false,
    };
  }
  const unit = ctx.data.units[id];
  if (unit) {
    return {
      id,
      kind: 'unit',
      blocking: false,
      water: unit.domain === 'water',
      shoreline: false,
      waterside: optionalParam(ctx.def, WATERSIDE_PREFIX + id, 0) > 0,
      forest: false,
      aggressive: unit.animal?.behavior === 'aggressive',
    };
  }
  throw new Error(`Unknown map object id: ${id}`);
}

function tileSuits(ctx: MapContext, item: Placeable, i: number, strict: boolean): boolean {
  if (item.water) {
    if (ctx.land[i] === 1) {
      return false;
    }
    if (item.shoreline) {
      return ctx.coastDist[i] === 1;
    }
    return ctx.coastDist[i] >= OPEN_WATER_DISTANCE && ctx.terrain[i] === TERRAIN.deepWater;
  }
  if (item.waterside) {
    return ctx.land[i] === 1
      ? ctx.landDepth[i] <= WATERSIDE_DEPTH
      : ctx.terrain[i] === TERRAIN.shallows;
  }
  if (ctx.land[i] === 0) {
    return false;
  }
  return strict ? ctx.landDepth[i] > 1 : true;
}

function keepsGap(ctx: MapContext, i: number, clumpId: number): boolean {
  const x = i % ctx.size;
  const y = (i - x) / ctx.size;
  for (const [dx, dy] of NEIGHBORS_8) {
    if (!inBounds(ctx, x + dx, y + dy)) {
      continue;
    }
    const other = ctx.clump[(y + dy) * ctx.size + x + dx];
    if (other !== 0 && other !== clumpId) {
      return false;
    }
  }
  return true;
}

function canPlace(
  ctx: MapContext,
  item: Placeable,
  i: number,
  clumpId: number,
  valid: TilePredicate,
): boolean {
  if (ctx.blocked[i] === 1 || ctx.taken[i] === 1 || ctx.reserved[i] === 1 || !valid(i)) {
    return false;
  }
  return !item.blocking || keepsGap(ctx, i, clumpId);
}

function put(ctx: MapContext, item: Placeable, i: number, clumpId: number): void {
  ctx.entities.push({
    kind: item.kind,
    type: item.id,
    owner: GAIA_PLAYER_ID,
    position: tileCenterOf(ctx, i),
  });
  if (!item.blocking) {
    ctx.taken[i] = 1;
    return;
  }
  ctx.blocked[i] = 1;
  ctx.clump[i] = clumpId;
  ctx.entityAt[i] = ctx.entities.length;
  if (item.forest) {
    ctx.terrain[i] = TERRAIN.forest;
  }
}

function growGroup(
  ctx: MapContext,
  item: Placeable,
  seed: number,
  count: number,
  clumpId: number,
  valid: TilePredicate,
): number {
  const placed = [seed];
  put(ctx, item, seed, clumpId);
  let attempts = count * GROW_ATTEMPTS_PER_ITEM;
  while (placed.length < count && attempts > 0) {
    attempts--;
    const base = pick(ctx.rng, placed);
    const x = base % ctx.size;
    const y = (base - x) / ctx.size;
    let nx: number;
    let ny: number;
    if (item.blocking) {
      const [dx, dy] = pick(ctx.rng, NEIGHBORS_4);
      nx = x + dx;
      ny = y + dy;
    } else {
      nx = x + nextInt(ctx.rng, -HERD_REACH, HERD_REACH + 1);
      ny = y + nextInt(ctx.rng, -HERD_REACH, HERD_REACH + 1);
    }
    if (!inBounds(ctx, nx, ny)) {
      continue;
    }
    const next = ny * ctx.size + nx;
    if (canPlace(ctx, item, next, clumpId, valid)) {
      put(ctx, item, next, clumpId);
      placed.push(next);
    }
  }
  return placed.length;
}

function tileDistance(ctx: MapContext, a: number, b: number): number {
  const ax = a % ctx.size;
  const bx = b % ctx.size;
  return Math.hypot(ax - bx, (a - ax) / ctx.size - (b - bx) / ctx.size);
}

function spreadSeed(ctx: MapContext, candidates: readonly number[], others: readonly number[]): number {
  let best = pick(ctx.rng, candidates);
  if (others.length === 0) {
    return best;
  }
  let bestScore = -1;
  for (let sample = 0; sample < SPREAD_SAMPLES; sample++) {
    const candidate = pick(ctx.rng, candidates);
    let score = Infinity;
    for (const other of others) {
      score = Math.min(score, tileDistance(ctx, candidate, other));
    }
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return best;
}

function placeGroups(
  ctx: MapContext,
  item: Placeable,
  total: number,
  cluster: number,
  candidates: readonly number[],
  valid: TilePredicate,
  spread: number[] | null,
): number {
  let placed = 0;
  let failures = 0;
  while (placed < total && failures < SEED_FAILURES && candidates.length > 0) {
    const seed = spread ? spreadSeed(ctx, candidates, spread) : pick(ctx.rng, candidates);
    const clumpId = ctx.nextClump;
    if (!canPlace(ctx, item, seed, clumpId, valid)) {
      failures++;
      continue;
    }
    ctx.nextClump++;
    spread?.push(seed);
    placed += growGroup(ctx, item, seed, Math.min(cluster, total - placed), clumpId, valid);
  }
  return placed;
}

function collectTiles(ctx: MapContext, valid: TilePredicate): number[] {
  const found: number[] = [];
  for (let i = 0; i < ctx.tiles; i++) {
    if (valid(i)) {
      found.push(i);
    }
  }
  return found;
}

function clusterSize(ctx: MapContext, id: string): number {
  return Math.max(1, Math.round(optionalParam(ctx.def, CLUSTER_PREFIX + id, 1)));
}

function countTiles(ctx: MapContext, water: boolean): number {
  let count = 0;
  for (let i = 0; i < ctx.tiles; i++) {
    if ((ctx.land[i] === 0) === water) {
      count++;
    }
  }
  return count;
}

export function placeStarts(ctx: MapContext): void {
  const { data, size } = ctx;
  const start = data.game.start;
  const footprint = data.buildings[start.building].size;
  const nomad = ctx.settings.startMode === 'nomad';
  const unitCount = nomad ? (data.game.nomadStart?.unitCount ?? start.unitCount) : start.unitCount;
  for (const site of ctx.starts) {
    forEachInDisc(size, site.center.x, site.center.y, ctx.params.startClearRadius, (i) => {
      ctx.reserved[i] = 1;
    });
    const clumpId = ctx.nextClump++;
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        const i = (site.origin.y + dy) * size + site.origin.x + dx;
        ctx.blocked[i] = 1;
        ctx.fixed[i] = 1;
        ctx.clump[i] = clumpId;
        ctx.reserved[i] = 1;
      }
    }
    if (!nomad) {
      ctx.entities.push({
        kind: 'building',
        type: start.building,
        owner: site.playerId,
        position: { x: site.center.x, y: site.center.y },
      });
    }
    const around: number[] = [];
    for (let ring = 1; around.length < unitCount && ring <= footprint + 1; ring++) {
      for (let dy = footprint - 1 + ring; dy >= -ring; dy--) {
        for (let dx = -ring; dx <= footprint - 1 + ring; dx++) {
          const onRing =
            dx === -ring || dy === -ring || dx === footprint - 1 + ring || dy === footprint - 1 + ring;
          const x = site.origin.x + dx;
          const y = site.origin.y + dy;
          if (!onRing || !inBounds(ctx, x, y)) {
            continue;
          }
          const i = y * size + x;
          if (ctx.land[i] === 1 && ctx.blocked[i] === 0 && ctx.taken[i] === 0) {
            around.push(i);
          }
        }
      }
    }
    site.access = around[0] ?? site.access;
    for (const i of around.slice(0, unitCount)) {
      ctx.taken[i] = 1;
      ctx.entities.push({
        kind: 'unit',
        type: start.unit,
        owner: site.playerId,
        position: tileCenterOf(ctx, i),
      });
    }
  }
}

export function placeStartResources(ctx: MapContext): void {
  const reach = ctx.zoneRadius - 0.5;
  for (const [index, site] of ctx.starts.entries()) {
    const seeds: number[] = [];
    const zone: number[] = [];
    forEachInDisc(ctx.size, site.center.x, site.center.y, reach, (i) => {
      if (ctx.nearestStart[i] === index) {
        zone.push(i);
      }
    });
    const inZone: TilePredicate = (i) => ctx.nearestStart[i] === index && ctx.startDist[i] <= reach;
    for (const [id, amount] of Object.entries(ctx.def.startResources)) {
      const count = Math.round(amount);
      if (count <= 0) {
        continue;
      }
      const item = resolvePlaceable(ctx, id);
      const clumps = item.forest ? Math.max(1, Math.round(ctx.params.startForestClumps)) : 1;
      const cluster = Math.ceil(count / clumps);
      let remaining = count;
      for (const strict of [true, false]) {
        if (remaining <= 0) {
          break;
        }
        const valid: TilePredicate = (i) => inZone(i) && tileSuits(ctx, item, i, strict);
        const candidates = zone.filter((i) => ctx.reserved[i] === 0 && valid(i));
        remaining -= placeGroups(ctx, item, remaining, cluster, candidates, valid, seeds);
      }
    }
  }
}

export function growForests(ctx: MapContext): void {
  const { tiles, def, rng, size, params } = ctx;
  const source = ctx.data.resources.sources.find(
    (candidate) => candidate.gatherKind === 'wood' && candidate.blocksMovement,
  );
  if (!source) {
    return;
  }
  const item = resolvePlaceable(ctx, source.id);
  const noise = noiseField(rng, size, params.forestNoiseScale);
  const margin = ctx.zoneRadius + 1;
  const eligible: number[] = [];
  let landCount = 0;
  let forestCount = 0;
  for (let i = 0; i < tiles; i++) {
    if (ctx.land[i] === 0) {
      continue;
    }
    landCount++;
    if (ctx.terrain[i] === TERRAIN.forest) {
      forestCount++;
    }
    const open = ctx.blocked[i] === 0 && ctx.taken[i] === 0 && ctx.reserved[i] === 0;
    if (open && ctx.landDepth[i] > 1 && ctx.startDist[i] > margin) {
      eligible.push(i);
    }
  }
  const wanted = Math.min(eligible.length, Math.round(def.forestRatio * landCount) - forestCount);
  if (wanted <= 0) {
    return;
  }
  const sorted = sortedValues(eligible.map((i) => noise[i]));
  const threshold = sorted[sorted.length - wanted];
  for (const i of eligible) {
    if (noise[i] >= threshold) {
      put(ctx, item, i, FOREST_CLUMP);
    }
  }
}

function placeScattered(
  ctx: MapContext,
  amounts: Readonly<Record<string, number>>,
  atLeastOne: boolean,
): void {
  const landCount = countTiles(ctx, false);
  const waterCount = ctx.tiles - landCount;
  for (const [id, density] of Object.entries(amounts)) {
    if (density <= 0) {
      continue;
    }
    const item = resolvePlaceable(ctx, id);
    const area = item.water ? waterCount : landCount;
    const count = Math.max(atLeastOne ? 1 : 0, Math.round((density * area) / AREA_UNIT));
    const safety = item.aggressive ? ctx.params.predatorMargin : 0;
    const margins = [ctx.zoneRadius + safety];
    if (atLeastOne) {
      margins.push(ctx.params.startClearRadius + safety);
    }
    for (const margin of margins) {
      const valid: TilePredicate = (i) => ctx.startDist[i] > margin && tileSuits(ctx, item, i, true);
      const candidates = collectTiles(ctx, valid);
      if (placeGroups(ctx, item, count, clusterSize(ctx, id), candidates, valid, null) > 0) {
        break;
      }
    }
  }
}

export function placeAreaResources(ctx: MapContext): void {
  placeScattered(ctx, ctx.def.areaResources, false);
}

export function placeAnimals(ctx: MapContext): void {
  placeScattered(ctx, ctx.def.areaAnimals, true);
}

function footprintOpen(ctx: MapContext, x: number, y: number, footprint: number, margin: number): boolean {
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      if (!inBounds(ctx, x + dx, y + dy)) {
        return false;
      }
      const i = (y + dy) * ctx.size + x + dx;
      const open = ctx.blocked[i] === 0 && ctx.taken[i] === 0 && ctx.reserved[i] === 0;
      if (!open || ctx.land[i] === 0 || ctx.landDepth[i] <= 1 || ctx.startDist[i] <= margin) {
        return false;
      }
      if (!keepsGap(ctx, i, 0)) {
        return false;
      }
    }
  }
  return true;
}

export function placeRelics(ctx: MapContext): void {
  const scale = sizeScale(ctx.def, ctx.settings.mapSize);
  const wanted: Record<string, number> = {
    ruin: Math.round(ctx.def.ruins * scale),
    artifact: Math.round(ctx.def.artifacts * scale),
  };
  const placedAt: number[] = [];
  for (const object of ctx.data.resources.objects) {
    const count = wanted[object.kind] ?? 0;
    const blocking = object.kind === 'ruin';
    for (let n = 0; n < count; n++) {
      let candidates: number[] = [];
      for (const margin of [ctx.zoneRadius + ctx.params.objectMargin, ctx.zoneRadius, 0]) {
        candidates = collectTiles(ctx, (i) => {
          const x = i % ctx.size;
          return footprintOpen(ctx, x, (i - x) / ctx.size, object.size, margin);
        });
        if (candidates.length > 0) {
          break;
        }
      }
      if (candidates.length === 0) {
        break;
      }
      const origin = spreadSeed(ctx, candidates, placedAt);
      placedAt.push(origin);
      const x = origin % ctx.size;
      const y = (origin - x) / ctx.size;
      const clumpId = ctx.nextClump++;
      for (let dy = 0; dy < object.size; dy++) {
        for (let dx = 0; dx < object.size; dx++) {
          const i = (y + dy) * ctx.size + x + dx;
          if (blocking) {
            ctx.blocked[i] = 1;
            ctx.fixed[i] = 1;
            ctx.clump[i] = clumpId;
          } else {
            ctx.taken[i] = 1;
          }
        }
      }
      ctx.entities.push({
        kind: 'object',
        type: object.id,
        owner: GAIA_PLAYER_ID,
        position: { x: x + object.size / 2, y: y + object.size / 2 },
      });
    }
  }
}
