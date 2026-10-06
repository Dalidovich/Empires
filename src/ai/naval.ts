import type { UnitDef } from '../data/types';
import type { EntityView } from '../sim/snapshot';
import type { Vec2 } from '../sim/types';
import type { Think } from './context';
import {
  canAfford,
  centroid,
  dist,
  gridOf,
  hold,
  isExplored,
  isIdle,
  isWaterTerrain,
  landRegionAt,
  nearest,
  populationRoom,
  random,
  regionsOf,
  release,
  retask,
  spend,
  unitDef,
} from './context';
import { isWoodScarce } from './economy';
import { unitStats, unitTrainable } from './knowledge';
import { fieldArmy, launchSize, needsTransport } from './military';
import { findDockSite } from './placement';
import { unitPower } from './roster';
import { advanceProbe, markSwept, sweepPoint } from './scouting';
import { isWaterMap } from './strategy';

const MAX_TRANSPORTS = 3;
const BOARD_TIMEOUT_TICKS = 1200;
const SAIL_TIMEOUT_TICKS = 3600;
const LANDING_SEARCH_RADIUS = 14;
const LANDING_JITTER = 6;
const HOME_WEIGHT = 0.25;
const FISH_RANGE = 40;
const SHIP_ALERT_RADIUS = 18;
const NAVY_ORDER_REFRESH_TICKS = 600;
const MIN_OPEN_WATER = 20;
const EARLY_FISHERS = 2;
const SCARCE_WARSHIPS = 2;
const SCARCE_TRANSPORTS = 2;
const SWEEP_ARRIVAL = 5;
const SCARCE_FISHERS = 3;

function docks(think: Think): EntityView[] {
  return think.buildings.filter((building) =>
    think.data.buildings[building.type]?.class.includes('dock'),
  );
}

function dockUnit(think: Think, dockType: string, tag: UnitDef['class'][number]): UnitDef | null {
  let best: UnitDef | null = null;
  let bestPower = -1;
  for (const base of Object.values(think.data.units)) {
    if (base.building !== dockType || !base.class.includes(tag) || !unitTrainable(think.know, base.id)) {
      continue;
    }
    const stats = unitStats(think.know, base.id) ?? base;
    const power = unitPower(stats);
    if (power > bestPower) {
      best = stats;
      bestPower = power;
    }
  }
  return best;
}

function fishAvailable(think: Think, from: Vec2): EntityView | null {
  return nearest(
    think.sources.boat_fish ?? [],
    from,
    (fish) => !think.state.badTargets.includes(fish.id) && dist(fish.position, from) <= FISH_RANGE,
  );
}

function enemyShips(think: Think): EntityView[] {
  return think.enemyUnits.filter((unit) => think.data.units[unit.type]?.domain === 'water');
}

function wantedTransports(think: Think): number {
  if (think.layout !== 'islands') {
    return 0;
  }
  const capacity = dockUnitCapacity(think);
  if (capacity <= 0) {
    return 0;
  }
  const army = fieldArmy(think).length;
  const wanted = Math.ceil(Math.min(army, launchSize(think)) / capacity);
  return Math.max(1, Math.min(isWoodScarce(think) ? SCARCE_TRANSPORTS : MAX_TRANSPORTS, wanted));
}

function dockUnitCapacity(think: Think): number {
  for (const dock of docks(think)) {
    const transport = dockUnit(think, dock.type, 'transport_ship');
    if (transport) {
      return transport.transportCapacity ?? 0;
    }
  }
  return 0;
}

function fisherLimit(think: Think): number {
  return isWoodScarce(think)
    ? Math.min(think.params.fishingBoats, SCARCE_FISHERS)
    : think.params.fishingBoats;
}

function wantedWarships(think: Think): number {
  const base = think.layout === 'islands' ? think.params.warships : Math.ceil(think.params.warships / 2);
  const limit = isWoodScarce(think) ? Math.min(base, SCARCE_WARSHIPS) : base;
  return limit + (enemyShips(think).length > 0 ? 1 : 0);
}

function queuedByClass(think: Think, tag: UnitDef['class'][number]): number {
  let count = 0;
  for (const id of Object.keys(think.queuedUnits)) {
    if (think.data.units[id]?.class.includes(tag)) {
      count += think.queuedUnits[id];
    }
  }
  return count;
}

