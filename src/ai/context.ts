import type {
  AiLevelDef,
  Cost,
  GameData,
  GatherKind,
  MapLayout,
  ResourceAmounts,
  ResourceKind,
  UnitDef,
} from '../data/types';
import { RESOURCE_KINDS } from '../data/types';
import type { Command } from '../sim/commands';
import { nextFloat, nextInt } from '../sim/rng';
import type { EntityView, PlayerView } from '../sim/snapshot';
import type { AiDirectiveMode, PlayerId, Vec2 } from '../sim/types';
import { TERRAIN } from '../sim/types';
import type { Counts, Knowledge } from './knowledge';
import { createKnowledge } from './knowledge';
import type { AiParams } from './params';
import type { AiState } from './state';

export interface Grid {
  solid: Uint8Array;
  built: Uint8Array;
}

export interface Regions {
  land: Int32Array;
  water: Int32Array;
  waterSizes: number[];
}

export interface Think {
  view: PlayerView;
  data: GameData;
  level: AiLevelDef;
  params: AiParams;
  state: AiState;
  know: Knowledge;
  tick: number;
  me: PlayerId;
  size: number;
  layout: MapLayout;
  commands: Command[];
  budget: ResourceAmounts;
  cash: ResourceAmounts;
  busy: Set<number>;
  byId: Map<number, EntityView>;
  villagers: EntityView[];
  soldiers: EntityView[];
  priests: EntityView[];
  fishers: EntityView[];
  warships: EntityView[];
  transports: EntityView[];
  buildings: EntityView[];
  foundations: EntityView[];
  complete: Counts;
  total: Counts;
  researching: string[];
  queuedPopulation: number;
  queuedUnits: Counts;
  enemyUnits: EntityView[];
  enemyBuildings: EntityView[];
  sources: Partial<Record<GatherKind, EntityView[]>>;
  animals: EntityView[];
  objects: EntityView[];
  home: Vec2;
  holdTownCenter: boolean;
  plannedBuildings: number;
  woodScarce: boolean | null;
  held: Cost;
  grid: Grid | null;
  regions: Regions | null;
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function unitDef(think: Think, entity: EntityView): UnitDef | undefined {
  return entity.kind === 'unit' ? think.data.units[entity.type] : undefined;
}

export function isHostile(think: Think, owner: PlayerId): boolean {
  if (owner < 0 || owner === think.me) {
    return false;
  }
  const other = think.view.players[owner];
  if (!other || other.defeated) {
    return false;
  }
  return (think.view.self.diplomacy[owner] ?? 'enemy') === 'enemy';
}

export function directiveMode(think: Think): AiDirectiveMode {
  return think.view.players[think.me]?.aiDirective?.mode ?? 'free';
}

export function directedVictim(think: Think): PlayerId | null {
  const directive = think.view.players[think.me]?.aiDirective;
  if (!directive || directive.mode !== 'attack' || directive.victimId === null) {
    return null;
  }
  return think.view.players[directive.victimId]?.defeated === false ? directive.victimId : null;
}

export function isIdle(entity: EntityView): boolean {
  return entity.own !== null && entity.own.orders.length === 0;
}

export function canAfford(think: Think, cost: Cost, useCash = false): boolean {
  const pool = useCash ? think.cash : think.budget;
  for (const kind of RESOURCE_KINDS) {
    if ((cost[kind] ?? 0) > 0 && pool[kind] < (cost[kind] ?? 0)) {
      return false;
    }
  }
  return true;
}

export function spend(think: Think, cost: Cost): void {
  for (const kind of RESOURCE_KINDS) {
    think.budget[kind] -= cost[kind] ?? 0;
    think.cash[kind] -= cost[kind] ?? 0;
  }
}

export function hold(think: Think, cost: Cost): void {
  spend(think, cost);
  think.held = cost;
}

export function release(think: Think): void {
  for (const kind of RESOURCE_KINDS) {
    think.budget[kind] += think.held[kind] ?? 0;
    think.cash[kind] += think.held[kind] ?? 0;
  }
  think.held = {};
}

export function retask(think: Think, unitId: number): void {
  think.busy.add(unitId);
  delete think.state.assigned[unitId];
}

export function reserve(think: Think, cost: Cost): void {
  for (const kind of RESOURCE_KINDS) {
    think.budget[kind] -= cost[kind] ?? 0;
  }
}

export function shortage(think: Think, cost: Cost): Partial<Record<ResourceKind, number>> {
  const missing: Partial<Record<ResourceKind, number>> = {};
  for (const kind of RESOURCE_KINDS) {
    const lack = (cost[kind] ?? 0) - think.view.self.resources[kind];
    if (lack > 0) {
      missing[kind] = lack;
    }
  }
  return missing;
}

export function random(think: Think): number {
  return nextFloat(think.state);
}

export function randomInt(think: Think, min: number, maxExclusive: number): number {
  return nextInt(think.state, min, maxExclusive);
}

export function tileIndexOf(think: Think, position: Vec2): number {
  const x = Math.min(think.size - 1, Math.max(0, Math.floor(position.x)));
  const y = Math.min(think.size - 1, Math.max(0, Math.floor(position.y)));
  return y * think.size + x;
}

export function isExplored(think: Think, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= think.size || y >= think.size) {
    return false;
  }
  return think.view.fog.explored[y * think.size + x] === 1;
}

