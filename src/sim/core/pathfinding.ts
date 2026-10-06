import type { GameData, MovementDomain } from '../../data/types';
import type { GameState, Vec2 } from '../types';
import type { NavGrid, PathField } from './navgrid';
import { getNavGrid, passability } from './navgrid';

const UNREACHED = 0x7fffffff;
const STRAIGHT_COST = 10;
const DIAGONAL_COST = 14;
const KEY_BASE = 1048576;
const MAX_FIELDS = 32;
const SMOOTH_LOOKAHEAD = 8;
const LOCAL_SEARCH_LIMIT = 4000;
const STEP_X = [1, 0, -1, 0, 1, -1, -1, 1];
const STEP_Y = [0, 1, 0, -1, 1, 1, -1, -1];

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
        child += 1;
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

function neighbor(pass: Uint8Array, size: number, x: number, y: number, direction: number): number {
  const nx = x + STEP_X[direction];
  const ny = y + STEP_Y[direction];
  if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
    return -1;
  }
  const index = ny * size + nx;
  if (pass[index] === 0) {
    return -1;
  }
  if (direction >= 4 && (pass[y * size + nx] === 0 || pass[ny * size + x] === 0)) {
    return -1;
  }
  return index;
}

function clampedTile(size: number, point: Vec2): number {
  const x = Math.min(size - 1, Math.max(0, Math.floor(point.x)));
  const y = Math.min(size - 1, Math.max(0, Math.floor(point.y)));
  return y * size + x;
}

function centerOf(size: number, index: number): Vec2 {
  const x = index % size;
  return { x: x + 0.5, y: (index - x) / size + 0.5 };
}

function componentsOf(grid: NavGrid, domain: MovementDomain): Int32Array {
  const cached = grid.components[domain];
  if (cached) {
    return cached;
  }
  const pass = passability(grid, domain);
  const size = grid.size;
  const labels = new Int32Array(pass.length).fill(-1);
  const stack: number[] = [];
  let next = 0;
  for (let start = 0; start < pass.length; start++) {
    if (pass[start] === 0 || labels[start] !== -1) {
      continue;
    }
    labels[start] = next;
    stack.push(start);
    while (stack.length > 0) {
      const index = stack.pop() as number;
      const x = index % size;
      const y = (index - x) / size;
      for (let direction = 0; direction < 4; direction++) {
        const other = neighbor(pass, size, x, y, direction);
        if (other >= 0 && labels[other] === -1) {
          labels[other] = next;
          stack.push(other);
        }
      }
    }
    next += 1;
  }
  grid.components[domain] = labels;
  return labels;
}

function nearestTile(
  size: number,
  origin: number,
  accept: (index: number) => boolean,
  towardX = 0,
  towardY = 0,
): number {
  if (accept(origin)) {
    return origin;
  }
  const originX = origin % size;
  const originY = (origin - originX) / size;
  const anchorX = originX + towardX * size;
  const anchorY = originY + towardY * size;
  let best = -1;
  let bestSq = Infinity;
  let bestBias = Infinity;
  const consider = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= size || y >= size) {
      return;
    }
    const dx = x - originX;
    const dy = y - originY;
    const distSq = dx * dx + dy * dy;
    if (distSq > bestSq) {
      return;
    }
    const index = y * size + x;
    const bias = (x - anchorX) * (x - anchorX) + (y - anchorY) * (y - anchorY);
    if (distSq === bestSq && (bias > bestBias || (bias === bestBias && index > best))) {
      return;
    }
    if (accept(index)) {
      best = index;
      bestSq = distSq;
      bestBias = bias;
    }
  };
  for (let ring = 1; ring < size; ring++) {
    if (best >= 0 && ring * ring > bestSq) {
      break;
    }
    for (let offset = -ring; offset <= ring; offset++) {
      consider(originX + offset, originY - ring);
      consider(originX + offset, originY + ring);
    }
    for (let offset = -ring + 1; offset <= ring - 1; offset++) {
      consider(originX - ring, originY + offset);
      consider(originX + ring, originY + offset);
    }
  }
  return best;
}

