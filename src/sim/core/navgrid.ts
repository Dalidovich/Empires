import type { GameData, MovementDomain } from '../../data/types';
import type { Entity, GameState, Vec2 } from '../types';
import { TERRAIN, TILE_FREE } from '../types';

export const DOMAINS: readonly MovementDomain[] = ['land', 'water'];

export interface PathField {
  goal: number;
  dist: Int32Array;
  done: Uint8Array;
  heap: number[];
}

export interface NavGrid {
  tick: number;
  size: number;
  land: Uint8Array;
  water: Uint8Array;
  scratchLand: Uint8Array;
  scratchWater: Uint8Array;
  components: Record<MovementDomain, Int32Array | null>;
  fields: Map<number, PathField>;
  resolved: Map<number, number>;
}

const grids = new WeakMap<GameState, NavGrid>();

export function terrainPassable(domain: MovementDomain, terrain: number): boolean {
  if (domain === 'water') {
    return terrain === TERRAIN.deepWater || terrain === TERRAIN.shallows;
  }
  return terrain !== TERRAIN.deepWater && terrain !== TERRAIN.cliff;
}

function isWalkableOccupant(state: GameState, data: GameData, occupant: number): boolean {
  const entity = state.entities[occupant];
  if (!entity || entity.kind !== 'building') {
    return false;
  }
  return data.buildings[entity.type]?.class.includes('farm') ?? false;
}

function fill(state: GameState, data: GameData, land: Uint8Array, water: Uint8Array): void {
  const { terrain, occupancy } = state.map;
  for (let i = 0; i < land.length; i++) {
    const occupant = occupancy[i];
    const open = occupant === TILE_FREE || isWalkableOccupant(state, data, occupant);
    const code = terrain[i];
    land[i] = open && terrainPassable('land', code) ? 1 : 0;
    water[i] = open && terrainPassable('water', code) ? 1 : 0;
  }
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function createGrid(state: GameState, data: GameData): NavGrid {
  const tiles = state.map.size * state.map.size;
  const grid: NavGrid = {
    tick: state.tick,
    size: state.map.size,
    land: new Uint8Array(tiles),
    water: new Uint8Array(tiles),
    scratchLand: new Uint8Array(tiles),
    scratchWater: new Uint8Array(tiles),
    components: { land: null, water: null },
    fields: new Map(),
    resolved: new Map(),
  };
  fill(state, data, grid.land, grid.water);
  return grid;
}

function refresh(state: GameState, data: GameData, grid: NavGrid): void {
  fill(state, data, grid.scratchLand, grid.scratchWater);
  grid.tick = state.tick;
  if (same(grid.land, grid.scratchLand) && same(grid.water, grid.scratchWater)) {
    return;
  }
  const land = grid.land;
  const water = grid.water;
  grid.land = grid.scratchLand;
  grid.water = grid.scratchWater;
  grid.scratchLand = land;
  grid.scratchWater = water;
  grid.components = { land: null, water: null };
  grid.fields.clear();
  grid.resolved.clear();
}

export function getNavGrid(state: GameState, data: GameData): NavGrid {
  let grid = grids.get(state);
  if (!grid || grid.size !== state.map.size) {
    grid = createGrid(state, data);
    grids.set(state, grid);
  } else if (grid.tick !== state.tick) {
    refresh(state, data, grid);
  }
  return grid;
}

export function invalidateNavGrid(state: GameState): void {
  const grid = grids.get(state);
  if (grid) {
    grid.tick = -1;
  }
}

export function passability(grid: NavGrid, domain: MovementDomain): Uint8Array {
  return domain === 'water' ? grid.water : grid.land;
}

export function isPassable(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  x: number,
  y: number,
): boolean {
  const size = state.map.size;
  if (x < 0 || y < 0 || x >= size || y >= size) {
    return false;
  }
  return passability(getNavGrid(state, data), domain)[y * size + x] === 1;
}

export function isPositionPassable(
  state: GameState,
  data: GameData,
  domain: MovementDomain,
  position: Vec2,
): boolean {
  return isPassable(state, data, domain, Math.floor(position.x), Math.floor(position.y));
}

export function domainOf(entity: Entity, data: GameData): MovementDomain {
  if (entity.kind === 'unit') {
    return data.units[entity.type]?.domain ?? 'land';
  }
  return 'land';
}
