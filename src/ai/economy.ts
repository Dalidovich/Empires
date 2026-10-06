import type { GatherKind, ResourceKind } from '../data/types';
import { RESOURCE_KINDS } from '../data/types';
import type { EntityView } from '../sim/snapshot';
import type { Vec2 } from '../sim/types';
import type { Think } from './context';
import {
  canAfford,
  dist,
  isIdle,
  populationRoom,
  retask,
  sameLand,
  spend,
} from './context';
import { buildingAvailable, buildingStats, nextAgeTechnology, unitStats } from './knowledge';
import { findLandSite, placeBuilding } from './placement';
import { enemyGuess } from './scouting';

const AGE_VILLAGER_SHARE: readonly number[] = [0.55, 0.75, 0.9, 1];
const MIN_VILLAGERS = 6;
const BASE_WEIGHTS: readonly Record<ResourceKind, number>[] = [
  { food: 0.65, wood: 0.35, stone: 0, gold: 0 },
  { food: 0.5, wood: 0.35, stone: 0, gold: 0.15 },
  { food: 0.45, wood: 0.25, stone: 0, gold: 0.3 },
  { food: 0.4, wood: 0.25, stone: 0, gold: 0.35 },
];
const STOCK_TARGETS: readonly Record<ResourceKind, number>[] = [
  { food: 600, wood: 250, stone: 300, gold: 100 },
  { food: 900, wood: 400, stone: 300, gold: 200 },
  { food: 1100, wood: 450, stone: 300, gold: 900 },
  { food: 800, wood: 500, stone: 1000, gold: 800 },
];
const STOCK_PIVOT = 1.6;
const MIN_STOCK_FACTOR = 0.25;
const WONDER_STONE_WEIGHT = 0.25;
const MAX_SOURCE_DISTANCE = 32;
const DROP_OFF_REACH = 7;
const FAR_DROP_OFF_PENALTY = 30;
const CROWD_PENALTY = 2.5;
const QUICK_IDLE_TICKS = 160;
const MAX_BAD_TARGETS = 200;
const STALE_FOUNDATION_TICKS = 2400;
const PREDATOR_RADIUS = 5;
const PREDATOR_HUNTERS = 3;
const HOUSE_RADIUS = 16;
const BUILDING_GAP = 1;
const FARM_RADIUS = 9;
const DROP_OFF_SITE_RADIUS = 6;
const MIN_CLUSTER_FOR_DROP_OFF = 3;
const CLUSTER_RADIUS = 4;
const REBALANCE_THRESHOLD = 1.5;
const SCARCE_WOOD = 3000;
const OWN_SIDE_RATIO = 0.9;
const PROSPECT_RADII: readonly number[] = [10, 16, 22];
const PROSPECT_DIRECTIONS = 8;
const PROSPECT_FOOD = 300;
const PROSPECT_TIMEOUT_TICKS = 600;
const SCARCE_FARM_BUFFER = 250;

const FOOD_KINDS: readonly GatherKind[] = ['forage', 'shore_fish'];
const FALLBACK_ORDER: readonly ResourceKind[] = ['wood', 'gold', 'stone', 'food'];
const RESOURCE_GATHER_KIND: Record<Exclude<ResourceKind, 'food'>, GatherKind> = {
  wood: 'wood',
  stone: 'stone',
  gold: 'gold',
};

interface Task {
  resource: ResourceKind | null;
  targetId: number | null;
  building: boolean;
}

interface Workforce {
  current: Record<ResourceKind, number>;
  desired: Record<ResourceKind, number>;
  crowd: Map<number, number>;
  gatherers: Map<ResourceKind, EntityView[]>;
  idle: EntityView[];
}

export function villagerLimit(think: Think): number {
  return Math.min(
    think.level.maxVillagers,
    Math.floor(think.view.self.populationLimit * think.params.villagerShare),
  );
}

export function ageVillagerTarget(think: Think): number {
  const share = AGE_VILLAGER_SHARE[think.know.age] ?? 1;
  return Math.max(MIN_VILLAGERS, Math.ceil(villagerLimit(think) * share));
}

