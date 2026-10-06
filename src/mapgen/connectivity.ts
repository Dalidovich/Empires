import { TERRAIN } from '../sim/types';
import type { MapContext } from './context';
import { NEIGHBORS_4 } from './grid';

const STEP_COST = 1;

const TREE_COST = 50;

const WATER_COST = 200;

const OBSTACLE_COST = 500;

function isOpen(ctx: MapContext, i: number): boolean {
  return ctx.blocked[i] === 0 && ctx.terrain[i] !== TERRAIN.deepWater && ctx.terrain[i] !== TERRAIN.cliff;
}

export function floodLand(ctx: MapContext, from: number): Uint8Array {
  const { size, tiles } = ctx;
  const reached = new Uint8Array(tiles);
  const queue = new Int32Array(tiles);
  let head = 0;
  let tail = 0;
  reached[from] = 1;
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
      if (reached[j] === 0 && isOpen(ctx, j)) {
        reached[j] = 1;
        queue[tail++] = j;
      }
    }
  }
  return reached;
}

function heapPush(heap: number[], key: number): void {
  let i = heap.length;
  heap.push(key);
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (heap[parent] <= key) {
      break;
    }
    heap[i] = heap[parent];
    i = parent;
  }
  heap[i] = key;
}

function heapPop(heap: number[]): number {
  const top = heap[0];
  const last = heap.pop() as number;
  const length = heap.length;
  if (length > 0) {
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= length) {
        break;
      }
      if (child + 1 < length && heap[child + 1] < heap[child]) {
        child++;
      }
      if (heap[child] >= last) {
        break;
      }
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
  }
  return top;
}

function entryCost(ctx: MapContext, i: number): number {
  if (ctx.fixed[i] === 1 || ctx.terrain[i] === TERRAIN.cliff) {
    return -1;
  }
  let cost = STEP_COST;
  if (ctx.blocked[i] === 1) {
    cost += ctx.terrain[i] === TERRAIN.forest ? TREE_COST : OBSTACLE_COST;
  }
  if (ctx.terrain[i] === TERRAIN.deepWater) {
    cost += WATER_COST;
  }
  return cost;
}

function cheapestRoutes(ctx: MapContext, from: number): Int32Array {
  const { size, tiles } = ctx;
  const cost = new Float64Array(tiles).fill(Infinity);
  const previous = new Int32Array(tiles).fill(-1);
  const heap: number[] = [];
  cost[from] = 0;
  heapPush(heap, from);
  while (heap.length > 0) {
    const key = heapPop(heap);
    const i = key % tiles;
    const reached = (key - i) / tiles;
    if (reached > cost[i]) {
      continue;
    }
    const x = i % size;
    const y = (i - x) / size;
    for (const [dx, dy] of NEIGHBORS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
        continue;
      }
      const j = ny * size + nx;
      const step = entryCost(ctx, j);
      if (step < 0 || reached + step >= cost[j]) {
        continue;
      }
      cost[j] = reached + step;
      previous[j] = i;
      heapPush(heap, cost[j] * tiles + j);
    }
  }
  return previous;
}

function openTile(ctx: MapContext, i: number): void {
  const slot = ctx.entityAt[i];
  if (slot > 0) {
    ctx.entities[slot - 1] = null;
    ctx.entityAt[i] = 0;
    ctx.blocked[i] = 0;
    ctx.clump[i] = 0;
    if (ctx.terrain[i] === TERRAIN.forest) {
      ctx.terrain[i] = TERRAIN.grass;
    }
  }
  if (ctx.terrain[i] === TERRAIN.deepWater) {
    ctx.terrain[i] = TERRAIN.shallows;
  }
}

export function connectStarts(ctx: MapContext): void {
  if (ctx.starts.length < 2) {
    return;
  }
  const hub = ctx.starts[0].access;
  const reached = floodLand(ctx, hub);
  const isolated = ctx.starts.filter((site) => reached[site.access] === 0);
  if (isolated.length === 0) {
    return;
  }
  const previous = cheapestRoutes(ctx, hub);
  for (const site of isolated) {
    for (let i = site.access; i !== -1; i = previous[i]) {
      openTile(ctx, i);
    }
  }
}
