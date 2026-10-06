import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';
import type { MapView } from '../sim/snapshot';
import { TERRAIN } from '../sim/types';
import type { TerrainName } from '../sim/types';
import { TERRAIN_SPRITE_ID } from './assets';
import type { SpriteLibrary } from './assets';
import type { HeightField } from './projection';
import { buildChunkGeometry, TERRAIN_SHADES } from './terrainGeometry';
import type { UvRect } from './terrainGeometry';

const CHUNK_SIZE = 16;
const CELL_SIZE = 64;
const ATLAS_COLUMNS = 8;
const UV_INSET = 1;
const CULL_MARGIN = 8;

const TERRAIN_NAMES = Object.keys(TERRAIN) as TerrainName[];

export const TERRAIN_COLORS: Record<TerrainName, string> = {
  grass: '#5d8f3a',
  desert: '#c9ad6a',
  forest: '#3f6b2c',
  shallows: '#4fa3b8',
  deepWater: '#245c8f',
  shore: '#d8c88e',
  cliff: '#6b6358',
};

export function terrainColor(code: number): string {
  const name = TERRAIN_NAMES.find((candidate) => TERRAIN[candidate] === code);
  return name ? TERRAIN_COLORS[name] : '#000000';
}

interface Chunk {
  mesh: Mesh;
  fogMesh: Mesh;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function speckle(context: CanvasRenderingContext2D, name: TerrainName, x: number, y: number): void {
  let seed = (TERRAIN[name] + 1) * 7919;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const water = name === 'shallows' || name === 'deepWater';
  for (let i = 0; i < (water ? 14 : 110); i += 1) {
    const light = random() > 0.5;
    context.fillStyle = light ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)';
    const px = x + random() * (CELL_SIZE - 3);
    const py = y + random() * (CELL_SIZE - 3);
    if (water) {
      context.fillRect(px, py, 6 + random() * 10, 1.5);
    } else if (name === 'forest') {
      context.fillRect(px, py, 3 + random() * 3, 3 + random() * 3);
    } else {
      context.fillRect(px, py, 1 + random() * 2, 1 + random() * 2);
    }
  }
}

function applyShade(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  multiplier: number,
): void {
  if (multiplier < 1) {
    context.fillStyle = `rgba(0, 0, 0, ${1 - multiplier})`;
    context.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  } else if (multiplier > 1) {
    context.fillStyle = `rgba(255, 255, 255, ${(multiplier - 1) * 0.8})`;
    context.fillRect(x, y, CELL_SIZE, CELL_SIZE);
  }
}

function cellOrigin(code: number, shade: number): { x: number; y: number } {
  const index = code * TERRAIN_SHADES.length + shade;
  return {
    x: (index % ATLAS_COLUMNS) * CELL_SIZE,
    y: Math.floor(index / ATLAS_COLUMNS) * CELL_SIZE,
  };
}

export class TerrainLayer {
  readonly container = new Container();
  readonly fogContainer = new Container();
  private readonly atlasCanvas: HTMLCanvasElement;
  private readonly atlasTexture: Texture;
  private readonly fogCanvas: HTMLCanvasElement;
  private fogTexture: Texture | null = null;
  private readonly uvCache: UvRect[] = [];
  private chunks: Chunk[] = [];
  private terrain: number[] = [];
  private elevation: number[] = [];
  private size = 0;

  constructor(library: SpriteLibrary, fogCanvas: HTMLCanvasElement) {
    this.atlasCanvas = document.createElement('canvas');
    const cells = TERRAIN_NAMES.length * TERRAIN_SHADES.length;
    this.atlasCanvas.width = ATLAS_COLUMNS * CELL_SIZE;
    this.atlasCanvas.height = Math.ceil(cells / ATLAS_COLUMNS) * CELL_SIZE;
    this.paintAtlas(library);
    this.atlasTexture = Texture.from(this.atlasCanvas, true);
    this.fogCanvas = fogCanvas;
    for (const name of TERRAIN_NAMES) {
      TERRAIN_SHADES.forEach((_, shade) => {
        const origin = cellOrigin(TERRAIN[name], shade);
        this.uvCache[TERRAIN[name] * TERRAIN_SHADES.length + shade] = {
          u0: (origin.x + UV_INSET) / this.atlasCanvas.width,
          v0: (origin.y + UV_INSET) / this.atlasCanvas.height,
          u1: (origin.x + CELL_SIZE - UV_INSET) / this.atlasCanvas.width,
          v1: (origin.y + CELL_SIZE - UV_INSET) / this.atlasCanvas.height,
        };
      });
    }
  }