function resourceOfTarget(think: Think, targetId: number): ResourceKind | null {
  const target = think.byId.get(targetId);
  if (!target) {
    return null;
  }
  if (target.kind === 'resource') {
    return think.data.resourceSources[target.type]?.resource ?? null;
  }
  if (target.kind === 'building' || think.data.units[target.type]?.animal) {
    return 'food';
  }
  return null;
}

function taskOf(think: Think, villager: EntityView): Task {
  const orders = villager.own?.orders ?? [];
  let building = false;
  for (const order of orders) {
    if (order.type === 'build' || order.type === 'repair') {
      building = true;
    }
    if (order.type === 'gather') {
      const resource =
        resourceOfTarget(think, order.targetId) ?? villager.own?.carry?.resource ?? null;
      return { resource, targetId: order.targetId, building };
    }
  }
  return { resource: null, targetId: null, building };
}

function gatherWeights(think: Think): Record<ResourceKind, number> {
  const age = think.know.age;
  const weights = { ...(BASE_WEIGHTS[age] ?? BASE_WEIGHTS[0]) };
  const stock = think.view.self.resources;
  if (
    think.view.settings.victoryMode === 'standard' &&
    think.params.wonder > 0 &&
    nextAgeTechnology(think.know) === null
  ) {
    weights.stone = WONDER_STONE_WEIGHT;
  }
  const targets = STOCK_TARGETS[age] ?? STOCK_TARGETS[0];
  for (const kind of RESOURCE_KINDS) {
    const factor = STOCK_PIVOT - stock[kind] / targets[kind];
    weights[kind] *= Math.min(STOCK_PIVOT, Math.max(MIN_STOCK_FACTOR, factor));
  }
  const total = weights.food + weights.wood + weights.stone + weights.gold;
  for (const kind of RESOURCE_KINDS) {
    weights[kind] = total > 0 ? weights[kind] / total : 0;
  }
  return weights;
}

function dropOffDistance(think: Think, kind: GatherKind, point: Vec2): number {
  let best = Infinity;
  for (const building of think.buildings) {
    const stats = buildingStats(think.know, building.type);
    if (!stats || !stats.dropOff.includes(kind)) {
      continue;
    }
    best = Math.min(best, Math.max(0, dist(building.position, point) - stats.size / 2));
  }
  return best;
}

function sourceUsable(think: Think, source: EntityView): boolean {
  return (
    !think.state.badTargets.includes(source.id) &&
    dist(source.position, think.home) <= MAX_SOURCE_DISTANCE &&
    dist(source.position, think.home) <= dist(source.position, enemyGuess(think)) * OWN_SIDE_RATIO &&
    (think.layout === 'land' ||
      think.data.resourceSources[source.type]?.domain === 'water' ||
      sameLand(think, source.position, think.home))
  );
}

export function isWoodScarce(think: Think): boolean {
  if (think.woodScarce === null && think.layout !== 'islands') {
    think.woodScarce = false;
  }
  if (think.woodScarce === null) {
    let wood = think.view.self.resources.wood;
    for (const tree of think.sources.wood ?? []) {
      if (wood >= SCARCE_WOOD) {
        break;
      }
      if (sourceUsable(think, tree)) {
        wood += tree.amount ?? 0;
      }
    }
    think.woodScarce = wood < SCARCE_WOOD;
  }
  return think.woodScarce;
}

function pickSource(
  think: Think,
  villager: EntityView,
  kinds: readonly GatherKind[],
  crowd: Map<number, number>,
): EntityView | null {
  let best: EntityView | null = null;
  let bestScore = Infinity;
  for (const kind of kinds) {
    for (const source of think.sources[kind] ?? []) {
      const travel = dist(source.position, villager.position);
      if (travel + CROWD_PENALTY * (crowd.get(source.id) ?? 0) >= bestScore) {
        continue;
      }
      if (!sourceUsable(think, source)) {
        continue;
      }
      const haul = dropOffDistance(think, kind, source.position);
      const score =
        travel +
        haul * 2 +
        (haul > DROP_OFF_REACH ? FAR_DROP_OFF_PENALTY : 0) +
        CROWD_PENALTY * (crowd.get(source.id) ?? 0);
      if (score < bestScore) {
        best = source;
        bestScore = score;
      }
    }
  }
  return best;
}

function isFarm(think: Think, building: EntityView): boolean {
  return think.data.buildings[building.type]?.class.includes('farm') ?? false;
}