export function holdTransportFunds(think: Think): void {
  if (think.layout !== 'islands' || think.soldiers.length === 0) {
    return;
  }
  if (think.transports.length + queuedByClass(think, 'transport_ship') > 0) {
    return;
  }
  for (const dock of docks(think)) {
    const transport = dockUnit(think, dock.type, 'transport_ship');
    if (transport) {
      hold(think, transport.cost);
      return;
    }
  }
}

function trainShips(think: Think): void {
  release(think);
  let fishers = think.fishers.length + queuedByClass(think, 'fishing_ship');
  let transports = think.transports.length + queuedByClass(think, 'transport_ship');
  let warships = think.warships.length + queuedByClass(think, 'war_ship');
  for (const dock of docks(think)) {
    if (
      dock.own === null ||
      dock.own.research !== null ||
      dock.own.queue.length > 0 ||
      think.busy.has(dock.id) ||
      populationRoom(think) <= 0
    ) {
      continue;
    }
    const fishing = dockUnit(think, dock.type, 'fishing_ship');
    const transport = dockUnit(think, dock.type, 'transport_ship');
    const warship = dockUnit(think, dock.type, 'war_ship');
    const hasFish = fishAvailable(think, dock.position) !== null;
    let choice: UnitDef | null = null;
    if (fishing && hasFish && fishers < Math.min(EARLY_FISHERS, think.params.fishingBoats)) {
      choice = fishing;
    } else if (transport && transports < wantedTransports(think)) {
      choice = transport;
    } else if (warship && warships < wantedWarships(think)) {
      choice = warship;
    } else if (fishing && hasFish && fishers < fisherLimit(think)) {
      choice = fishing;
    }
    if (!choice || !canAfford(think, choice.cost)) {
      continue;
    }
    think.commands.push({
      type: 'train',
      playerId: think.me,
      buildingId: dock.id,
      unit: choice.id,
      count: 1,
    });
    spend(think, choice.cost);
    think.queuedPopulation += choice.population;
    think.busy.add(dock.id);
    if (choice === fishing) {
      fishers += 1;
    } else if (choice === transport) {
      transports += 1;
    } else {
      warships += 1;
    }
  }
}

function commandFishers(think: Think): void {
  for (const fisher of think.fishers) {
    if (!isIdle(fisher)) {
      continue;
    }
    const fish = fishAvailable(think, fisher.position);
    if (!fish) {
      continue;
    }
    think.commands.push({
      type: 'gather',
      playerId: think.me,
      entityIds: [fisher.id],
      targetId: fish.id,
      queued: false,
    });
    think.state.assigned[fisher.id] = { targetId: fish.id, tick: think.tick };
  }
}

function isVillager(think: Think, entity: EntityView | undefined): boolean {
  return entity !== undefined && (unitDef(think, entity)?.class.includes('villager') ?? false);
}

function findCoast(think: Think): void {
  const probe = think.state.scout;
  let unit = probe.unitId !== null ? think.byId.get(probe.unitId) : undefined;
  const dockType = Object.values(think.data.buildings).find((def) => def.class.includes('dock'));
  const searching =
    isWaterMap(think) &&
    dockType !== undefined &&
    (think.total[dockType.id] ?? 0) === 0 &&
    findDockSite(think, dockType.id) === null;
  if (!searching) {
    if (isVillager(think, unit)) {
      probe.unitId = null;
      probe.target = null;
    }
    return;
  }
  if (!unit || unit.owner !== think.me) {
    unit =
      think.villagers.find((villager) => isIdle(villager) && !think.busy.has(villager.id)) ??
      think.villagers.find((villager) => !think.busy.has(villager.id));
    probe.unitId = unit ? unit.id : null;
    probe.target = null;
  }
  if (unit) {
    retask(think, unit.id);
    advanceProbe(think, probe, unit);
  }
}

