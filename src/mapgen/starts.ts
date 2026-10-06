import type { RngHolder } from '../sim/rng';
import { shuffle } from '../sim/rng';
import type { PlayerSetup } from '../sim/types';
import type { MapContext, StartSite } from './context';
import { clamp } from './grid';

export interface RingPoint {
  x: number;
  y: number;
  dirX: number;
  dirY: number;
}

const RING_SAMPLES = 720;

const EDGE_PADDING = 2;

export function orderPlayers(rng: RngHolder, players: readonly PlayerSetup[]): PlayerSetup[] {
  const groups: PlayerSetup[][] = [];
  const teams: Record<string, PlayerSetup[]> = {};
  for (const player of [...players].sort((a, b) => a.id - b.id)) {
    if (player.team === null) {
      groups.push([player]);
      continue;
    }
    let group = teams[player.team];
    if (!group) {
      group = [];
      teams[player.team] = group;
      groups.push(group);
    }
    group.push(player);
  }
  shuffle(rng, groups);
  for (const group of groups) {
    shuffle(rng, group);
  }
  return groups.flat();
}

export function ringPoints(count: number, half: number, extent: number, phase: number): RingPoint[] {
  const xs = new Float64Array(RING_SAMPLES + 1);
  const ys = new Float64Array(RING_SAMPLES + 1);
  const lengths = new Float64Array(RING_SAMPLES + 1);
  for (let k = 0; k <= RING_SAMPLES; k++) {
    const angle = (2 * Math.PI * k) / RING_SAMPLES;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const norm = Math.pow(c * c * c * c + s * s * s * s, 0.25);
    xs[k] = half + (c * extent) / norm;
    ys[k] = half + (s * extent) / norm;
    lengths[k] = k === 0 ? 0 : lengths[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
  }
  const total = lengths[RING_SAMPLES];
  const points: RingPoint[] = [];
  for (let i = 0; i < count; i++) {
    const target = ((phase + i / count) % 1) * total;
    let k = 0;
    while (k < RING_SAMPLES - 1 && lengths[k + 1] <= target) {
      k++;
    }
    const span = lengths[k + 1] - lengths[k];
    const t = span > 0 ? (target - lengths[k]) / span : 0;
    const x = xs[k] + (xs[k + 1] - xs[k]) * t;
    const y = ys[k] + (ys[k + 1] - ys[k]) * t;
    const length = Math.hypot(x - half, y - half);
    points.push({
      x,
      y,
      dirX: length > 0 ? (x - half) / length : 1,
      dirY: length > 0 ? (y - half) / length : 0,
    });
  }
  return points;
}

export function minPairDistance(points: readonly { x: number; y: number }[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      best = Math.min(best, Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y));
    }
  }
  return best;
}

export function createSite(ctx: MapContext, playerId: number, x: number, y: number): StartSite {
  const footprint = ctx.data.buildings[ctx.data.game.start.building].size;
  const limit = ctx.size - footprint - EDGE_PADDING;
  const origin = {
    x: clamp(Math.round(x - footprint / 2), EDGE_PADDING, limit),
    y: clamp(Math.round(y - footprint / 2), EDGE_PADDING, limit),
  };
  return {
    playerId,
    origin,
    center: { x: origin.x + footprint / 2, y: origin.y + footprint / 2 },
    access: origin.y * ctx.size + origin.x,
  };
}

export function measureStarts(ctx: MapContext): void {
  const { def, params, size, starts } = ctx;
  const spacing = minPairDistance(starts.map((site) => site.center));
  ctx.zoneRadius = Number.isFinite(spacing)
    ? clamp(Math.floor(spacing / 2), Math.min(params.minStartZoneRadius, def.startZoneRadius), def.startZoneRadius)
    : def.startZoneRadius;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      for (let s = 0; s < starts.length; s++) {
        const distance = Math.hypot(x + 0.5 - starts[s].center.x, y + 0.5 - starts[s].center.y);
        if (distance < ctx.startDist[i]) {
          ctx.startDist[i] = distance;
          ctx.nearestStart[i] = s;
        }
      }
    }
  }
}