function freeFarm(think: Think, villager: EntityView, crowd: Map<number, number>): EntityView | null {
  let best: EntityView | null = null;
  let bestDistance = Infinity;
  for (const building of think.buildings) {
    if (!isFarm(think, building) || (crowd.get(building.id) ?? 0) > 0) {
      continue;
    }
    const d = dist(building.position, villager.position);
    if (d < bestDistance) {
      best = building;
      bestDistance = d;
    }
  }
  return best;
}

function farmAnchor(think: Think, villager: EntityView): Vec2 {
  let best: Vec2 = think.home;
  let bestDistance = Infinity;
  for (const building of think.buildings) {
    const stats = buildingStats(think.know, building.type);
    if (!stats || !stats.dropOff.includes('farm')) {
      continue;
    }
    const d = dist(building.position, villager.position) + dist(building.position, think.home);
    if (d < bestDistance) {
      best = building.position;
      bestDistance = d;
    }
  }
  return best;
}

function gather(think: Think, villager: EntityView, target: EntityView, work: Workforce): void {
  think.commands.push({
    type: 'gather',
    playerId: think.me,
    entityIds: [villager.id],
    targetId: target.id,
    queued: false,
  });
  think.busy.add(villager.id);
  think.state.assigned[villager.id] = { targetId: target.id, tick: think.tick };
  work.crowd.set(target.id, (work.crowd.get(target.id) ?? 0) + 1);
}

function assignFood(think: Think, villager: EntityView, work: Workforce): boolean {
  const natural = pickSource(think, villager, FOOD_KINDS, work.crowd);
  if (natural && dropOffDistance(think, sourceKind(think, natural), natural.position) <= DROP_OFF_REACH * 2) {
    gather(think, villager, natural, work);
    return true;
  }
  const farm = freeFarm(think, villager, work.crowd);
  if (farm) {
    gather(think, villager, farm, work);
    return true;
  }
  if (buildingAvailable(think.know, 'farm', think.complete, think.total)) {
    const stats = buildingStats(think.know, 'farm');
    const buffer = isWoodScarce(think) ? SCARCE_FARM_BUFFER : 0;
    if (stats && canAfford(think, stats.cost) && think.budget.wood >= (stats.cost.wood ?? 0) + buffer) {
      const site = findLandSite(think, 'farm', {
        anchor: farmAnchor(think, villager),
        minRadius: 2,
        maxRadius: FARM_RADIUS,
        gap: 0,
        maxSolidRing: 99,
      });
      if (site && placeBuilding(think, 'farm', site, 1, [villager])) {
        return true;
      }
    }
    return false;
  }
  if (natural) {
    gather(think, villager, natural, work);
    return true;
  }
  return false;
}

function sourceKind(think: Think, source: EntityView): GatherKind {
  return think.data.resourceSources[source.type]?.gatherKind ?? 'forage';
}

function assign(think: Think, villager: EntityView, resource: ResourceKind, work: Workforce): boolean {
  if (resource === 'food') {
    return assignFood(think, villager, work);
  }
  const source = pickSource(think, villager, [RESOURCE_GATHER_KIND[resource]], work.crowd);
  if (!source) {
    return false;
  }
  gather(think, villager, source, work);
  return true;
}

function surveyWorkforce(think: Think): Workforce {
  const work: Workforce = {
    current: { food: 0, wood: 0, stone: 0, gold: 0 },
    desired: { food: 0, wood: 0, stone: 0, gold: 0 },
    crowd: new Map(),
    gatherers: new Map(),
    idle: [],
  };
  let workers = 0;
  for (const villager of think.villagers) {
    const task = taskOf(think, villager);
    if (task.targetId !== null) {
      work.crowd.set(task.targetId, (work.crowd.get(task.targetId) ?? 0) + 1);
    }
    const order = villager.own?.orders[0];
    if (order && (order.type === 'build' || order.type === 'repair')) {
      work.crowd.set(order.targetId, (work.crowd.get(order.targetId) ?? 0) + 1);
    }
    if (think.busy.has(villager.id) || villager.id === think.state.scout.unitId) {
      continue;
    }
    if (task.building) {
      continue;
    }
    workers += 1;
    if (task.resource !== null) {
      work.current[task.resource] += 1;
      const list = work.gatherers.get(task.resource);
      if (list) {
        list.push(villager);
      } else {
        work.gatherers.set(task.resource, [villager]);
      }
    } else if (isIdle(villager)) {
      work.idle.push(villager);
    }
  }
  const weights = gatherWeights(think);
  for (const kind of RESOURCE_KINDS) {
    work.desired[kind] = weights[kind] * workers;
  }
  return work;
}

