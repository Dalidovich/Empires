import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../../data';
import { emptyManifest } from '../../shared/assetManifest';
import { compareDepth, DEPTH_LAYER, depthKey } from '../depth';
import { createRenderer } from '../index';
import { MetricsCache } from '../metrics';
import { hitTest, normalizeRect, pickTarget, targetsInRect } from '../picking';
import type { PickTarget } from '../picking';
import { labelLines } from '../placeholders';
import { shadeIndex } from '../terrainGeometry';

function unit(id: number, screenX: number, screenY: number, depth = 0): PickTarget {
  return {
    id,
    priority: 2,
    depth,
    screenX,
    screenY,
    halfWidth: 10,
    height: 30,
    footprintHalfWidth: 0,
    footprintHalfHeight: 0,
    groundFirst: false,
  };
}

function resource(id: number, screenX: number, screenY: number, height: number): PickTarget {
  return {
    id,
    priority: 0,
    depth: screenY,
    screenX,
    screenY,
    halfWidth: 12,
    height,
    footprintHalfWidth: 32,
    footprintHalfHeight: 16,
    groundFirst: true,
  };
}

function building(id: number, screenX: number, screenY: number, depth = 0): PickTarget {
  return {
    id,
    priority: 1,
    depth,
    screenX,
    screenY,
    halfWidth: 60,
    height: 60,
    footprintHalfWidth: 96,
    footprintHalfHeight: 48,
    groundFirst: false,
  };
}

describe('depth ordering', () => {
  it('draws farther objects first', () => {
    const items = [
      { depth: depthKey(DEPTH_LAYER.upright, 10, 10), order: 1 },
      { depth: depthKey(DEPTH_LAYER.upright, 4, 5), order: 2 },
      { depth: depthKey(DEPTH_LAYER.upright, 9, 12), order: 3 },
    ];
    expect(items.sort(compareDepth).map((item) => item.order)).toEqual([2, 1, 3]);
  });

  it('keeps ground decals below and projectiles above everything', () => {
    const items = [
      { depth: depthKey(DEPTH_LAYER.air, 0, 0), order: 1 },
      { depth: depthKey(DEPTH_LAYER.upright, 0, 0), order: 2 },
      { depth: depthKey(DEPTH_LAYER.ground, 399, 399), order: 3 },
    ];
    expect(items.sort(compareDepth).map((item) => item.order)).toEqual([3, 2, 1]);
  });

  it('breaks ties by id', () => {
    const items = [
      { depth: 5, order: 9 },
      { depth: 5, order: 2 },
    ];
    expect(items.sort(compareDepth).map((item) => item.order)).toEqual([2, 9]);
  });
});

describe('hit testing', () => {
  it('hits the upright body above the anchor only', () => {
    const target = unit(1, 100, 100);
    expect(hitTest(target, { x: 100, y: 85 })).toBe(true);
    expect(hitTest(target, { x: 109, y: 71 })).toBe(true);
    expect(hitTest(target, { x: 100, y: 110 })).toBe(false);
    expect(hitTest(target, { x: 120, y: 85 })).toBe(false);
  });

  it('hits the footprint diamond of a building', () => {
    const target = building(1, 200, 200);
    expect(hitTest(target, { x: 200, y: 240 })).toBe(true);
    expect(hitTest(target, { x: 280, y: 205 })).toBe(true);
    expect(hitTest(target, { x: 290, y: 240 })).toBe(false);
  });
});

describe('picking', () => {
  it('returns null when nothing is hit', () => {
    expect(pickTarget([unit(1, 100, 100)], { x: 400, y: 400 })).toBeNull();
  });

  it('prefers units over the building behind them', () => {
    const targets = [building(1, 200, 200, 50), unit(2, 200, 190, 10)];
    expect(pickTarget(targets, { x: 200, y: 180 })).toBe(2);
    expect(pickTarget(targets, { x: 240, y: 200 })).toBe(1);
  });

  it('prefers the front-most of equal targets, then the lower id', () => {
    expect(pickTarget([unit(1, 100, 100, 3), unit(2, 104, 104, 8)], { x: 102, y: 90 })).toBe(2);
    expect(pickTarget([unit(7, 100, 100, 3), unit(4, 100, 100, 3)], { x: 100, y: 90 })).toBe(4);
  });

  it('picks the resource whose tile is clicked over a taller neighbour in front', () => {
    const stone = resource(1, 200, 200, 18);
    const tree = resource(2, 200, 232, 44);
    expect(pickTarget([stone, tree], { x: 200, y: 210 })).toBe(1);
    expect(pickTarget([tree, stone], { x: 205, y: 195 })).toBe(1);
    expect(pickTarget([stone, tree], { x: 200, y: 225 })).toBe(2);
    expect(pickTarget([tree], { x: 200, y: 200 })).toBe(2);
  });

  it('selects everything intersecting a rectangle, in id order', () => {
    const targets = [unit(5, 100, 100), unit(3, 150, 120), unit(4, 400, 400)];
    expect(targetsInRect(targets, { x: 90, y: 60, width: 80, height: 70 })).toEqual([3, 5]);
  });

  it('accepts rectangles dragged in any direction', () => {
    expect(normalizeRect({ x: 170, y: 130, width: -80, height: -70 })).toEqual({
      x: 90,
      y: 60,
      width: 80,
      height: 70,
    });
    const targets = [unit(5, 100, 100), unit(4, 400, 400)];
    expect(targetsInRect(targets, { x: 170, y: 130, width: -80, height: -70 })).toEqual([5]);
  });
});

describe('render helpers', () => {
  it('derives metrics for every unit and building', () => {
    const data = loadGameData();
    const metrics = new MetricsCache(data);
    for (const id of Object.keys(data.units)) {
      expect(metrics.get('unit', id).height).toBeGreaterThan(0);
    }
    for (const [id, def] of Object.entries(data.buildings)) {
      expect(metrics.get('building', id).footprint).toBe(def.size);
    }
    expect(metrics.get('building', 'farm').layer).toBe(DEPTH_LAYER.ground);
    expect(metrics.get('unit', 'unknown_type').pickPriority).toBe(0);
  });

  it('wraps placeholder labels on underscores', () => {
    expect(labelLines('villager')).toEqual(['villager']);
    expect(labelLines('heavy_horse_archer')).toEqual(['heavy', 'horse', 'archer']);
    expect(labelLines('war_galley')).toEqual(['war', 'galley']);
    expect(labelLines('tool_age')).toEqual(['tool_age']);
  });

  it('shades slopes facing the light brighter', () => {
    expect(shadeIndex(0, 0, 0, 0)).toBe(2);
    expect(shadeIndex(0.5, 1, 0.5, 0)).toBeGreaterThan(2);
    expect(shadeIndex(0.5, 0, 0.5, 1)).toBeLessThan(2);
  });
});

describe('createRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports missing WebGL through the result', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const result = await createRenderer({ data: loadGameData(), manifest: emptyManifest() });
    expect(result).toEqual({ ok: false, error: 'webgl_unavailable' });
  });
});