function resolveGoal(
  grid: NavGrid,
  domain: MovementDomain,
  start: number,
  goal: number,
): number {
  const labels = componentsOf(grid, domain);
  const component = labels[start];
  if (labels[goal] === component) {
    return goal;
  }
  const size = grid.size;
  const tiles = labels.length;
  const towardX = Math.sign((start % size) - (goal % size));
  const towardY = Math.sign(Math.floor(start / size) - Math.floor(goal / size));
  const sector = (towardY + 1) * 3 + towardX + 1;
  const key = (((domain === 'water' ? tiles + 1 : 0) + component) * 9 + sector) * tiles + goal;
  const known = grid.resolved.get(key);
  if (known !== undefined) {
    return known;
  }
  const resolved = nearestTile(size, goal, (index) => labels[index] === component, towardX, towardY);
  grid.resolved.set(key, resolved);
  return resolved;
}

function fieldFor(grid: NavGrid, domain: MovementDomain, goal: number): PathField {
  const tiles = grid.size * grid.size;
  const key = (domain === 'water' ? tiles : 0) + goal;
  const cached = grid.fields.get(key);
  if (cached) {
    grid.fields.delete(key);
    grid.fields.set(key, cached);
    return cached;
  }
  const field: PathField = {
    goal,
    dist: new Int32Array(tiles).fill(UNREACHED),
    done: new Uint8Array(tiles),
    heap: [],
  };
  field.dist[goal] = 0;
  heapPush(field.heap, goal);
  if (grid.fields.size >= MAX_FIELDS) {
    const oldest = grid.fields.keys().next().value;
    if (oldest !== undefined) {
      grid.fields.delete(oldest);
    }
  }
  grid.fields.set(key, field);
  return field;
}

function settle(pass: Uint8Array, size: number, field: PathField, target: number): boolean {
  const { dist, done, heap } = field;
  while (done[target] === 0 && heap.length > 0) {
    const key = heapPop(heap);
    const index = key % KEY_BASE;
    if (done[index] === 1) {
      continue;
    }
    done[index] = 1;
    const cost = (key - index) / KEY_BASE;
    const x = index % size;
    const y = (index - x) / size;
    for (let direction = 0; direction < 8; direction++) {
      const other = neighbor(pass, size, x, y, direction);
      if (other < 0 || done[other] === 1) {
        continue;
      }
      const next = cost + (direction < 4 ? STRAIGHT_COST : DIAGONAL_COST);
      if (next < dist[other]) {
        dist[other] = next;
        heapPush(heap, next * KEY_BASE + other);
      }
    }
  }
  return done[target] === 1;
}

function descend(pass: Uint8Array, size: number, field: PathField, start: number): number[] {
  const chain = [start];
  let current = start;
  while (current !== field.goal) {
    const x = current % size;
    const y = (current - x) / size;
    let best = -1;
    let bestDist = field.dist[current];
    for (let direction = 0; direction < 8; direction++) {
      const other = neighbor(pass, size, x, y, direction);
      if (other >= 0 && field.dist[other] < bestDist) {
        best = other;
        bestDist = field.dist[other];
      }
    }
    if (best < 0) {
      break;
    }
    chain.push(best);
    current = best;
  }
  return chain;
}

function lineClear(
  pass: Uint8Array,
  size: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  let x = Math.floor(ax);
  let y = Math.floor(ay);
  const endX = Math.floor(bx);
  const endY = Math.floor(by);
  if (x < 0 || y < 0 || x >= size || y >= size || pass[y * size + x] === 0) {
    return false;
  }
  const dx = bx - ax;
  const dy = by - ay;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const deltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const deltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let maxX = dx > 0 ? (x + 1 - ax) / dx : dx < 0 ? (ax - x) / -dx : Infinity;
  let maxY = dy > 0 ? (y + 1 - ay) / dy : dy < 0 ? (ay - y) / -dy : Infinity;
  let guard = Math.abs(endX - x) + Math.abs(endY - y) + 2;
  while (x !== endX || y !== endY) {
    guard -= 1;
    if (guard < 0) {
      return false;
    }
    if (maxX < maxY) {
      x += stepX;
      maxX += deltaX;
    } else if (maxY < maxX) {
      y += stepY;
      maxY += deltaY;
    } else {
      const sideX = x + stepX;
      const sideY = y + stepY;
      if (sideX < 0 || sideY < 0 || sideX >= size || sideY >= size) {
        return false;
      }
      if (pass[y * size + sideX] === 0 || pass[sideY * size + x] === 0) {
        return false;
      }
      x = sideX;
      y = sideY;
      maxX += deltaX;
      maxY += deltaY;
    }
    if (x < 0 || y < 0 || x >= size || y >= size || pass[y * size + x] === 0) {
      return false;
    }
  }
  return true;
}