export function isWaterTerrain(terrain: number): boolean {
  return terrain === TERRAIN.deepWater || terrain === TERRAIN.shallows;
}

export function footprintOf(think: Think, entity: EntityView): number {
  if (entity.kind === 'building') {
    return think.data.buildings[entity.type]?.size ?? 1;
  }
  if (entity.kind === 'object') {
    return think.data.mapObjects[entity.type]?.size ?? 1;
  }
  if (entity.kind === 'resource') {
    return think.data.resourceSources[entity.type]?.size ?? 1;
  }
  return 0;
}

function markFootprint(layer: Uint8Array, size: number, center: Vec2, footprint: number): void {
  const originX = Math.round(center.x - footprint / 2);
  const originY = Math.round(center.y - footprint / 2);
  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      const x = originX + dx;
      const y = originY + dy;
      if (x >= 0 && y >= 0 && x < size && y < size) {
        layer[y * size + x] = 1;
      }
    }
  }
}

export function gridOf(think: Think): Grid {
  if (think.grid) {
    return think.grid;
  }
  const tiles = think.size * think.size;
  const grid: Grid = { solid: new Uint8Array(tiles), built: new Uint8Array(tiles) };
  for (const entity of think.view.entities) {
    if (entity.kind === 'unit') {
      continue;
    }
    const footprint = footprintOf(think, entity);
    markFootprint(grid.solid, think.size, entity.position, footprint);
    if (entity.kind === 'building' && !think.data.buildings[entity.type]?.class.includes('farm')) {
      markFootprint(grid.built, think.size, entity.position, footprint);
    }
  }
  for (const intent of think.state.intents) {
    const footprint = think.data.buildings[intent.building]?.size ?? 1;
    const center = { x: intent.x + footprint / 2, y: intent.y + footprint / 2 };
    markFootprint(grid.solid, think.size, center, footprint);
    markFootprint(grid.built, think.size, center, footprint);
  }
  for (const tile of think.state.badTiles) {
    if (tile >= 0 && tile < tiles) {
      grid.solid[tile] = 1;
    }
  }
  think.grid = grid;
  return grid;
}

export function markIntent(think: Think, building: string, x: number, y: number): void {
  think.state.intents.push({ building, x, y, tick: think.tick });
  const grid = gridOf(think);
  const footprint = think.data.buildings[building]?.size ?? 1;
  const center = { x: x + footprint / 2, y: y + footprint / 2 };
  markFootprint(grid.solid, think.size, center, footprint);
  markFootprint(grid.built, think.size, center, footprint);
}

function label(
  think: Think,
  labels: Int32Array,
  passable: (terrain: number) => boolean,
): number[] {
  const size = think.size;
  const terrain = think.view.map.terrain;
  const explored = think.view.fog.explored;
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (labels[start] !== 0 || explored[start] !== 1 || !passable(terrain[start])) {
      continue;
    }
    const id = sizes.length;
    let count = 0;
    labels[start] = id;
    stack.push(start);
    while (stack.length > 0) {
      const tile = stack.pop() as number;
      count += 1;
      const x = tile % size;
      const y = (tile - x) / size;
      for (let n = 0; n < 4; n++) {
        const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0);
        const ny = y + (n === 2 ? 1 : n === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
          continue;
        }
        const next = ny * size + nx;
        if (labels[next] === 0 && explored[next] === 1 && passable(terrain[next])) {
          labels[next] = id;
          stack.push(next);
        }
      }
    }
    sizes.push(count);
  }
  return sizes;
}

export function regionsOf(think: Think): Regions {
  if (think.regions) {
    return think.regions;
  }
  const tiles = think.size * think.size;
  const land = new Int32Array(tiles);
  const water = new Int32Array(tiles);
  label(think, land, (terrain) => terrain !== TERRAIN.deepWater && terrain !== TERRAIN.cliff);
  const waterSizes = label(think, water, isWaterTerrain);
  think.regions = { land, water, waterSizes };
  return think.regions;
}

export function landRegionAt(think: Think, position: Vec2): number {
  return regionsOf(think).land[tileIndexOf(think, position)];
}

export function sameLand(think: Think, a: Vec2, b: Vec2): boolean {
  const first = landRegionAt(think, a);
  return first !== 0 && first === landRegionAt(think, b);
}

function addSource(think: Think, kind: GatherKind, entity: EntityView): void {
  const list = think.sources[kind];
  if (list) {
    list.push(entity);
  } else {
    think.sources[kind] = [entity];
  }
}

