import { describe, expect, it } from 'vitest';
import { isPositionPassable } from '../core/navgrid';
import {
  findPath,
  formationSlots,
  isReachable,
  nearestPassablePoint,
  nearestReachablePoint,
} from '../core/pathfinding';
import type { GameState, Vec2 } from '../types';
import { TERRAIN } from '../types';
import { addBuilding, addTree, data, emptyState, paint } from './fixtures';

function walkable(state: GameState, domain: 'land' | 'water', from: Vec2, path: Vec2[]): boolean {
  let previous = from;
  for (const point of path) {
    const steps = Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) * 8) + 1;
    for (let i = 0; i <= steps; i++) {
      const sample = {
        x: previous.x + ((point.x - previous.x) * i) / steps,
        y: previous.y + ((point.y - previous.y) * i) / steps,
      };
      if (!isPositionPassable(state, data, domain, sample)) {
        return false;
      }
    }
    previous = point;
  }
  return true;
}

function length(from: Vec2, path: Vec2[]): number {
  let total = 0;
  let previous = from;
  for (const point of path) {
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}

describe('pathfinding', () => {
  it('goes straight across open ground', () => {
    const state = emptyState(32);
    const from = { x: 2.5, y: 2.5 };
    const to = { x: 20.25, y: 11.75 };
    const path = findPath(state, data, 'land', from, to);
    expect(path).toEqual([to]);
  });

  it('walks around a cliff ridge through the only gap', () => {
    const state = emptyState(32);
    paint(state, 15, 0, 15, 24, TERRAIN.cliff);
    paint(state, 15, 26, 15, 31, TERRAIN.cliff);
    const from = { x: 5.5, y: 5.5 };
    const to = { x: 25.5, y: 5.5 };
    const path = findPath(state, data, 'land', from, to);
    expect(path.length).toBeGreaterThan(0);
    expect(walkable(state, 'land', from, path)).toBe(true);
    expect(path.some((point) => point.y > 24)).toBe(true);
    expect(isPositionPassable(state, data, 'land', { x: 15.5, y: 5.5 })).toBe(false);
    expect(isPositionPassable(state, data, 'water', { x: 15.5, y: 5.5 })).toBe(false);
  });

  it('cannot cross a sealed cliff ridge', () => {
    const state = emptyState(32);
    paint(state, 15, 0, 15, 31, TERRAIN.cliff);
    expect(isReachable(state, data, 'land', { x: 5.5, y: 5.5 }, { x: 25.5, y: 5.5 })).toBe(false);
  });

  it('walks around a wall of trees through the only gap', () => {
    const state = emptyState(32);
    for (let y = 0; y < 32; y++) {
      if (y !== 25) {
        addTree(state, 15, y);
      }
    }
    const from = { x: 5.5, y: 5.5 };
    const to = { x: 25.5, y: 5.5 };
    const path = findPath(state, data, 'land', from, to);
    expect(path[path.length - 1]).toEqual(to);
    expect(walkable(state, 'land', from, path)).toBe(true);
    expect(length(from, path)).toBeGreaterThan(44);
    expect(length(from, path)).toBeLessThan(60);
  });

  it('never cuts the corner of a building', () => {
    const state = emptyState(24);
    addBuilding(state, 'town_center', 0, 10, 10);
    const from = { x: 9.5, y: 9.5 };
    const to = { x: 13.5, y: 13.5 };
    const path = findPath(state, data, 'land', from, to);
    expect(path[path.length - 1]).toEqual(to);
    expect(walkable(state, 'land', from, path)).toBe(true);
  });

  it('ends at the nearest reachable point when the target is enclosed', () => {
    const state = emptyState(32);
    for (let i = 18; i <= 22; i++) {
      addTree(state, i, 18);
      addTree(state, i, 22);
      addTree(state, 18, i);
      addTree(state, 22, i);
    }
    const from = { x: 4.5, y: 20.5 };
    const to = { x: 20.5, y: 20.5 };
    expect(isReachable(state, data, 'land', from, to)).toBe(false);
    const path = findPath(state, data, 'land', from, to);
    const end = path[path.length - 1];
    expect(end).toEqual({ x: 17.5, y: 20.5 });
    expect(nearestReachablePoint(state, data, 'land', from, to)).toEqual(end);
    expect(walkable(state, 'land', from, path)).toBe(true);
  });

  it('targets the closest free tile next to a blocked building tile', () => {
    const state = emptyState(24);
    const center = addBuilding(state, 'town_center', 0, 10, 10);
    const from = { x: 2.5, y: 11.5 };
    const path = findPath(state, data, 'land', from, center.position);
    expect(path[path.length - 1]).toEqual({ x: 9.5, y: 11.5 });
  });

  it('keeps land units out of deep water and ships out of land', () => {
    const state = emptyState(32);
    paint(state, 12, 0, 19, 31, TERRAIN.deepWater);
    const landFrom = { x: 5.5, y: 10.5 };
    const landPath = findPath(state, data, 'land', landFrom, { x: 28.5, y: 10.5 });
    expect(landPath[landPath.length - 1]).toEqual({ x: 11.5, y: 10.5 });

    const shipFrom = { x: 13.5, y: 3.5 };
    const shipPath = findPath(state, data, 'water', shipFrom, { x: 18.5, y: 28.5 });
    expect(shipPath[shipPath.length - 1]).toEqual({ x: 18.5, y: 28.5 });
    expect(walkable(state, 'water', shipFrom, shipPath)).toBe(true);

    const beached = findPath(state, data, 'water', shipFrom, { x: 28.5, y: 3.5 });
    expect(beached[beached.length - 1]).toEqual({ x: 19.5, y: 3.5 });
  });

  it('lets both domains cross shallows', () => {
    const state = emptyState(32);
    paint(state, 12, 0, 19, 31, TERRAIN.deepWater);
    paint(state, 12, 15, 19, 16, TERRAIN.shallows);
    const from = { x: 5.5, y: 4.5 };
    const to = { x: 28.5, y: 4.5 };
    const landPath = findPath(state, data, 'land', from, to);
    expect(landPath[landPath.length - 1]).toEqual(to);
    expect(walkable(state, 'land', from, landPath)).toBe(true);

    const shipFrom = { x: 15.5, y: 2.5 };
    const shipTo = { x: 15.5, y: 29.5 };
    const shipPath = findPath(state, data, 'water', shipFrom, shipTo);
    expect(shipPath[shipPath.length - 1]).toEqual(shipTo);
  });

  it('treats farms as walkable and other buildings as blocking', () => {
    const state = emptyState(24);
    const farm = addBuilding(state, 'farm', 0, 4, 4);
    const house = addBuilding(state, 'house', 0, 12, 12);
    expect(isPositionPassable(state, data, 'land', farm.position)).toBe(true);
    expect(isPositionPassable(state, data, 'land', house.position)).toBe(false);
    expect(nearestPassablePoint(state, data, 'land', { x: 12.5, y: 12.5 })).not.toBeNull();
  });

  it('follows occupancy changes', () => {
    const state = emptyState(16);
    const from = { x: 2.5, y: 8.5 };
    const to = { x: 13.5, y: 8.5 };
    expect(findPath(state, data, 'land', from, to)).toEqual([to]);
    for (let y = 0; y < 16; y++) {
      addTree(state, 8, y);
    }
    const blocked = findPath(state, data, 'land', from, to);
    expect(blocked[blocked.length - 1]).toEqual({ x: 7.5, y: 8.5 });
  });

  it('hands out distinct formation slots around the target', () => {
    const state = emptyState(32);
    const slots = formationSlots(state, data, 'land', { x: 3.5, y: 3.5 }, { x: 16.2, y: 16.7 }, 25);
    expect(slots).toHaveLength(25);
    expect(slots[0]).toEqual({ x: 16.2, y: 16.7 });
    const tiles = new Set(slots.map((slot) => `${Math.floor(slot.x)}:${Math.floor(slot.y)}`));
    expect(tiles.size).toBe(25);
    for (const slot of slots) {
      expect(Math.hypot(slot.x - 16.5, slot.y - 16.5)).toBeLessThan(6);
    }
  });
});