function localSearch(pass: Uint8Array, size: number, start: number, goal: number): number[] | null {
  const goalX = goal % size;
  const goalY = (goal - goalX) / size;
  const estimate = (index: number): number => {
    const dx = Math.abs((index % size) - goalX);
    const dy = Math.abs(Math.floor(index / size) - goalY);
    return STRAIGHT_COST * (dx + dy) - (2 * STRAIGHT_COST - DIAGONAL_COST) * Math.min(dx, dy);
  };
  const cost = new Map<number, number>([[start, 0]]);
  const parent = new Map<number, number>();
  const closed = new Set<number>();
  const heap: number[] = [];
  heapPush(heap, estimate(start) * KEY_BASE + start);
  while (heap.length > 0 && closed.size < LOCAL_SEARCH_LIMIT) {
    const index = heapPop(heap) % KEY_BASE;
    if (closed.has(index)) {
      continue;
    }
    closed.add(index);
    if (index === goal) {
      const chain = [goal];
      let current = goal;
      while (current !== start) {
        current = parent.get(current) as number;
        chain.push(current);
      }
      return chain.reverse();
    }
    const base = cost.get(index) as number;
    const x = index % size;
    const y = (index - x) / size;
    for (let direction = 0; direction < 8; direction++) {
      const other = neighbor(pass, size, x, y, direction);
      if (other < 0 || closed.has(other)) {
        continue;
      }
      const next = base + (direction < 4 ? STRAIGHT_COST : DIAGONAL_COST);
      const known = cost.get(other);
      if (known === undefined || next < known) {
        cost.set(other, next);
        parent.set(other, index);
        heapPush(heap, (next + estimate(other)) * KEY_BASE + other);
      }
    }
  }
  return null;
}

function collapse(points: Vec2[]): Vec2[] {
  if (points.length < 3) {
    return points;
  }
  const kept = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = kept[kept.length - 1];
    const current = points[i];
    const following = points[i + 1];
    const cross =
      (current.x - previous.x) * (following.y - current.y) -
      (current.y - previous.y) * (following.x - current.x);
    if (cross !== 0) {
      kept.push(current);
    }
  }
  kept.push(points[points.length - 1]);
  return kept;
}

function smooth(pass: Uint8Array, size: number, raw: Vec2[]): Vec2[] {
  const points = collapse(raw);
  const result: Vec2[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = Math.min(points.length - 1, anchor + SMOOTH_LOOKAHEAD);
    while (
      next > anchor + 1 &&
      !lineClear(pass, size, points[anchor].x, points[anchor].y, points[next].x, points[next].y)
    ) {
      next -= 1;
    }
    result.push(points[next]);
    anchor = next;
  }
  return result;
}

function goalPoint(size: number, tile: number, requested: Vec2): Vec2 {
  return clampedTile(size, requested) === tile
    ? { x: requested.x, y: requested.y }
    : centerOf(size, tile);
}

export function computePath(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  from: Vec2,
  goal: Vec2,
  via: Vec2 | null = null,
): Vec2[] {
  const grid = getNavGrid(state, data);
  const pass = passability(grid, domain);
  const size = grid.size;
  const points: Vec2[] = [{ x: from.x, y: from.y }];
  let start = clampedTile(size, from);
  if (pass[start] === 0) {
    start = nearestTile(size, start, (index) => pass[index] === 1);
    if (start < 0) {
      return [];
    }
    points.push(centerOf(size, start));
  }
  const goalTile = resolveGoal(grid, domain, start, clampedTile(size, goal));
  const fieldGoal = via ? resolveGoal(grid, domain, start, clampedTile(size, via)) : goalTile;
  const field = fieldFor(grid, domain, fieldGoal);
  if (!settle(pass, size, field, start)) {
    return [];
  }
  const chain = descend(pass, size, field, start);
  const destination = goalPoint(size, goalTile, goal);

  if (!via || fieldGoal === goalTile) {
    for (let i = 1; i < chain.length - 1; i++) {
      points.push(centerOf(size, chain[i]));
    }
    points.push(destination);
    return smooth(pass, size, points);
  }

  const hub = centerOf(size, fieldGoal);
  const reach = Math.hypot(hub.x - destination.x, hub.y - destination.y) + 2;
  for (let i = 0; i < chain.length; i++) {
    const point = i === 0 ? points[points.length - 1] : centerOf(size, chain[i]);
    if (i > 0) {
      points.push(point);
    }
    if (
      Math.hypot(point.x - hub.x, point.y - hub.y) <= reach &&
      lineClear(pass, size, point.x, point.y, destination.x, destination.y)
    ) {
      points.push(destination);
      return smooth(pass, size, points);
    }
  }
  const tail = localSearch(pass, size, fieldGoal, goalTile);
  if (tail) {
    for (let i = 1; i < tail.length - 1; i++) {
      points.push(centerOf(size, tail[i]));
    }
    points.push(destination);
  }
  return smooth(pass, size, points);
}

