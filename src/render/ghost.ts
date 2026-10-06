import type { TileCoord, Vec2 } from '../sim/types';

export function lineTiles(from: TileCoord, to: TileCoord): TileCoord[] {
  const tiles: TileCoord[] = [];
  let x = Math.floor(from.x);
  let y = Math.floor(from.y);
  const endX = Math.floor(to.x);
  const endY = Math.floor(to.y);
  const dx = Math.abs(endX - x);
  const dy = Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  let error = dx - dy;
  for (;;) {
    tiles.push({ x, y });
    if (x === endX && y === endY) {
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

export function footprintCenter(tile: TileCoord, size: number): Vec2 {
  return { x: tile.x + size / 2, y: tile.y + size / 2 };
}
