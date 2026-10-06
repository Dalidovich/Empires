import type { GameData } from '../../data/types';
import type { PlayerView } from '../../sim/snapshot';
import type { TileCoord, Vec2 } from '../../sim/types';
import { TERRAIN } from '../../sim/types';

export function footprintTile(world: Vec2, size: number): TileCoord {
  return {
    x: Math.floor(world.x - size / 2 + 0.5),
    y: Math.floor(world.y - size / 2 + 0.5),
  };
}

function entitySize(data: GameData, kind: string, type: string): number {
  if (kind === 'building') {
    return data.buildings[type]?.size ?? 0;
  }
  if (kind === 'resource') {
    const source = data.resourceSources[type];
    return source && source.blocksMovement ? source.size : 0;
  }
  if (kind === 'object') {
    const object = data.mapObjects[type];
    return object && object.kind === 'ruin' ? object.size : 0;
  }
  return 0;
}

export class Occupancy {
  private source: PlayerView | null = null;
  private tiles = new Set<number>();

  constructor(private readonly data: GameData) {}

  tilesOf(view: PlayerView): ReadonlySet<number> {
    if (this.source === view) {
      return this.tiles;
    }
    const size = view.map.size;
    const tiles = new Set<number>();
    for (const entity of view.entities) {
      const span = entitySize(this.data, entity.kind, entity.type);
      if (span <= 0) {
        continue;
      }
      const origin = footprintTile(entity.position, span);
      for (let dy = 0; dy < span; dy++) {
        for (let dx = 0; dx < span; dx++) {
          tiles.add((origin.y + dy) * size + origin.x + dx);
        }
      }
    }
    this.source = view;
    this.tiles = tiles;
    return tiles;
  }
}

function isWater(terrain: number): boolean {
  return terrain === TERRAIN.shallows || terrain === TERRAIN.deepWater;
}

export function canPlace(
  view: PlayerView,
  data: GameData,
  building: string,
  tile: TileCoord,
  occupied: ReadonlySet<number>,
): boolean {
  const def = data.buildings[building];
  if (!def) {
    return false;
  }
  const size = view.map.size;
  let water = 0;
  let land = 0;
  for (let dy = 0; dy < def.size; dy++) {
    for (let dx = 0; dx < def.size; dx++) {
      const x = tile.x + dx;
      const y = tile.y + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) {
        return false;
      }
      const index = y * size + x;
      if (view.fog.explored[index] === 0 || occupied.has(index)) {
        return false;
      }
      if (view.map.terrain[index] === TERRAIN.cliff) {
        return false;
      }
      if (isWater(view.map.terrain[index])) {
        water += 1;
      } else {
        land += 1;
      }
    }
  }
  return def.placement === 'shore' ? water > 0 && land > 0 : water === 0;
}

export function lineTiles(from: TileCoord, to: TileCoord): TileCoord[] {
  const tiles: TileCoord[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = dx - dy;
  for (;;) {
    tiles.push({ x, y });
    if (x === to.x && y === to.y) {
      return tiles;
    }
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
  }
}

export function canPlaceWall(
  view: PlayerView,
  data: GameData,
  building: string,
  from: TileCoord,
  to: TileCoord,
  occupied: ReadonlySet<number>,
): boolean {
  return lineTiles(from, to).every((tile) => canPlace(view, data, building, tile, occupied));
}