  needsRebuild(map: MapView): boolean {
    if (map.size !== this.size) {
      return true;
    }
    const tiles = map.size * map.size;
    for (let i = 0; i < tiles; i += 1) {
      if (map.terrain[i] !== this.terrain[i] || map.elevation[i] !== this.elevation[i]) {
        return true;
      }
    }
    return false;
  }

  rebuild(field: HeightField, map: MapView): void {
    this.clearChunks();
    this.fogTexture?.destroy(true);
    const fogTexture = Texture.from(this.fogCanvas, true);
    this.fogTexture = fogTexture;
    this.size = map.size;
    this.terrain = map.terrain.slice();
    this.elevation = map.elevation.slice();
    const fallback = this.uvCache[0];
    const cellUv = (code: number, shade: number): UvRect =>
      this.uvCache[code * TERRAIN_SHADES.length + shade] ?? fallback;
    for (let y = 0; y < map.size; y += CHUNK_SIZE) {
      for (let x = 0; x < map.size; x += CHUNK_SIZE) {
        const built = buildChunkGeometry(field, map.terrain, x, y, CHUNK_SIZE, cellUv);
        const mesh = new Mesh({
          geometry: new MeshGeometry({
            positions: built.positions,
            uvs: built.uvs,
            indices: built.indices,
          }),
          texture: this.atlasTexture,
        });
        const fogMesh = new Mesh({
          geometry: new MeshGeometry({
            positions: built.positions.slice(),
            uvs: built.fogUvs,
            indices: built.indices.slice(),
          }),
          texture: fogTexture,
        });
        this.container.addChild(mesh);
        this.fogContainer.addChild(fogMesh);
        this.chunks.push({
          mesh,
          fogMesh,
          minX: built.minX,
          minY: built.minY,
          maxX: built.maxX,
          maxY: built.maxY,
        });
      }
    }
  }

  updateFog(): void {
    this.fogTexture?.source.update();
  }

  cull(left: number, top: number, right: number, bottom: number): void {
    for (const chunk of this.chunks) {
      const visible =
        chunk.maxX >= left - CULL_MARGIN &&
        chunk.minX <= right + CULL_MARGIN &&
        chunk.maxY >= top - CULL_MARGIN &&
        chunk.minY <= bottom + CULL_MARGIN;
      if (chunk.mesh.visible !== visible) {
        chunk.mesh.visible = visible;
        chunk.fogMesh.visible = visible;
      }
    }
  }

  destroy(): void {
    this.clearChunks();
    this.atlasTexture.destroy(true);
    this.fogTexture?.destroy(true);
    this.fogTexture = null;
  }

  private clearChunks(): void {
    for (const chunk of this.chunks) {
      const geometries = [chunk.mesh.geometry, chunk.fogMesh.geometry];
      chunk.mesh.destroy();
      chunk.fogMesh.destroy();
      for (const geometry of geometries) {
        geometry.destroy();
      }
    }
    this.chunks = [];
  }

  private paintAtlas(library: SpriteLibrary): void {
    const context = this.atlasCanvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas context is not available');
    }
    for (const name of TERRAIN_NAMES) {
      const texture = library.texture(TERRAIN_SPRITE_ID, name);
      const image = texture?.source.resource as CanvasImageSource | undefined;
      TERRAIN_SHADES.forEach((multiplier, shade) => {
        const origin = cellOrigin(TERRAIN[name], shade);
        if (texture && image) {
          const frame = texture.frame;
          context.drawImage(
            image,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            origin.x,
            origin.y,
            CELL_SIZE,
            CELL_SIZE,
          );
        } else {
          context.fillStyle = TERRAIN_COLORS[name];
          context.fillRect(origin.x, origin.y, CELL_SIZE, CELL_SIZE);
          speckle(context, name, origin.x, origin.y);
        }
        applyShade(context, origin.x, origin.y, multiplier);
      });
    }
  }
}