function classifyOwn(think: Think, entity: EntityView): void {
  if (entity.kind === 'building') {
    think.total[entity.type] = (think.total[entity.type] ?? 0) + 1;
    if (entity.buildProgress === 1) {
      think.buildings.push(entity);
      think.complete[entity.type] = (think.complete[entity.type] ?? 0) + 1;
    } else {
      think.foundations.push(entity);
    }
    if (entity.own?.research) {
      think.researching.push(entity.own.research.technology);
    }
    for (const item of entity.own?.queue ?? []) {
      think.queuedPopulation += think.data.units[item.unit]?.population ?? 0;
      think.queuedUnits[item.unit] = (think.queuedUnits[item.unit] ?? 0) + 1;
    }
    return;
  }
  const def = unitDef(think, entity);
  if (!def) {
    return;
  }
  if (def.class.includes('villager')) {
    think.villagers.push(entity);
  } else if (def.class.includes('priest')) {
    think.priests.push(entity);
  } else if (def.class.includes('fishing_ship')) {
    think.fishers.push(entity);
  } else if (def.class.includes('transport_ship')) {
    think.transports.push(entity);
  } else if (def.class.includes('war_ship')) {
    think.warships.push(entity);
  } else if (def.class.includes('military') && def.domain === 'land') {
    think.soldiers.push(entity);
  }
}

function classify(think: Think, entity: EntityView): void {
  think.byId.set(entity.id, entity);
  if (entity.owner === think.me) {
    if (entity.kind === 'object') {
      think.objects.push(entity);
    } else {
      classifyOwn(think, entity);
    }
    return;
  }
  if (entity.kind === 'resource') {
    const source = think.data.resourceSources[entity.type];
    if (source && (entity.amount ?? 0) >= 1) {
      addSource(think, source.gatherKind, entity);
    }
    return;
  }
  if (entity.kind === 'object') {
    think.objects.push(entity);
    return;
  }
  if (entity.kind === 'unit' && think.data.units[entity.type]?.animal) {
    think.animals.push(entity);
    return;
  }
  if (!isHostile(think, entity.owner)) {
    return;
  }
  if (entity.kind === 'unit') {
    think.enemyUnits.push(entity);
  } else if (entity.kind === 'building') {
    think.enemyBuildings.push(entity);
  }
}

function findHome(think: Think): Vec2 {
  const start = think.data.game.start.building;
  let fallback: EntityView | null = null;
  for (const building of think.buildings) {
    if (building.type === start) {
      return { x: building.position.x, y: building.position.y };
    }
    fallback = fallback ?? building;
  }
  if (think.state.home) {
    return think.state.home;
  }
  const anchor = fallback ?? think.villagers[0] ?? think.soldiers[0];
  return anchor
    ? { x: anchor.position.x, y: anchor.position.y }
    : { x: think.size / 2, y: think.size / 2 };
}

export function createThink(
  view: PlayerView,
  data: GameData,
  level: AiLevelDef,
  params: AiParams,
  state: AiState,
): Think {
  const think: Think = {
    view,
    data,
    level,
    params,
    state,
    know: createKnowledge(view, data),
    tick: view.tick,
    me: view.playerId,
    size: view.map.size,
    layout: data.mapTypes[view.settings.mapType]?.layout ?? 'land',
    commands: [],
    budget: { ...view.self.resources },
    cash: { ...view.self.resources },
    busy: new Set(),
    byId: new Map(),
    villagers: [],
    soldiers: [],
    priests: [],
    fishers: [],
    warships: [],
    transports: [],
    buildings: [],
    foundations: [],
    complete: {},
    total: {},
    researching: [],
    queuedPopulation: 0,
    queuedUnits: {},
    enemyUnits: [],
    enemyBuildings: [],
    sources: {},
    animals: [],
    objects: [],
    home: { x: 0, y: 0 },
    holdTownCenter: false,
    plannedBuildings: 0,
    woodScarce: null,
    held: {},
    grid: null,
    regions: null,
  };
  for (const entity of view.entities) {
    classify(think, entity);
  }
  think.home = findHome(think);
  state.home = { x: think.home.x, y: think.home.y };
  return think;
}

export function populationRoom(think: Think): number {
  const self = think.view.self;
  return Math.min(self.housing, self.populationLimit) - self.population - think.queuedPopulation;
}

export function nearest<T extends { position: Vec2 }>(
  items: readonly T[],
  point: Vec2,
  accept?: (item: T) => boolean,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const item of items) {
    if (accept && !accept(item)) {
      continue;
    }
    const d = dist(item.position, point);
    if (d < bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}

export function centroid(items: readonly { position: Vec2 }[]): Vec2 | null {
  if (items.length === 0) {
    return null;
  }
  let x = 0;
  let y = 0;
  for (const item of items) {
    x += item.position.x;
    y += item.position.y;
  }
  return { x: x / items.length, y: y / items.length };
}
