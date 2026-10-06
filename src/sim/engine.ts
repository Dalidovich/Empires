import type { AgeId, GameData, ResourceAmounts } from '../data/types';
import { AGE_ORDER, RESOURCE_KINDS } from '../data/types';
import { generateMap } from '../mapgen';
import type { Command } from './commands';
import { spawnEntity } from './core/entities';
import { invalidateNavGrid } from './core/navgrid';
import { invalidateSpatialIndex } from './core/spatial';
import { updateVisibility } from './core/visibility';
import { createPlayerModifiers } from './effects';
import { grantAllTechnologies } from './effects/apply';
import type { SimEvent } from './events';
import { createPlayerStats } from './playerStats';
import { seedRng } from './rng';
import type { StepContext, System } from './system';
import { animalsSystem } from './systems/animals';
import { autoTargetSystem } from './systems/autoTarget';
import { combatSystem } from './systems/combat';
import { constructionSystem } from './systems/construction';
import { diplomacySystem } from './systems/diplomacy';
import { farmsSystem } from './systems/farms';
import { gatheringSystem } from './systems/gathering';
import { movementSystem } from './systems/movement';
import { ordersSystem } from './systems/orders';
import { populationSystem } from './systems/population';
import { priestsSystem } from './systems/priests';
import { productionSystem } from './systems/production';
import { projectilesSystem } from './systems/projectiles';
import { relicsSystem } from './systems/relics';
import { researchSystem } from './systems/research';
import { scoreSystem } from './systems/score';
import { tradeSystem } from './systems/trade';
import { transportSystem } from './systems/transport';
import { tributeSystem } from './systems/tribute';
import { victorySystem } from './systems/victory';
import { visibilitySystem } from './systems/visibility';
import type { GameState, Player, PlayerSetup, Settings, Stance } from './types';

export const PIPELINE: readonly System[] = [
  ordersSystem,
  diplomacySystem,
  tributeSystem,
  populationSystem,
  productionSystem,
  researchSystem,
  constructionSystem,
  gatheringSystem,
  farmsSystem,
  tradeSystem,
  animalsSystem,
  priestsSystem,
  autoTargetSystem,
  combatSystem,
  projectilesSystem,
  transportSystem,
  movementSystem,
  relicsSystem,
  visibilitySystem,
  victorySystem,
  scoreSystem,
];

function initialStance(self: PlayerSetup, other: PlayerSetup): Stance {
  return self.team !== null && self.team === other.team ? 'ally' : 'enemy';
}

function initialResources(setup: PlayerSetup, settings: Settings, data: GameData): ResourceAmounts {
  const level = data.game.resourceLevels?.[settings.resourceLevel ?? ''];
  const resources: ResourceAmounts = { ...(level ?? data.game.startingResources) };
  if (setup.kind === 'ai' && setup.difficulty !== null) {
    const bonus = data.aiLevels[setup.difficulty].resourceBonus;
    for (const kind of RESOURCE_KINDS) {
      resources[kind] += bonus[kind] ?? 0;
    }
  }
  return resources;
}

function initialAge(settings: Settings): AgeId {
  if (settings.startMode === 'nomad') {
    return AGE_ORDER[0];
  }
  if (settings.startMode === 'post_iron') {
    return AGE_ORDER[AGE_ORDER.length - 1];
  }
  return settings.startingAge;
}

function createPlayer(
  setup: PlayerSetup,
  all: readonly PlayerSetup[],
  settings: Settings,
  tiles: number,
  data: GameData,
): Player {
  const diplomacy: Record<string, Stance> = {};
  for (const other of all) {
    if (other.id !== setup.id) {
      diplomacy[other.id] = initialStance(setup, other);
    }
  }
  const player: Player = {
    id: setup.id,
    kind: setup.kind,
    civilization: setup.civilization,
    team: setup.team,
    color: setup.color,
    difficulty: setup.difficulty,
    resources: initialResources(setup, settings, data),
    age: initialAge(settings),
    researched: [],
    diplomacy,
    explored: new Array<number>(tiles).fill(settings.revealMap ? 1 : 0),
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
  if (settings.fullTechTree === true) {
    player.fullTechTree = true;
  }
  return player;
}

function validatePlayers(players: readonly PlayerSetup[], data: GameData): void {
  players.forEach((player, index) => {
    if (player.id !== index) {
      throw new Error(`Player ids must be contiguous from 0, got ${player.id} at index ${index}`);
    }
    if (!data.civilizations[player.civilization]) {
      throw new Error(`Unknown civilization: ${player.civilization}`);
    }
  });
}

function countInitialPopulation(state: GameState, data: GameData): void {
  for (const entity of Object.values(state.entities)) {
    const player = state.players[entity.owner];
    if (!player) {
      continue;
    }
    if (entity.kind === 'unit') {
      player.population += data.units[entity.type]?.population ?? 0;
    } else if (entity.kind === 'building' && entity.buildProgress === 1) {
      player.housing += data.buildings[entity.type]?.housing ?? 0;
    }
  }
}

export function createGame(
  settings: Settings,
  players: readonly PlayerSetup[],
  data: GameData,
  seed = 0,
): GameState {
  validatePlayers(players, data);
  const generated = generateMap(settings, players, seed, data);
  const tiles = generated.map.size * generated.map.size;
  const state: GameState = {
    tick: 0,
    seed,
    rngState: seedRng(seed),
    settings: { ...settings },
    map: generated.map,
    players: players.map((setup) => createPlayer(setup, players, settings, tiles, data)),
    entities: {},
    projectiles: [],
    victoryTimers: [],
    nextEntityId: 1,
    nextProjectileId: 1,
    paused: false,
    outcome: null,
  };
  for (const spec of generated.entities) {
    spawnEntity(state, spec, data);
  }
  countInitialPopulation(state, data);
  if (settings.startMode === 'post_iron') {
    grantAllTechnologies(state, data);
  }
  updateVisibility(state, data);
  return state;
}

function handleHostCommand(state: GameState, command: Command): boolean {
  if (command.type === 'setSpeed') {
    state.settings.speed = command.speed;
    return true;
  }
  if (command.type === 'pause') {
    state.paused = command.paused;
    return true;
  }
  return false;
}

function dispatchCommand(state: GameState, command: Command, ctx: StepContext): void {
  if (handleHostCommand(state, command)) {
    return;
  }
  if (state.paused || state.outcome !== null) {
    return;
  }
  const player = state.players[command.playerId];
  if (!player || player.defeated) {
    return;
  }
  for (const system of PIPELINE) {
    if (system.handleCommand?.(state, command, ctx)) {
      return;
    }
  }
}

export function step(
  state: GameState,
  commands: readonly Command[],
  ctx: StepContext,
): SimEvent[] {
  invalidateSpatialIndex(state);
  invalidateNavGrid(state);
  const ordered = commands
    .map((command, index) => ({ command, index }))
    .sort((a, b) => a.command.playerId - b.command.playerId || a.index - b.index);
  for (const { command } of ordered) {
    dispatchCommand(state, command, ctx);
  }
  if (state.paused || state.outcome !== null) {
    return ctx.events.splice(0);
  }
  for (const system of PIPELINE) {
    system.update?.(state, ctx);
  }
  state.tick += 1;
  return ctx.events.splice(0);
}
