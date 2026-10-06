import type { GameData } from '../../data/types';
import type { Entity, GameMap, TileCoord, Vec2 } from '../types';
import { entityFootprint } from './entities';

export const REACH_SLACK = 0.45;

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(distanceSq(a, b));
}

export function tileOf(position: Vec2): TileCoord {
  return { x: Math.floor(position.x), y: Math.floor(position.y) };
}

export function tileCenter(x: number, y: number): Vec2 {
  return { x: x + 0.5, y: y + 0.5 };
}

export function clampTile(map: GameMap, value: number): number {
  const tile = Math.floor(value);
  if (tile < 0) {
    return 0;
  }
  return tile >= map.size ? map.size - 1 : tile;
}

export function tileIndexAt(map: GameMap, position: Vec2): number {
  return clampTile(map, position.y) * map.size + clampTile(map, position.x);
}

export function elevationAt(map: GameMap, position: Vec2): number {
  return map.elevation[tileIndexAt(map, position)] ?? 0;
}

export function entityRadius(entity: Entity, data: GameData): number {
  if (entity.kind !== 'unit') {
    return 0;
  }
  return data.units[entity.type]?.radius ?? 0;
}

export function distanceToEntity(point: Vec2, target: Entity, data: GameData): number {
  const size = entityFootprint(target, data);
  if (size > 0) {
    const half = size / 2;
    const dx = Math.max(Math.abs(point.x - target.position.x) - half, 0);
    const dy = Math.max(Math.abs(point.y - target.position.y) - half, 0);
    return Math.sqrt(dx * dx + dy * dy);
  }
  return Math.max(distance(point, target.position) - entityRadius(target, data), 0);
}

export function entityDistance(a: Entity, b: Entity, data: GameData): number {
  return Math.max(distanceToEntity(a.position, b, data) - entityRadius(a, data), 0);
}

export function inRange(entity: Entity, target: Entity, range: number, data: GameData): boolean {
  return entityDistance(entity, target, data) <= range + REACH_SLACK;
}
