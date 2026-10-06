import type { Vec2 } from '../sim/types';
import type { ScreenPoint } from './api';

export const MINIMAP_WIDTH = 256;
export const MINIMAP_HEIGHT = 128;

export interface MinimapLayout {
  width: number;
  height: number;
  mapSize: number;
}

export function minimapScale(layout: MinimapLayout): number {
  return layout.mapSize > 0 ? layout.width / (2 * layout.mapSize) : 1;
}

export function worldToMinimap(layout: MinimapLayout, world: Vec2): ScreenPoint {
  const scaleX = minimapScale(layout);
  const scaleY = layout.mapSize > 0 ? layout.height / (2 * layout.mapSize) : 1;
  return {
    x: (world.x - world.y) * scaleX + layout.width / 2,
    y: (world.x + world.y) * scaleY,
  };
}

export function minimapToWorld(layout: MinimapLayout, point: ScreenPoint): Vec2 {
  const size = layout.mapSize;
  if (size <= 0) {
    return { x: 0, y: 0 };
  }
  const across = (point.x - layout.width / 2) / (layout.width / (2 * size));
  const depth = point.y / (layout.height / (2 * size));
  const clamp = (value: number): number => (value < 0 ? 0 : value > size ? size : value);
  return { x: clamp((depth + across) / 2), y: clamp((depth - across) / 2) };
}