function neediest(work: Workforce, excluded: readonly ResourceKind[]): ResourceKind | null {
  let best: ResourceKind | null = null;
  let bestGap = -Infinity;
  for (const kind of RESOURCE_KINDS) {
    if (excluded.includes(kind) || work.desired[kind] <= 0) {
      continue;
    }
    const gap = work.desired[kind] - work.current[kind];
    if (gap > bestGap) {
      best = kind;
      bestGap = gap;
    }
  }
  return best;
}

function assignIdle(think: Think, work: Workforce): void {
  for (const villager of work.idle) {
    const tried: ResourceKind[] = [];
    let resource = neediest(work, tried);
    while (resource !== null) {
      if (assign(think, villager, resource, work)) {
        work.current[resource] += 1;
        break;
      }
      tried.push(resource);
      resource = neediest(work, tried) ?? FALLBACK_ORDER.find((kind) => !tried.includes(kind)) ?? null;
    }
  }
}

function rebalance(think: Think, work: Workforce): void {
  let over: ResourceKind | null = null;
  let overGap = REBALANCE_THRESHOLD;
  let under: ResourceKind | null = null;
  let underGap = REBALANCE_THRESHOLD;
  for (const kind of RESOURCE_KINDS) {
    const gap = work.current[kind] - work.desired[kind];
    if (gap >= overGap) {
      over = kind;
      overGap = gap;
    }
    if (-gap >= underGap) {
      under = kind;
      underGap = -gap;
    }
  }
  if (over === null || under === null) {
    return;
  }
  const candidates = (work.gatherers.get(over) ?? []).filter(
    (villager) => !think.busy.has(villager.id),
  );
  let chosen: EntityView | null = null;
  let lightest = Infinity;
  for (const villager of candidates) {
    const load = villager.own?.carry?.amount ?? 0;
    if (load < lightest) {
      chosen = villager;
      lightest = load;
    }
  }
  if (chosen && assign(think, chosen, under, work)) {
    work.current[over] -= 1;
    work.current[under] += 1;
  }
}

function reviewAssignments(think: Think): void {
  const alive = new Set([...think.villagers, ...think.fishers].map((unit) => unit.id));
  for (const key of Object.keys(think.state.assigned)) {
    const entry = think.state.assigned[key];
    const id = Number(key);
    const villager = think.byId.get(id);
    if (!alive.has(id) || !villager) {
      delete think.state.assigned[key];
      continue;
    }
    if (!isIdle(villager)) {
      if (think.tick - entry.tick > QUICK_IDLE_TICKS) {
        delete think.state.assigned[key];
      }
      continue;
    }
    const target = think.byId.get(entry.targetId);
    if (
      target &&
      target.kind === 'resource' &&
      think.tick - entry.tick <= QUICK_IDLE_TICKS &&
      !think.state.badTargets.includes(target.id)
    ) {
      think.state.badTargets.push(target.id);
      if (think.state.badTargets.length > MAX_BAD_TARGETS) {
        think.state.badTargets.shift();
      }
    }
    delete think.state.assigned[key];
  }
}

function naturalFood(think: Think): number {
  let total = 0;
  for (const kind of FOOD_KINDS) {
    for (const source of think.sources[kind] ?? []) {
      if (sourceUsable(think, source)) {
        total += source.amount ?? 0;
      }
    }
  }
  return total;
}

function foodAllowsVillager(think: Think, cost: number): boolean {
  if (
    think.villagers.length < MIN_VILLAGERS ||
    buildingAvailable(think.know, 'farm', think.complete, think.total)
  ) {
    return true;
  }
  const technology = nextAgeTechnology(think.know);
  if (!technology || think.researching.includes(technology.id)) {
    return true;
  }
  return think.cash.food + naturalFood(think) - cost >= (technology.cost.food ?? 0);
}