export function findPath(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  from: Vec2,
  to: Vec2,
): Vec2[] {
  return computePath(state, data, domain, from, to, null);
}

export function pathCostEstimate(state: GameState, from: Vec2, hub: Vec2): number {
  const size = state.map.size;
  const span =
    Math.max(Math.abs(Math.floor(from.x) - Math.floor(hub.x)), Math.abs(Math.floor(from.y) - Math.floor(hub.y))) + 2;
  return Math.min(size * size, 4 * span * span);
}

export function pathFieldKey(state: GameState, domain: MovementDomain, hub: Vec2): number {
  const size = state.map.size;
  return (domain === 'water' ? size * size : 0) + clampedTile(size, hub);
}

export function nearestPassablePoint(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  point: Vec2,
): Vec2 | null {
  const grid = getNavGrid(state, data);
  const pass = passability(grid, domain);
  const origin = clampedTile(grid.size, point);
  if (pass[origin] === 1) {
    return { x: point.x, y: point.y };
  }
  const tile = nearestTile(grid.size, origin, (index) => pass[index] === 1);
  return tile < 0 ? null : centerOf(grid.size, tile);
}

export function nearestReachablePoint(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  from: Vec2,
  goal: Vec2,
): Vec2 | null {
  const grid = getNavGrid(state, data);
  const pass = passability(grid, domain);
  const size = grid.size;
  const start = nearestTile(size, clampedTile(size, from), (index) => pass[index] === 1);
  if (start < 0) {
    return null;
  }
  const tile = resolveGoal(grid, domain, start, clampedTile(size, goal));
  return goalPoint(size, tile, goal);
}

export function isReachable(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  from: Vec2,
  to: Vec2,
): boolean {
  const grid = getNavGrid(state, data);
  const labels = componentsOf(grid, domain);
  const size = grid.size;
  const a = labels[clampedTile(size, from)];
  return a >= 0 && a === labels[clampedTile(size, to)];
}

export function freeTilesNear(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  origin: Vec2,
  count: number,
  spacing = 1,
): Vec2[] {
  const grid = getNavGrid(state, data);
  const pass = passability(grid, domain);
  const size = grid.size;
  const start = clampedTile(size, origin);
  if (pass[start] === 0 || count <= 0) {
    return [];
  }
  const startX = start % size;
  const startY = (start - startX) / size;
  const seen = new Uint8Array(pass.length);
  const queue = [start];
  const found: Vec2[] = [];
  seen[start] = 1;
  for (let head = 0; head < queue.length && found.length < count; head++) {
    const index = queue[head];
    const x = index % size;
    const y = (index - x) / size;
    if ((x - startX) % spacing === 0 && (y - startY) % spacing === 0) {
      found.push(index === start ? { x: origin.x, y: origin.y } : centerOf(size, index));
    }
    for (let direction = 0; direction < 4; direction++) {
      const other = neighbor(pass, size, x, y, direction);
      if (other >= 0 && seen[other] === 0) {
        seen[other] = 1;
        queue.push(other);
      }
    }
  }
  return found;
}

export function formationSlots(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  from: Vec2,
  target: Vec2,
  count: number,
  spacing = 1,
): Vec2[] {
  const hub = nearestReachablePoint(state, data, domain, from, target);
  if (!hub) {
    return [];
  }
  const slots = freeTilesNear(state, data, domain, hub, count, spacing);
  while (slots.length > 0 && slots.length < count) {
    slots.push({ ...slots[slots.length - 1] });
  }
  return slots;
}
