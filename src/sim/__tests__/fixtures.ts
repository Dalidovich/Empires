import { loadGameData } from '../../data';
import type { Command } from '../commands';
import { footprintCenter, spawnEntity } from '../core/entities';
import { invalidateNavGrid } from '../core/navgrid';
import { updateVisibility } from '../core/visibility';
import { createPlayerModifiers } from '../effects';
import { step } from '../engine';
import type { SimEvent } from '../events';
import { createPlayerStats } from '../playerStats';
import { seedRng } from '../rng';
import type { StepContext } from '../system';
import { createStepContext } from '../system';
import type { Entity, GameState, Player, Settings, Stance, TerrainCode } from '../types';
import { GAIA_PLAYER_ID, TERRAIN, TILE_FREE } from '../types';

export const data = loadGameData();

export const baseSettings: Settings = {
  mapType: 'inland',
  mapSize: 'tiny',
  victoryMode: 'conquest',
  populationLimit: 200,
  startingAge: 'stone',
  revealMap: false,
  lockTeams: true,
  speed: 'normal',
};

function createPlayer(id: number, count: number, tiles: number, stance: Stance): Player {
  const diplomacy: Record<string, Stance> = {};
  for (let other = 0; other < count; other++) {
    if (other !== id) {
      diplomacy[other] = stance;
    }
  }
  return {
    id,
    kind: 'human',
    civilization: 'greek',
    team: null,
    color: 0xffffff,
    difficulty: null,
    resources: { food: 0, wood: 0, stone: 0, gold: 0 },
    age: 'stone',
    researched: [],
    diplomacy,
    explored: new Array<number>(tiles).fill(0),
    visible: new Array<number>(tiles).fill(0),
    remembered: {},
    sharedExploration: false,
    population: 0,
    housing: 0,
    modifiers: createPlayerModifiers(),
    aiState: null,
    stats: createPlayerStats(),
    defeated: false,
    resigned: false,
  };
}

export function emptyState(size: number, playerCount = 2, stance: Stance = 'enemy'): GameState {
  const tiles = size * size;
  const players: Player[] = [];
  for (let id = 0; id < playerCount; id++) {
    players.push(createPlayer(id, playerCount, tiles, stance));
  }
  return {
    tick: 0,
    seed: 1,
    rngState: seedRng(1),
    settings: { ...baseSettings },
    map: {
      size,
      terrain: new Array<number>(tiles).fill(TERRAIN.grass),
      elevation: new Array<number>(tiles).fill(0),
      occupancy: new Array<number>(tiles).fill(TILE_FREE),
    },
    players,
    entities: {},
    projectiles: [],
    victoryTimers: [],
    nextEntityId: 1,
    nextProjectileId: 1,
    paused: false,
    outcome: null,
  };
}

export function paint(
  state: GameState,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  terrain: TerrainCode,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      state.map.terrain[y * state.map.size + x] = terrain;
    }
  }
  invalidateNavGrid(state);
}

export function addUnit(state: GameState, type: string, owner: number, x: number, y: number): Entity {
  return spawnEntity(state, { kind: 'unit', type, owner, position: { x, y } }, data);
}

export function addBuilding(
  state: GameState,
  type: string,
  owner: number,
  tileX: number,
  tileY: number,
): Entity {
  const position = footprintCenter({ x: tileX, y: tileY }, data.buildings[type].size);
  return spawnEntity(state, { kind: 'building', type, owner, position }, data);
}

export function addTree(state: GameState, tileX: number, tileY: number): Entity {
  return spawnEntity(
    state,
    {
      kind: 'resource',
      type: 'tree',
      owner: GAIA_PLAYER_ID,
      position: { x: tileX + 0.5, y: tileY + 0.5 },
    },
    data,
  );
}

export function context(): StepContext {
  return createStepContext(data, () => {});
}

export function run(
  state: GameState,
  ctx: StepContext,
  ticks: number,
  commands: readonly Command[] = [],
): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    events.push(...step(state, i === 0 ? commands : [], ctx));
  }
  return events;
}

export function runUntil(
  state: GameState,
  ctx: StepContext,
  limit: number,
  done: () => boolean,
): number {
  let ticks = 0;
  while (ticks < limit && !done()) {
    step(state, [], ctx);
    ticks += 1;
  }
  return ticks;
}

export function refreshFog(state: GameState): void {
  updateVisibility(state, data);
}
