import { cornerHeight, projectX, projectY } from './projection';
import type { HeightField } from './projection';

export const TERRAIN_SHADES = [0.62, 0.8, 1, 1.12, 1.25] as const;
export const NEUTRAL_SHADE = 2;

export interface UvRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface ChunkGeometry {
  positions: Float32Array;
  uvs: Float32Array;
  fogUvs: Float32Array;
  indices: Uint32Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function shadeIndex(north: number, east: number, south: number, west: number): number {
  const light = east - west + 0.5 * (north - south);
  const index = Math.round(NEUTRAL_SHADE + 1.5 * light);
  return Math.max(0, Math.min(TERRAIN_SHADES.length - 1, index));
}

export function buildChunkGeometry(
  field: HeightField,
  terrain: ArrayLike<number>,
  originX: number,
  originY: number,
  chunkSize: number,
  cellUv: (terrain: number, shade: number) => UvRect,
): ChunkGeometry {
  const size = field.size;
  const endX = Math.min(size, originX + chunkSize);
  const endY = Math.min(size, originY + chunkSize);
  const tiles = Math.max(0, endX - originX) * Math.max(0, endY - originY);
  const positions = new Float32Array(tiles * 8);
  const uvs = new Float32Array(tiles * 8);
  const fogUvs = new Float32Array(tiles * 8);
  const indices = new Uint32Array(tiles * 6);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let tile = 0;
  for (let y = originY; y < endY; y += 1) {
    for (let x = originX; x < endX; x += 1) {
      const north = cornerHeight(field, x, y);
      const east = cornerHeight(field, x + 1, y);
      const south = cornerHeight(field, x + 1, y + 1);
      const west = cornerHeight(field, x, y + 1);
      const uv = cellUv(terrain[y * size + x] ?? 0, shadeIndex(north, east, south, west));
      const offset = tile * 8;
      const corners: [number, number, number, number, number][] = [
        [x, y, north, uv.u0, uv.v0],
        [x + 1, y, east, uv.u1, uv.v0],
        [x + 1, y + 1, south, uv.u1, uv.v1],
        [x, y + 1, west, uv.u0, uv.v1],
      ];
      corners.forEach(([cx, cy, height, u, v], corner) => {
        const px = projectX(cx, cy);
        const py = projectY(cx, cy, height);
        const at = offset + corner * 2;
        positions[at] = px;
        positions[at + 1] = py;
        uvs[at] = u;
        uvs[at + 1] = v;
        fogUvs[at] = cx / size;
        fogUvs[at + 1] = cy / size;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      });
      const vertex = tile * 4;
      const index = tile * 6;
      indices[index] = vertex;
      indices[index + 1] = vertex + 1;
      indices[index + 2] = vertex + 2;
      indices[index + 3] = vertex;
      indices[index + 4] = vertex + 2;
      indices[index + 5] = vertex + 3;
      tile += 1;
    }
  }
  return { positions, uvs, fogUvs, indices, minX, minY, maxX, maxY };
}
