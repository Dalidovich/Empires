export type Offset = readonly [number, number];

export const NEIGHBORS_4: readonly Offset[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

export const NEIGHBORS_8: readonly Offset[] = [
  ...NEIGHBORS_4,
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

export const FAR = 32767;

export function distanceField(size: number, mask: Uint8Array, sourceValue: number): Int16Array {
  const tiles = size * size;
  const dist = new Int16Array(tiles).fill(FAR);
  const queue = new Int32Array(tiles);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < tiles; i++) {
    if (mask[i] === sourceValue) {
      dist[i] = 0;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % size;
    const y = (i - x) / size;
    const next = dist[i] + 1;
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
        continue;
      }
      const j = ny * size + nx;
      if (dist[j] === FAR) {
        dist[j] = next;
        queue[tail++] = j;
      }
    }
  }
  return dist;
}

export function sortedValues(values: ArrayLike<number>): Float32Array {
  return Float32Array.from(values).sort();
}

export function forEachInDisc(
  size: number,
  cx: number,
  cy: number,
  radius: number,
  visit: (index: number, distance: number) => void,
): void {
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(size - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(size - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (distance <= radius) {
        visit(y * size + x, distance);
      }
    }
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