function trainVillagers(think: Think): void {
  const def = think.data.units[think.data.game.start.unit];
  if (!def || def.building === null || think.holdTownCenter) {
    return;
  }
  const stats = unitStats(think.know, def.id) ?? def;
  let planned = think.villagers.length + (think.queuedUnits[def.id] ?? 0);
  let earmarked = false;
  for (const building of think.buildings) {
    if (building.type !== def.building || planned >= ageVillagerTarget(think)) {
      continue;
    }
    if (!foodAllowsVillager(think, stats.cost.food ?? 0)) {
      continue;
    }
    const busy = building.own?.research !== null || (building.own?.queue.length ?? 0) > 0;
    if (busy || populationRoom(think) <= 0 || !canAfford(think, stats.cost, true)) {
      if (!earmarked && building.own?.research === null) {
        spend(think, stats.cost);
        earmarked = true;
      }
      continue;
    }
    think.commands.push({
      type: 'train',
      playerId: think.me,
      buildingId: building.id,
      unit: def.id,
      count: 1,
    });
    spend(think, stats.cost);
    think.queuedPopulation += def.population;
    planned += 1;
  }
}

function pendingCount(think: Think, type: string): number {
  let count = 0;
  for (const foundation of think.foundations) {
    if (foundation.type === type) {
      count += 1;
    }
  }
  for (const intent of think.state.intents) {
    if (intent.building === type) {
      count += 1;
    }
  }
  return count;
}

function buildHouses(think: Think): void {
  const self = think.view.self;
  let houseId: string | null = null;
  for (const def of Object.values(think.data.buildings)) {
    if (def.class.includes('house')) {
      houseId = def.id;
      break;
    }
  }
  if (houseId === null || self.housing >= self.populationLimit) {
    return;
  }
  const stats = buildingStats(think.know, houseId);
  if (!stats || !buildingAvailable(think.know, houseId, think.complete, think.total)) {
    return;
  }
  const pending = pendingCount(think, houseId) * stats.housing;
  const room = self.housing + pending - self.population - think.queuedPopulation;
  if (room >= think.params.houseMargin || !canAfford(think, stats.cost, true)) {
    return;
  }
  const site = findLandSite(think, houseId, {
    anchor: think.home,
    minRadius: 3,
    maxRadius: HOUSE_RADIUS,
    gap: BUILDING_GAP,
    maxSolidRing: 3,
  });
  if (site) {
    placeBuilding(think, houseId, site, 1);
  }
}

function resumeFoundations(think: Think, work: Workforce): void {
  const seen = think.state.foundationSeen;
  const present = new Set<string>();
  for (const foundation of think.foundations) {
    const key = String(foundation.id);
    present.add(key);
    if (seen[key] === undefined) {
      seen[key] = think.tick;
    }
    if ((work.crowd.get(foundation.id) ?? 0) > 0) {
      continue;
    }
    if (foundation.buildProgress === 0 && think.tick - seen[key] > STALE_FOUNDATION_TICKS) {
      think.commands.push({ type: 'delete', playerId: think.me, entityIds: [foundation.id] });
      continue;
    }
    let builder: EntityView | null = null;
    let bestDistance = Infinity;
    for (const villager of think.villagers) {
      if (think.busy.has(villager.id) || villager.id === think.state.scout.unitId) {
        continue;
      }
      const order = villager.own?.orders[0];
      if (order && (order.type === 'build' || order.type === 'repair')) {
        continue;
      }
      const d = dist(villager.position, foundation.position);
      if (d < bestDistance) {
        builder = villager;
        bestDistance = d;
      }
    }
    if (builder) {
      think.commands.push({
        type: 'build',
        playerId: think.me,
        entityIds: [builder.id],
        targetId: foundation.id,
        queued: false,
      });
      retask(think, builder.id);
    }
  }
  for (const key of Object.keys(seen)) {
    if (!present.has(key)) {
      delete seen[key];
    }
  }
}

