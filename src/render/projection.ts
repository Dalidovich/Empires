import type { Vec2 } from '../sim/types';

export const TILE_HALF_WIDTH = 32;
export const TILE_HALF_HEIGHT = 16;
export const ELEVATION_HEIGHT = 12;

const MARCH_STEP = 0.25;
const BISECT_STEPS = 12;

export const DIRECTIONS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;

export type Direction = (typeof DIRECTIONS)[number];

export interface HeightField {
  size: number;
  corners: Float32Array;
  maxHeight: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export function flatHeightField(size: number): HeightField {
  const side = size + 1;
  return { size, corners: new Float32Array(side * side), maxHeight: 0 };
}

export function buildHeightField(size: number, elevation: ArrayLike<number>): HeightField {
  const side = size + 1;
  const corners = new Float32Array(side * side);
  let maxHeight = 0;
  for (let cy = 0; cy <= size; cy += 1) {
    for (let cx = 0; cx <= size; cx += 1) {
      let sum = 0;
      let count = 0;
      for (let ty = cy - 1; ty <= cy; ty += 1) {
        if (ty < 0 || ty >= size) {
          continue;
        }
        for (let tx = cx - 1; tx <= cx; tx += 1) {
          if (tx < 0 || tx >= size) {
            continue;
          }
          sum += elevation[ty * size + tx] ?? 0;
          count += 1;
        }
      }
      const height = count > 0 ? sum / count : 0;
      corners[cy * side + cx] = height;
      if (height > maxHeight) {
        maxHeight = height;
      }
    }
  }
  return { size, corners, maxHeight };
}

export function cornerHeight(field: HeightField, cx: number, cy: number): number {
  return field.corners[cy * (field.size + 1) + cx] ?? 0;
}

export function sampleHeight(field: HeightField, x: number, y: number): number {
  const size = field.size;
  if (size <= 0 || field.maxHeight === 0) {
    return 0;
  }
  const clampedX = x < 0 ? 0 : x > size ? size : x;
  const clampedY = y < 0 ? 0 : y > size ? size : y;
  const tx = Math.min(size - 1, Math.floor(clampedX));
  const ty = Math.min(size - 1, Math.floor(clampedY));
  const fx = clampedX - tx;
  const fy = clampedY - ty;
  const side = size + 1;
  const base = ty * side + tx;
  const north = field.corners[base];
  const east = field.corners[base + 1];
  const west = field.corners[base + side];
  const south = field.corners[base + side + 1];
  const top = north + (east - north) * fx;
  const bottom = west + (south - west) * fx;
  return top + (bottom - top) * fy;
}

export function projectX(x: number, y: number): number {
  return (x - y) * TILE_HALF_WIDTH;
}

export function projectY(x: number, y: number, height: number): number {
  return (x + y) * TILE_HALF_HEIGHT - height * ELEVATION_HEIGHT;
}

export function projectFlat(world: Vec2): PixelPoint {
  return { x: projectX(world.x, world.y), y: projectY(world.x, world.y, 0) };
}

export function unprojectFlat(px: number, py: number): Vec2 {
  const across = px / TILE_HALF_WIDTH;
  const depth = py / TILE_HALF_HEIGHT;
  return { x: (depth + across) / 2, y: (depth - across) / 2 };
}

export function projectOnField(field: HeightField, world: Vec2): PixelPoint {
  return {
    x: projectX(world.x, world.y),
    y: projectY(world.x, world.y, sampleHeight(field, world.x, world.y)),
  };
}

export function unprojectOnField(field: HeightField, px: number, py: number): Vec2 {
  if (field.maxHeight === 0) {
    return unprojectFlat(px, py);
  }
  const across = px / TILE_HALF_WIDTH;
  const screenDepth = (depth: number): number => {
    const x = (depth + across) / 2;
    const y = (depth - across) / 2;
    return depth * TILE_HALF_HEIGHT - sampleHeight(field, x, y) * ELEVATION_HEIGHT;
  };
  const flatDepth = py / TILE_HALF_HEIGHT;
  let high = flatDepth + (field.maxHeight * ELEVATION_HEIGHT) / TILE_HALF_HEIGHT;
  let low = high;
  while (low > flatDepth) {
    low = Math.max(flatDepth, low - MARCH_STEP);
    if (screenDepth(low) <= py) {
      break;
    }
    high = low;
  }
  for (let i = 0; i < BISECT_STEPS; i += 1) {
    const middle = (low + high) / 2;
    if (screenDepth(middle) <= py) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const depth = (low + high) / 2;
  return { x: (depth + across) / 2, y: (depth - across) / 2 };
}

export function directionIndex(facing: number): number {
  const dx = Math.cos(facing);
  const dy = Math.sin(facing);
  const angle = Math.atan2((dx + dy) * TILE_HALF_HEIGHT, (dx - dy) * TILE_HALF_WIDTH);
  const index = Math.round(angle / (Math.PI / 4));
  return ((index % 8) + 8) % 8;
}

export function directionVector(index: number): PixelPoint {
  const angle = index * (Math.PI / 4);
  return { x: Math.cos(angle), y: Math.sin(angle) * 0.5 };
}

export function mirroredDirection(index: number): number {
  return (12 - index) % 8;
}
