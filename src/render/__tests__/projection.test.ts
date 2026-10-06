import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, ViewTransform } from '../camera';
import { lineTiles } from '../ghost';
import { minimapToWorld, worldToMinimap } from '../minimapLayout';
import type { MinimapLayout } from '../minimapLayout';
import {
  buildHeightField,
  directionIndex,
  DIRECTIONS,
  ELEVATION_HEIGHT,
  flatHeightField,
  mirroredDirection,
  projectFlat,
  projectOnField,
  sampleHeight,
  TILE_HALF_HEIGHT,
  TILE_HALF_WIDTH,
  unprojectFlat,
  unprojectOnField,
} from '../projection';

const SIZE = 16;

function hillElevation(): number[] {
  const elevation = new Array<number>(SIZE * SIZE).fill(0);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const distance = Math.max(Math.abs(x - 8), Math.abs(y - 8));
      elevation[y * SIZE + x] = Math.max(0, 4 - distance);
    }
  }
  return elevation;
}

describe('flat projection', () => {
  it('maps tile axes to the isometric diamond', () => {
    expect(projectFlat({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(projectFlat({ x: 1, y: 0 })).toEqual({ x: TILE_HALF_WIDTH, y: TILE_HALF_HEIGHT });
    expect(projectFlat({ x: 0, y: 1 })).toEqual({ x: -TILE_HALF_WIDTH, y: TILE_HALF_HEIGHT });
  });

  it('inverts exactly', () => {
    const world = { x: 12.25, y: 3.5 };
    const pixel = projectFlat(world);
    const back = unprojectFlat(pixel.x, pixel.y);
    expect(back.x).toBeCloseTo(world.x, 9);
    expect(back.y).toBeCloseTo(world.y, 9);
  });
});

describe('height field', () => {
  it('averages tile elevations at corners and interpolates between them', () => {
    const field = buildHeightField(2, [0, 0, 0, 4]);
    expect(sampleHeight(field, 0, 0)).toBe(0);
    expect(sampleHeight(field, 1, 1)).toBe(1);
    expect(sampleHeight(field, 2, 2)).toBe(4);
    expect(sampleHeight(field, 1.5, 1.5)).toBeCloseTo((1 + 2 + 2 + 4) / 4, 6);
    expect(field.maxHeight).toBe(4);
  });

  it('clamps samples outside the map', () => {
    const field = buildHeightField(2, [3, 3, 3, 3]);
    expect(sampleHeight(field, -5, 10)).toBe(3);
  });

  it('raises projected points by the elevation', () => {
    const field = buildHeightField(2, [2, 2, 2, 2]);
    const flat = projectFlat({ x: 1, y: 1 });
    const raised = projectOnField(field, { x: 1, y: 1 });
    expect(raised.x).toBe(flat.x);
    expect(raised.y).toBe(flat.y - 2 * ELEVATION_HEIGHT);
  });

  it('round-trips through elevated terrain', () => {
    const field = buildHeightField(SIZE, hillElevation());
    for (const world of [
      { x: 8.5, y: 8.5 },
      { x: 6.2, y: 9.7 },
      { x: 10.4, y: 5.1 },
      { x: 2.5, y: 13.5 },
    ]) {
      const pixel = projectOnField(field, world);
      const back = unprojectOnField(field, pixel.x, pixel.y);
      expect(back.x).toBeCloseTo(world.x, 2);
      expect(back.y).toBeCloseTo(world.y, 2);
    }
  });

  it('matches the flat inverse on a flat field', () => {
    const field = flatHeightField(SIZE);
    const back = unprojectOnField(field, 40, 100);
    expect(back).toEqual(unprojectFlat(40, 100));
  });
});

describe('directions', () => {
  it('converts world facing to screen directions', () => {
    expect(DIRECTIONS[directionIndex(Math.atan2(1, 1))]).toBe('s');
    expect(DIRECTIONS[directionIndex(Math.atan2(-1, -1))]).toBe('n');
    expect(DIRECTIONS[directionIndex(Math.atan2(-1, 1))]).toBe('e');
    expect(DIRECTIONS[directionIndex(Math.atan2(1, -1))]).toBe('w');
    expect(DIRECTIONS[directionIndex(0)]).toBe('se');
    expect(DIRECTIONS[directionIndex(Math.PI)]).toBe('nw');
  });

  it('mirrors horizontally', () => {
    const mirrored = DIRECTIONS.map((_, index) => DIRECTIONS[mirroredDirection(index)]);
    expect(mirrored).toEqual(['w', 'sw', 's', 'se', 'e', 'ne', 'n', 'nw']);
  });
});

describe('view transform', () => {
  function elevated(): ViewTransform {
    const transform = new ViewTransform();
    transform.setHeightField(buildHeightField(SIZE, hillElevation()));
    transform.setViewport(1280, 720);
    return transform;
  }

  it('puts the centred world point in the middle of the viewport', () => {
    const transform = elevated();
    transform.centerOn({ x: 8.5, y: 8.5 });
    const screen = transform.worldToScreen({ x: 8.5, y: 8.5 });
    expect(screen.x).toBeCloseTo(640, 6);
    expect(screen.y).toBeCloseTo(360, 6);
  });

  it('round-trips screen and world coordinates with zoom and elevation', () => {
    const transform = elevated();
    transform.setCamera({ x: 7, y: 9, zoom: 1.5 });
    const world = { x: 6.25, y: 8.75 };
    const back = transform.screenToWorld(transform.worldToScreen(world));
    expect(back.x).toBeCloseTo(world.x, 2);
    expect(back.y).toBeCloseTo(world.y, 2);
  });

  it('pans by screen pixels', () => {
    const transform = elevated();
    transform.setCamera({ x: 8, y: 8, zoom: 2 });
    const before = transform.worldToScreen({ x: 2, y: 2 });
    transform.pan(64, 32);
    const after = transform.worldToScreen({ x: 2, y: 2 });
    expect(after.x).toBeCloseTo(before.x - 64, 6);
    expect(after.y).toBeCloseTo(before.y - 32, 6);
  });

  it('clamps the camera to the map and the zoom range', () => {
    const transform = elevated();
    transform.setCamera({ x: -10, y: 999, zoom: 100 });
    expect(transform.getCamera()).toEqual({ x: 0, y: SIZE, zoom: MAX_ZOOM });
    transform.setCamera({ x: 4, y: 4, zoom: 0 });
    expect(transform.getCamera().zoom).toBe(MIN_ZOOM);
  });
});

describe('minimap layout', () => {
  const layout: MinimapLayout = { width: 256, height: 128, mapSize: 200 };

  it('places the map corners on the diamond', () => {
    expect(worldToMinimap(layout, { x: 0, y: 0 })).toEqual({ x: 128, y: 0 });
    expect(worldToMinimap(layout, { x: 200, y: 200 })).toEqual({ x: 128, y: 128 });
    expect(worldToMinimap(layout, { x: 200, y: 0 })).toEqual({ x: 256, y: 64 });
    expect(worldToMinimap(layout, { x: 0, y: 200 })).toEqual({ x: 0, y: 64 });
  });

  it('round-trips and clamps', () => {
    const world = { x: 37.5, y: 151.25 };
    const back = minimapToWorld(layout, worldToMinimap(layout, world));
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
    expect(minimapToWorld(layout, { x: 0, y: 0 })).toEqual({ x: 0, y: 100 });
  });
});

describe('wall line', () => {
  it('covers both ends and stays contiguous', () => {
    const tiles = lineTiles({ x: 2, y: 3 }, { x: 7, y: 5 });
    expect(tiles[0]).toEqual({ x: 2, y: 3 });
    expect(tiles[tiles.length - 1]).toEqual({ x: 7, y: 5 });
    for (let i = 1; i < tiles.length; i += 1) {
      expect(Math.abs(tiles[i].x - tiles[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(tiles[i].y - tiles[i - 1].y)).toBeLessThanOrEqual(1);
    }
    expect(lineTiles({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
  });
});