function handlePredators(think: Think): void {
  for (const animal of think.animals) {
    const def = think.data.units[animal.type]?.animal;
    if (!def || def.behavior !== 'aggressive') {
      continue;
    }
    const threatened = think.villagers.some(
      (villager) => dist(villager.position, animal.position) <= PREDATOR_RADIUS,
    );
    if (!threatened) {
      continue;
    }
    const guards = think.soldiers
      .filter((soldier) => isIdle(soldier) && dist(soldier.position, animal.position) <= 16)
      .slice(0, PREDATOR_HUNTERS);
    if (guards.length > 0) {
      think.commands.push({
        type: 'attack',
        playerId: think.me,
        entityIds: guards.map((guard) => guard.id),
        targetId: animal.id,
        queued: false,
      });
      return;
    }
    const hunters = think.villagers
      .filter((villager) => {
        if (think.busy.has(villager.id)) {
          return false;
        }
        const order = villager.own?.orders[0];
        return !(order && order.type === 'attack' && order.targetId === animal.id);
      })
      .map((villager) => ({ villager, d: dist(villager.position, animal.position) }))
      .filter((entry) => entry.d <= PREDATOR_RADIUS * 2)
      .sort((a, b) => a.d - b.d || a.villager.id - b.villager.id)
      .slice(0, PREDATOR_HUNTERS);
    const alreadyHunting = think.villagers.filter((villager) => {
      const order = villager.own?.orders[0];
      return order !== undefined && order.type === 'attack' && order.targetId === animal.id;
    }).length;
    if (alreadyHunting >= PREDATOR_HUNTERS || hunters.length === 0) {
      continue;
    }
    think.commands.push({
      type: 'gather',
      playerId: think.me,
      entityIds: hunters.map((entry) => entry.villager.id),
      targetId: animal.id,
      queued: false,
    });
    for (const entry of hunters) {
      retask(think, entry.villager.id);
    }
    return;
  }
}

function clusterSize(think: Think, kind: GatherKind, center: Vec2): number {
  let count = 0;
  for (const source of think.sources[kind] ?? []) {
    if (dist(source.position, center) <= CLUSTER_RADIUS) {
      count += 1;
    }
  }
  return count;
}

export function dropOffBuildingFor(think: Think, kind: GatherKind): string | null {
  let best: string | null = null;
  let bestCost = Infinity;
  for (const def of Object.values(think.data.buildings)) {
    if (
      !def.dropOff.includes(kind) ||
      def.class.includes('town_center') ||
      def.placement !== 'land'
    ) {
      continue;
    }
    const cost = (def.cost.wood ?? 0) + (def.cost.stone ?? 0) + (def.cost.gold ?? 0);
    if (cost < bestCost) {
      best = def.id;
      bestCost = cost;
    }
  }
  return best;
}

export function dropOffAnchor(think: Think, buildingId: string): Vec2 | null {
  const def = think.data.buildings[buildingId];
  if (!def) {
    return null;
  }
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (const kind of def.dropOff) {
    for (const source of think.sources[kind] ?? []) {
      if (!sourceUsable(think, source)) {
        continue;
      }
      const haul = dropOffDistance(think, kind, source.position);
      if (haul <= DROP_OFF_REACH) {
        continue;
      }
      const size = clusterSize(think, kind, source.position);
      if (size < MIN_CLUSTER_FOR_DROP_OFF) {
        continue;
      }
      const score = size * 2 - dist(source.position, think.home);
      if (score > bestScore) {
        best = source.position;
        bestScore = score;
      }
    }
  }
  return best;
}

export function placeDropOff(think: Think, buildingId: string, fallbackToHome: boolean): boolean {
  const anchor = dropOffAnchor(think, buildingId) ?? (fallbackToHome ? think.home : null);
  if (!anchor) {
    return false;
  }
  const nearSource = anchor !== think.home;
  const site = findLandSite(think, buildingId, {
    anchor,
    minRadius: nearSource ? 1 : 4,
    maxRadius: nearSource ? DROP_OFF_SITE_RADIUS : HOUSE_RADIUS,
    gap: BUILDING_GAP,
    maxSolidRing: nearSource ? 99 : 4,
  });
  return site !== null && placeBuilding(think, buildingId, site, 1);
}

