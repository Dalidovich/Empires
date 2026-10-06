export const DEPTH_LAYER = {
  ground: 0,
  upright: 1,
  air: 2,
} as const;

export type DepthLayer = (typeof DEPTH_LAYER)[keyof typeof DEPTH_LAYER];

export const DEPTH_LAYER_SPAN = 4096;

export interface DepthSortable {
  depth: number;
  order: number;
}

export function depthKey(layer: DepthLayer, x: number, y: number): number {
  return layer * DEPTH_LAYER_SPAN + x + y;
}

export function compareDepth(a: DepthSortable, b: DepthSortable): number {
  return a.depth - b.depth || a.order - b.order;
}