export function landingPoint(think: Think, target: Vec2, jitter: boolean): Vec2 {
  const size = think.size;
  const terrain = think.view.map.terrain;
  const regions = regionsOf(think);
  const grid = gridOf(think);
  const targetRegion = landRegionAt(think, target);
  const centerX = Math.floor(target.x);
  const centerY = Math.floor(target.y);
  let best: Vec2 | null = null;
  let bestScore = Infinity;
  for (let dy = -LANDING_SEARCH_RADIUS; dy <= LANDING_SEARCH_RADIUS; dy++) {
    for (let dx = -LANDING_SEARCH_RADIUS; dx <= LANDING_SEARCH_RADIUS; dx++) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (!isExplored(think, x, y)) {
        continue;
      }
      const tile = y * size + x;
      if (isWaterTerrain(terrain[tile]) || grid.solid[tile] === 1) {
        continue;
      }
      if (targetRegion !== 0 && regions.land[tile] !== targetRegion) {
        continue;
      }
      let open = false;
      for (let n = 0; n < 4 && !open; n++) {
        const nx = x + (n === 0 ? 1 : n === 1 ? -1 : 0);
        const ny = y + (n === 2 ? 1 : n === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
          continue;
        }
        const next = ny * size + nx;
        open =
          isWaterTerrain(terrain[next]) &&
          regions.waterSizes[regions.water[next]] >= MIN_OPEN_WATER;
      }
      if (!open) {
        continue;
      }
      const point = { x: x + 0.5, y: y + 0.5 };
      const score =
        dist(point, target) +
        HOME_WEIGHT * dist(point, think.home) +
        (jitter ? random(think) * LANDING_JITTER : 0);
      if (score < bestScore) {
        best = point;
        bestScore = score;
      }
    }
  }
  return best ?? { x: target.x, y: target.y };
}

function capacityOf(think: Think, transport: EntityView): number {
  return unitStats(think.know, transport.type)?.transportCapacity ?? 0;
}

function issueLoad(think: Think, passengers: readonly number[], transport: EntityView): void {
  if (passengers.length === 0) {
    return;
  }
  think.commands.push({
    type: 'load',
    playerId: think.me,
    entityIds: [...passengers],
    transportId: transport.id,
    queued: false,
  });
}

function startBoarding(think: Think, waiting: EntityView[], target: Vec2): void {
  const invasion = think.state.invasion;
  const pool = [...waiting];
  const loads = [];
  for (const transport of think.transports) {
    const room = capacityOf(think, transport) - (transport.own?.cargo.length ?? 0);
    if (room <= 0 || pool.length === 0) {
      continue;
    }
    pool.sort(
      (a, b) =>
        dist(a.position, transport.position) - dist(b.position, transport.position) || a.id - b.id,
    );
    const passengers = pool.splice(0, room).map((unit) => unit.id);
    issueLoad(think, passengers, transport);
    loads.push({ transport: transport.id, passengers });
  }
  if (loads.length === 0) {
    return;
  }
  think.state.contactTick = think.tick;
  invasion.phase = 'board';
  invasion.loads = loads;
  invasion.target = { x: target.x, y: target.y };
  invasion.since = think.tick;
}

function continueBoarding(think: Think): void {
  const invasion = think.state.invasion;
  const timedOut = think.tick - invasion.since > BOARD_TIMEOUT_TICKS;
  let ready = true;
  let alive = false;
  for (const load of invasion.loads) {
    const transport = think.byId.get(load.transport);
    if (!transport || transport.owner !== think.me) {
      continue;
    }
    alive = true;
    const cargo = transport.own?.cargo ?? [];
    const pending = load.passengers.filter((id) => !cargo.includes(id) && think.byId.has(id));
    if (pending.length === 0 || cargo.length >= capacityOf(think, transport)) {
      continue;
    }
    ready = false;
    const stalled = pending.filter((id) => {
      const order = think.byId.get(id)?.own?.orders[0];
      return !(order && order.type === 'load');
    });
    issueLoad(think, stalled, transport);
  }
  if (!alive) {
    invasion.phase = 'idle';
    invasion.loads = [];
    return;
  }
  if (!ready && !timedOut) {
    return;
  }
  const target = invasion.target ?? think.home;
  const landing = landingPoint(think, target, false);
  let sailing = false;
  for (const load of invasion.loads) {
    const transport = think.byId.get(load.transport);
    if (!transport || (transport.own?.cargo.length ?? 0) === 0) {
      continue;
    }
    sailing = true;
    think.commands.push({
      type: 'unload',
      playerId: think.me,
      entityIds: [transport.id],
      target: landing,
      queued: false,
    });
  }
  invasion.phase = sailing ? 'sail' : 'idle';
  invasion.since = think.tick;
  if (!sailing) {
    invasion.loads = [];
  }
}