function buildDropOffs(think: Think, work: Workforce): void {
  if (think.plannedBuildings >= think.params.concurrentBuildings || isWoodScarce(think)) {
    return;
  }
  const wanted: GatherKind[] = [];
  for (const kind of ['wood', 'gold', 'stone'] as const) {
    if (work.current[kind] >= 2) {
      wanted.push(kind);
    }
  }
  if (work.current.food >= 2) {
    wanted.push('forage');
  }
  for (const kind of wanted) {
    const buildingId = dropOffBuildingFor(think, kind);
    if (buildingId === null || pendingCount(think, buildingId) > 0) {
      continue;
    }
    const stats = buildingStats(think.know, buildingId);
    if (
      !stats ||
      !buildingAvailable(think.know, buildingId, think.complete, think.total) ||
      !canAfford(think, stats.cost)
    ) {
      continue;
    }
    let nearestHaul = Infinity;
    for (const source of think.sources[kind] ?? []) {
      if (sourceUsable(think, source)) {
        nearestHaul = Math.min(nearestHaul, dropOffDistance(think, kind, source.position));
      }
    }
    if (nearestHaul <= DROP_OFF_REACH) {
      continue;
    }
    if (placeDropOff(think, buildingId, false)) {
      think.plannedBuildings += 1;
      return;
    }
  }
}

function prospectPoint(think: Think): Vec2 | null {
  const points = PROSPECT_RADII.length * PROSPECT_DIRECTIONS;
  for (let step = 0; step < points; step++) {
    const index = (think.state.prospectIndex + step) % points;
    const radius = PROSPECT_RADII[Math.floor(index / PROSPECT_DIRECTIONS)];
    const angle = ((index % PROSPECT_DIRECTIONS) / PROSPECT_DIRECTIONS) * Math.PI * 2;
    const x = Math.floor(think.home.x + Math.cos(angle) * radius);
    const y = Math.floor(think.home.y + Math.sin(angle) * radius);
    if (x < 1 || y < 1 || x >= think.size - 1 || y >= think.size - 1) {
      continue;
    }
    if (think.view.fog.explored[y * think.size + x] !== 1) {
      think.state.prospectIndex = index + 1;
      return { x: x + 0.5, y: y + 0.5 };
    }
  }
  return null;
}

function hasUsableSource(think: Think, kinds: readonly GatherKind[]): boolean {
  for (const kind of kinds) {
    for (const source of think.sources[kind] ?? []) {
      if (sourceUsable(think, source)) {
        return true;
      }
    }
  }
  return false;
}

function prospect(think: Think): void {
  const probe = think.state.prospector;
  const farms = buildingAvailable(think.know, 'farm', think.complete, think.total);
  const needed =
    (!farms && naturalFood(think) < PROSPECT_FOOD) || !hasUsableSource(think, ['wood']);
  let unit = probe.unitId !== null ? think.byId.get(probe.unitId) : undefined;
  if (!needed || (unit && unit.owner !== think.me)) {
    probe.unitId = null;
    probe.target = null;
    return;
  }
  if (!unit) {
    unit =
      think.villagers.find((villager) => isIdle(villager) && !think.busy.has(villager.id)) ??
      think.villagers.find(
        (villager) => !think.busy.has(villager.id) && villager.own?.orders[0]?.type === 'gather',
      );
    probe.unitId = unit ? unit.id : null;
    probe.target = null;
  }
  if (!unit) {
    return;
  }
  retask(think, unit.id);
  const target = probe.target;
  const moving = (unit.own?.orders.length ?? 0) > 0;
  if (
    target !== null &&
    moving &&
    think.tick - probe.since <= PROSPECT_TIMEOUT_TICKS &&
    think.view.fog.explored[Math.floor(target.y) * think.size + Math.floor(target.x)] !== 1
  ) {
    return;
  }
  const next = prospectPoint(think);
  if (!next) {
    probe.unitId = null;
    probe.target = null;
    think.busy.delete(unit.id);
    return;
  }
  probe.target = next;
  probe.since = think.tick;
  think.commands.push({
    type: 'move',
    playerId: think.me,
    entityIds: [unit.id],
    target: next,
    queued: false,
  });
}

export function manageEconomy(think: Think): void {
  reviewAssignments(think);
  prospect(think);
  trainVillagers(think);
  buildHouses(think);
  const work = surveyWorkforce(think);
  resumeFoundations(think, work);
  handlePredators(think);
  work.idle = work.idle.filter((villager) => !think.busy.has(villager.id));
  assignIdle(think, work);
  rebalance(think, work);
  buildDropOffs(think, work);
}