function continueSailing(think: Think): void {
  const invasion = think.state.invasion;
  const target = think.state.army.target ?? invasion.target ?? think.home;
  let underway = false;
  for (const load of invasion.loads) {
    const transport = think.byId.get(load.transport);
    if (!transport || (transport.own?.cargo.length ?? 0) === 0) {
      continue;
    }
    underway = true;
    if (isIdle(transport)) {
      think.commands.push({
        type: 'unload',
        playerId: think.me,
        entityIds: [transport.id],
        target: landingPoint(think, target, true),
        queued: false,
      });
    }
  }
  if (underway && think.tick - invasion.since <= SAIL_TIMEOUT_TICKS) {
    return;
  }
  if (!underway) {
    invasion.landings += 1;
  }
  invasion.phase = 'idle';
  invasion.loads = [];
  invasion.since = think.tick;
}

function runInvasion(think: Think): void {
  const invasion = think.state.invasion;
  const army = think.state.army;
  if (invasion.phase === 'board') {
    continueBoarding(think);
    return;
  }
  if (invasion.phase === 'sail') {
    continueSailing(think);
    return;
  }
  if (army.mode !== 'attack' || army.target === null || think.transports.length === 0) {
    return;
  }
  const target = army.target;
  const members = new Set(army.members);
  const waiting = think.soldiers.filter(
    (soldier) =>
      members.has(soldier.id) &&
      needsTransport(think, soldier, target) &&
      landRegionAt(think, soldier.position) === landRegionAt(think, think.home),
  );
  if (waiting.length > 0) {
    startBoarding(think, waiting, target);
  }
}

function commandWarships(think: Think): void {
  const navy = think.state.navy;
  const ships = think.warships.filter((ship) => ship.id !== think.state.navalScout.unitId);
  if (ships.length === 0) {
    return;
  }
  const hostile = enemyShips(think);
  const anchors = [...docks(think), ...think.fishers, ...think.transports];
  const from = centroid(ships) ?? think.home;
  const threat = nearest(hostile, from, (enemy) =>
    anchors.some((anchor) => dist(anchor.position, enemy.position) <= SHIP_ALERT_RADIUS),
  );
  let goal: Vec2 | null = null;
  const hunting =
    think.state.army.mode === 'attack' || think.know.age >= think.params.minAttackAge;
  if (threat) {
    goal = threat.position;
  } else if (hostile.length > 0) {
    goal = (nearest(hostile, from) as EntityView).position;
  } else if (think.state.army.mode === 'attack' && think.enemyBuildings.length > 0) {
    goal = think.state.army.target;
  } else if (hunting && think.enemyBuildings.length === 0) {
    const current = navy.target;
    const arrived = current !== null && dist(from, current) <= SWEEP_ARRIVAL;
    const expired = think.tick - navy.targetSince > NAVY_ORDER_REFRESH_TICKS;
    if (current !== null && !arrived && !expired) {
      goal = current;
    } else {
      if (current !== null) {
        markSwept(think, navy.swept, current);
      }
      goal = sweepPoint(think, from, navy.swept, true);
    }
  }
  if (!goal) {
    navy.target = null;
    return;
  }
  const changed = navy.target === null || dist(navy.target, goal) > 4;
  const stale = think.tick - navy.targetSince > NAVY_ORDER_REFRESH_TICKS;
  if (changed || stale) {
    navy.target = { x: goal.x, y: goal.y };
    navy.targetSince = think.tick;
  }
  if (!changed && !stale) {
    return;
  }
  const movers = ships.filter((ship) => ship.own?.orders[0]?.type !== 'attack');
  if (movers.length > 0) {
    think.commands.push({
      type: 'attackMove',
      playerId: think.me,
      entityIds: movers.map((ship) => ship.id),
      target: { x: goal.x, y: goal.y },
      queued: false,
    });
  }
}

export function manageNavy(think: Think): void {
  const hasFleet =
    think.fishers.length + think.warships.length + think.transports.length > 0 ||
    docks(think).length > 0;
  if (!isWaterMap(think) && !hasFleet) {
    return;
  }
  findCoast(think);
  trainShips(think);
  commandFishers(think);
  runInvasion(think);
  commandWarships(think);
}
