import type { UnitDef } from '../data/types';
import type { EntityView } from '../sim/snapshot';
import type { Vec2 } from '../sim/types';
import type { Think } from './context';
import {
  canAfford,
  centroid,
  dist,
  isExplored,
  isHostile,
  isIdle,
  landRegionAt,
  nearest,
  populationRoom,
  spend,
  unitDef,
} from './context';
import { ageVillagerTarget, isWoodScarce, villagerLimit } from './economy';
import { nextAgeTechnology, unitStats, unitTrainable } from './knowledge';
import type { Role, Roster } from './roster';
import { isLandFighter, roleOf, unitPower, unitValue } from './roster';
import { enemyGuess, markSwept, sweepPoint } from './scouting';

const ROLE_SHARE: Record<Role, number> = { melee: 0.5, ranged: 0.35, siege: 0.15 };
const MAX_SIEGE = 4;
const MIN_LAUNCH = 4;
const WAVE_GROWTH = 0.15;
const RALLY_DISTANCE = 7;
const RALLY_TOLERANCE = 7;
const MARCH_TOLERANCE = 7;
const DIRECT_ATTACK_RADIUS = 9;
const REINFORCE_MIN = 3;
const HOME_RADIUS = 26;
const CORE_BASE_RADIUS = 18;
const RUSH_AGE = 1;
const SWEEP_ARRIVAL = 5;
const TIMER_LAUNCH_SIZE = 3;
const FULL_POPULATION_LAUNCH = 5;
const FOCUS_FIRE_QUALITY = 0.5;
const SIEGE_QUALITY = 0.3;
const WOUNDED_QUALITY = 0.8;
const WOUNDED_RATIO = 0.25;
const SIEGE_REACH = 15;
const WALL_REACH = 3;
const HEAL_RADIUS = 10;
const HEAL_RATIO = 0.9;
const CONVERT_MARGIN = 3;
const PRIEST_FOLLOW = 7;
const SWEEP_TIMEOUT_TICKS = 1600;
const UNHEALABLE: readonly string[] = ['ship', 'machine'];

export interface AttackTarget {
  position: Vec2;
  entity: EntityView | null;
}

export function armyCap(think: Think): number {
  const ships = think.fishers.length + think.warships.length + think.transports.length;
  const room =
    think.view.self.populationLimit - villagerLimit(think) - ships - think.priests.length;
  return Math.max(0, Math.min(think.params.maxArmy, room));
}

export function launchSize(think: Think): number {
  const cap = armyCap(think);
  const base = Math.max(MIN_LAUNCH, Math.round(cap * think.params.attackArmyShare));
  return Math.min(cap, Math.round(base * (1 + WAVE_GROWTH * think.state.army.waves)));
}

function minimumArmy(think: Think): number {
  return Math.round(think.params.earlyArmy * think.know.age);
}

export function fieldArmy(think: Think): EntityView[] {
  return think.soldiers.filter(
    (soldier) =>
      soldier.id !== think.state.scout.unitId && soldier.id !== think.state.collector.unitId,
  );
}

function isFighter(think: Think, unit: EntityView): boolean {
  const def = think.data.units[unit.type];
  return def !== undefined && isLandFighter(def);
}

function isSiegeType(def: UnitDef | undefined): boolean {
  return def !== undefined && def.class.includes('siege');
}

function trainArmy(think: Think, roster: Roster): void {
  const counts: Record<Role, number> = { melee: 0, ranged: 0, siege: 0 };
  let army = 0;
  for (const soldier of think.soldiers) {
    const def = unitDef(think, soldier);
    if (def) {
      counts[roleOf(def)] += 1;
      army += 1;
    }
  }
  for (const id of Object.keys(think.queuedUnits)) {
    const def = think.data.units[id];
    if (def && isLandFighter(def)) {
      counts[roleOf(def)] += think.queuedUnits[id];
      army += think.queuedUnits[id];
    }
  }
  const cap = armyCap(think);
  const finalAge = nextAgeTechnology(think.know) === null;
  const economyReady = finalAge || think.villagers.length >= ageVillagerTarget(think) - 1;
  for (const building of think.buildings) {
    if (army >= cap || populationRoom(think) <= 0) {
      return;
    }
    if (
      building.own === null ||
      building.own.research !== null ||
      building.own.queue.length > 0 ||
      think.busy.has(building.id)
    ) {
      continue;
    }
    const urgent = army < minimumArmy(think);
    if (!urgent && !economyReady) {
      continue;
    }
    let best: UnitDef | null = null;
    let bestScore = 0;
    for (const base of Object.values(think.data.units)) {
      if (base.building !== building.type || !isLandFighter(base) || !unitTrainable(think.know, base.id)) {
        continue;
      }
      const stats = unitStats(think.know, base.id) ?? base;
      if (!canAfford(think, stats.cost, urgent)) {
        continue;
      }
      const role = roleOf(stats);
      if (role === 'siege' && counts.siege >= MAX_SIEGE) {
        continue;
      }
      const share = army > 0 ? counts[role] / army : 0;
      const preferred = roster[role]?.unit === base.id ? 1.25 : 1;
      const score = unitValue(stats) * preferred * (1 + Math.max(0, ROLE_SHARE[role] - share) * 3);
      if (score > bestScore) {
        best = stats;
        bestScore = score;
      }
    }
    if (!best) {
      continue;
    }
    think.commands.push({
      type: 'train',
      playerId: think.me,
      buildingId: building.id,
      unit: best.id,
      count: 1,
    });
    spend(think, best.cost);
    think.busy.add(building.id);
    think.queuedPopulation += best.population;
    counts[roleOf(best)] += 1;
    army += 1;
  }
}

function isWall(think: Think, building: EntityView): boolean {
  return think.data.buildings[building.type]?.class.includes('wall') ?? false;
}

function timerTarget(think: Think): AttackTarget | null {
  for (const timer of think.view.victoryTimers) {
    if (timer.playerId === think.me || (think.view.self.diplomacy[timer.playerId] ?? 'enemy') !== 'enemy') {
      continue;
    }
    const entity = timer.entityId !== null ? think.byId.get(timer.entityId) : undefined;
    if (entity) {
      return { position: entity.position, entity };
    }
    const building = think.enemyBuildings.find((entry) => entry.owner === timer.playerId);
    if (building) {
      return { position: building.position, entity: building };
    }
    const holder = think.enemyUnits.find((entry) => entry.owner === timer.playerId);
    if (holder) {
      return { position: holder.position, entity: holder };
    }
  }
  return null;
}

export function enemyTimerRunning(think: Think): boolean {
  return think.view.victoryTimers.some(
    (timer) =>
      timer.playerId !== think.me &&
      (think.view.self.diplomacy[timer.playerId] ?? 'enemy') === 'enemy',
  );
}

export function pickTarget(think: Think, from: Vec2): AttackTarget | null {
  const timed = timerTarget(think);
  if (timed) {
    return timed;
  }
  const building = nearest(think.enemyBuildings, from, (entry) => !isWall(think, entry));
  if (building) {
    return { position: building.position, entity: building };
  }
  const unit = nearest(
    think.enemyUnits,
    from,
    (entry) => think.data.units[entry.type]?.domain === 'land',
  );
  if (unit) {
    return { position: unit.position, entity: unit };
  }
  const wall = nearest(think.enemyBuildings, from);
  if (wall) {
    return { position: wall.position, entity: wall };
  }
  return null;
}

function sweepTarget(think: Think, from: Vec2): Vec2 {
  const army = think.state.army;
  const current = army.target;
  if (current !== null) {
    const reached = dist(from, current) <= SWEEP_ARRIVAL;
    const stale = think.tick - army.targetSince > SWEEP_TIMEOUT_TICKS;
    if (!reached && !stale) {
      return current;
    }
    markSwept(think, army.swept, current);
  }
  const guess = enemyGuess(think);
  if (!isExplored(think, Math.floor(guess.x), Math.floor(guess.y))) {
    return guess;
  }
  return sweepPoint(think, from, army.swept, false);
}

export function needsTransport(think: Think, unit: EntityView, target: Vec2): boolean {
  if (think.layout !== 'islands') {
    return false;
  }
  if (!isExplored(think, Math.floor(target.x), Math.floor(target.y))) {
    return true;
  }
  const region = landRegionAt(think, target);
  return region !== 0 && region !== landRegionAt(think, unit.position);
}

function isEngaged(unit: EntityView): boolean {
  const order = unit.own?.orders[0];
  return order !== undefined && order.type === 'attack';
}

function isMarching(unit: EntityView, target: Vec2): boolean {
  const order = unit.own?.orders[0];
  return (
    order !== undefined &&
    order.type === 'attackMove' &&
    dist(order.target, target) <= MARCH_TOLERANCE
  );
}

function attackMove(think: Think, units: readonly EntityView[], target: Vec2): void {
  if (units.length === 0) {
    return;
  }
  think.commands.push({
    type: 'attackMove',
    playerId: think.me,
    entityIds: units.map((unit) => unit.id),
    target: { x: target.x, y: target.y },
    queued: false,
  });
}

function attackEntity(think: Think, units: readonly EntityView[], target: EntityView): void {
  if (units.length === 0) {
    return;
  }
  think.commands.push({
    type: 'attack',
    playerId: think.me,
    entityIds: units.map((unit) => unit.id),
    targetId: target.id,
    queued: false,
  });
}

function rallyPoint(think: Think): Vec2 {
  const guess = enemyGuess(think);
  const length = dist(guess, think.home);
  if (length < 1) {
    return think.home;
  }
  return {
    x: think.home.x + ((guess.x - think.home.x) / length) * RALLY_DISTANCE,
    y: think.home.y + ((guess.y - think.home.y) / length) * RALLY_DISTANCE,
  };
}

function baseThreat(think: Think): EntityView | null {
  let best: EntityView | null = null;
  let bestDistance = Infinity;
  const radius = think.params.defendRadius;
  const anchors = [...think.buildings, ...think.foundations].filter(
    (building) => dist(building.position, think.home) <= CORE_BASE_RADIUS,
  );
  for (const enemy of think.enemyUnits) {
    if (think.data.units[enemy.type]?.domain !== 'land') {
      continue;
    }
    let near = dist(enemy.position, think.home) <= radius;
    for (let i = 0; !near && i < anchors.length; i++) {
      near = dist(enemy.position, anchors[i].position) <= radius;
    }
    if (!near) {
      continue;
    }
    const d = dist(enemy.position, think.home);
    if (d < bestDistance) {
      best = enemy;
      bestDistance = d;
    }
  }
  return best;
}

function focusFire(think: Think, members: readonly EntityView[]): Set<number> {
  const handled = new Set<number>();
  if (think.level.microQuality < FOCUS_FIRE_QUALITY || think.enemyUnits.length === 0) {
    return handled;
  }
  const groups = new Map<number, EntityView[]>();
  for (const member of members) {
    const stats = unitStats(think.know, member.type);
    if (!stats || roleOf(stats) !== 'ranged') {
      continue;
    }
    let chosen: EntityView | null = null;
    for (const enemy of think.enemyUnits) {
      if (dist(enemy.position, member.position) > stats.range + 1) {
        continue;
      }
      if (!chosen || enemy.hp < chosen.hp || (enemy.hp === chosen.hp && enemy.id < chosen.id)) {
        chosen = enemy;
      }
    }
    if (!chosen) {
      continue;
    }
    handled.add(member.id);
    const order = member.own?.orders[0];
    if (order && order.type === 'attack' && order.targetId === chosen.id) {
      continue;
    }
    const group = groups.get(chosen.id);
    if (group) {
      group.push(member);
    } else {
      groups.set(chosen.id, [member]);
    }
  }
  for (const [targetId, group] of groups) {
    const target = think.byId.get(targetId);
    if (target) {
      attackEntity(think, group, target);
    }
  }
  return handled;
}

function directSiege(think: Think, members: readonly EntityView[], handled: Set<number>): void {
  if (think.level.microQuality < SIEGE_QUALITY) {
    return;
  }
  for (const member of members) {
    if (handled.has(member.id) || !isSiegeType(unitDef(think, member))) {
      continue;
    }
    const building = nearest(
      think.enemyBuildings,
      member.position,
      (entry) => !entry.remembered && dist(entry.position, member.position) <= SIEGE_REACH,
    );
    if (!building) {
      continue;
    }
    handled.add(member.id);
    const order = member.own?.orders[0];
    if (!(order && order.type === 'attack' && order.targetId === building.id)) {
      attackEntity(think, [member], building);
    }
  }
}

function retreatWounded(think: Think, members: EntityView[], handled: Set<number>): void {
  if (think.level.microQuality < WOUNDED_QUALITY || think.priests.length === 0) {
    return;
  }
  const army = think.state.army;
  for (const member of members) {
    if (handled.has(member.id) || member.hp >= member.maxHp * WOUNDED_RATIO) {
      continue;
    }
    if (isSiegeType(unitDef(think, member))) {
      continue;
    }
    handled.add(member.id);
    army.members = army.members.filter((id) => id !== member.id);
    think.commands.push({
      type: 'move',
      playerId: think.me,
      entityIds: [member.id],
      target: { x: think.home.x, y: think.home.y },
      queued: false,
    });
  }
}

function orderAssault(think: Think, members: EntityView[], target: AttackTarget | Vec2): void {
  const position = 'position' in target ? target.position : target;
  const entity = 'position' in target ? target.entity : null;
  const handled = focusFire(think, members);
  directSiege(think, members, handled);
  retreatWounded(think, members, handled);
  const marchers: EntityView[] = [];
  const strikers: EntityView[] = [];
  for (const member of members) {
    if (handled.has(member.id) || isEngaged(member) || needsTransport(think, member, position)) {
      continue;
    }
    if (isIdle(member)) {
      const wall = nearest(
        think.enemyBuildings,
        member.position,
        (entry) =>
          !entry.remembered &&
          isWall(think, entry) &&
          dist(entry.position, member.position) <= WALL_REACH,
      );
      if (wall && dist(member.position, position) > MARCH_TOLERANCE) {
        attackEntity(think, [member], wall);
        continue;
      }
      if (
        entity &&
        !entity.remembered &&
        entity.kind === 'building' &&
        dist(member.position, position) <= DIRECT_ATTACK_RADIUS
      ) {
        strikers.push(member);
        continue;
      }
    }
    if (!isMarching(member, position)) {
      marchers.push(member);
    }
  }
  if (entity) {
    attackEntity(think, strikers, entity);
  }
  attackMove(think, marchers, position);
}

function carriedIds(think: Think): Set<number> {
  const carried = new Set<number>();
  for (const transport of think.transports) {
    for (const id of transport.own?.cargo ?? []) {
      carried.add(id);
    }
  }
  return carried;
}

function shouldLaunch(think: Think, army: readonly EntityView[]): boolean {
  if (army.length === 0) {
    return false;
  }
  if (enemyTimerRunning(think) && army.length >= TIMER_LAUNCH_SIZE) {
    return true;
  }
  const state = think.state;
  const technology = nextAgeTechnology(think.know);
  const stalled =
    technology !== null &&
    !think.researching.includes(technology.id) &&
    think.tick - state.ageTick > think.params.stallTicks;
  if (think.tick < state.army.nextAttackTick) {
    return false;
  }
  const rush = think.know.age >= RUSH_AGE && isWoodScarce(think);
  if (!stalled && !rush) {
    if (think.know.age < think.params.minAttackAge) {
      return false;
    }
    if (state.attackAgeTick === null) {
      state.attackAgeTick = think.tick;
    }
    if (think.tick < state.attackAgeTick + think.params.attackDelayTicks) {
      return false;
    }
  }
  if (army.length >= launchSize(think) || (stalled && army.length >= MIN_LAUNCH)) {
    return true;
  }
  const self = think.view.self;
  return (
    self.population + think.queuedPopulation >= self.populationLimit - 1 &&
    army.length >= FULL_POPULATION_LAUNCH
  );
}

function standDown(think: Think): void {
  const army = think.state.army;
  army.mode = 'home';
  army.members = [];
  army.target = null;
  army.waves += 1;
  army.nextAttackTick = think.tick + think.params.attackCooldownTicks;
}

function commandArmy(think: Think): void {
  const army = think.state.army;
  if (think.know.age !== think.state.ageSeen) {
    think.state.ageSeen = think.know.age;
    think.state.ageTick = think.tick;
    think.state.contactTick = think.tick;
  }
  if (
    think.enemyBuildings.some((building) => !building.remembered) ||
    think.enemyUnits.some((unit) => isFighter(think, unit))
  ) {
    think.state.contactTick = think.tick;
  }
  const field = fieldArmy(think);
  const carried = carriedIds(think);
  const threat = baseThreat(think);
  if (army.mode === 'home' && shouldLaunch(think, field)) {
    think.state.contactTick = think.tick;
    army.mode = 'attack';
    army.members = field.map((soldier) => soldier.id);
    army.launchSize = field.length;
    army.target = null;
    army.targetSince = think.tick;
  }
  const memberIds = new Set(army.members);
  const members = field.filter((soldier) => memberIds.has(soldier.id));
  const reserve = field.filter((soldier) => !memberIds.has(soldier.id));
  if (army.mode === 'attack') {
    army.members = army.members.filter((id) => think.byId.has(id) || carried.has(id));
    const strength = members.length + army.members.filter((id) => carried.has(id)).length;
    const retreat =
      think.params.retreatShare > 0 &&
      !enemyTimerRunning(think) &&
      strength < army.launchSize * think.params.retreatShare;
    if (strength === 0 || retreat) {
      standDown(think);
      reserve.push(...members);
      members.length = 0;
    }
  }
  if (army.mode === 'attack' && members.length > 0) {
    const fresh = reserve.filter((soldier) => dist(soldier.position, think.home) <= HOME_RADIUS);
    if (!threat && fresh.length >= Math.max(REINFORCE_MIN, Math.round(army.launchSize / 3))) {
      for (const soldier of fresh) {
        army.members.push(soldier.id);
        members.push(soldier);
        reserve.splice(reserve.indexOf(soldier), 1);
      }
    }
    const from = centroid(members) ?? think.home;
    const target = pickTarget(think, from);
    if (target) {
      army.target = { x: target.position.x, y: target.position.y };
      army.targetSince = think.tick;
      army.swept.length = 0;
      orderAssault(think, members, target);
    } else {
      const sweep = sweepTarget(think, from);
      if (army.target === null || army.target.x !== sweep.x || army.target.y !== sweep.y) {
        army.target = { x: sweep.x, y: sweep.y };
        army.targetSince = think.tick;
      }
      orderAssault(think, members, sweep);
    }
  }
  if (threat) {
    const defenders = reserve.filter(
      (soldier) => !isEngaged(soldier) && !isMarching(soldier, threat.position),
    );
    attackMove(think, defenders, threat.position);
    return;
  }
  const rally = rallyPoint(think);
  const strays = reserve.filter(
    (soldier) =>
      isIdle(soldier) &&
      dist(soldier.position, rally) > RALLY_TOLERANCE &&
      !needsTransport(think, soldier, rally),
  );
  attackMove(think, strays, rally);
}

function healable(think: Think, unit: EntityView): boolean {
  const def = unitDef(think, unit);
  return (
    def !== undefined &&
    unit.hp < unit.maxHp * HEAL_RATIO &&
    !def.class.some((tag) => UNHEALABLE.includes(tag))
  );
}

function commandPriests(think: Think): void {
  if (think.priests.length === 0) {
    return;
  }
  const faithMax = think.know.modifiers.conversion.faithMax;
  const convertPriests = think.view.self.flags.convert_priests === true;
  const patients = [...think.soldiers, ...think.villagers, ...think.priests];
  const memberIds = new Set(think.state.army.members);
  const members = think.soldiers.filter((soldier) => memberIds.has(soldier.id));
  const anchor = centroid(members) ?? rallyPoint(think);
  for (const priest of think.priests) {
    const order = priest.own?.orders[0];
    if (order && (order.type === 'heal' || order.type === 'convert')) {
      continue;
    }
    const stats = unitStats(think.know, priest.type);
    const reach = (stats?.range ?? 0) + CONVERT_MARGIN;
    let patient: EntityView | null = null;
    for (const unit of patients) {
      if (unit.id === priest.id || !healable(think, unit)) {
        continue;
      }
      if (dist(unit.position, priest.position) > HEAL_RADIUS) {
        continue;
      }
      if (!patient || unit.hp / unit.maxHp < patient.hp / patient.maxHp) {
        patient = unit;
      }
    }
    if (patient) {
      think.commands.push({
        type: 'heal',
        playerId: think.me,
        entityIds: [priest.id],
        targetId: patient.id,
        queued: false,
      });
      continue;
    }
    if ((priest.own?.faith ?? faithMax) >= faithMax) {
      let convert: EntityView | null = null;
      let bestPower = 0;
      for (const enemy of think.enemyUnits) {
        const def = unitDef(think, enemy);
        if (!def || dist(enemy.position, priest.position) > reach) {
          continue;
        }
        if (def.class.includes('priest') && !convertPriests) {
          continue;
        }
        const power = unitPower(def) + 1;
        if (power > bestPower) {
          convert = enemy;
          bestPower = power;
        }
      }
      if (convert) {
        think.commands.push({
          type: 'convert',
          playerId: think.me,
          entityIds: [priest.id],
          targetId: convert.id,
          queued: false,
        });
        continue;
      }
    }
    if (isIdle(priest) && dist(priest.position, anchor) > PRIEST_FOLLOW && !needsTransport(think, priest, anchor)) {
      think.commands.push({
        type: 'move',
        playerId: think.me,
        entityIds: [priest.id],
        target: { x: anchor.x, y: anchor.y },
        queued: false,
      });
    }
  }
}

function trainPriests(think: Think): void {
  if (think.params.priests <= 0) {
    return;
  }
  for (const base of Object.values(think.data.units)) {
    if (!base.class.includes('priest') || base.building === null || !unitTrainable(think.know, base.id)) {
      continue;
    }
    const owned = think.priests.length + (think.queuedUnits[base.id] ?? 0);
    if (owned >= think.params.priests || populationRoom(think) <= 0) {
      return;
    }
    const stats = unitStats(think.know, base.id) ?? base;
    const building = think.buildings.find(
      (entry) =>
        entry.type === base.building &&
        entry.own !== null &&
        entry.own.research === null &&
        entry.own.queue.length === 0 &&
        !think.busy.has(entry.id),
    );
    if (!building || !canAfford(think, stats.cost)) {
      return;
    }
    think.commands.push({
      type: 'train',
      playerId: think.me,
      buildingId: building.id,
      unit: base.id,
      count: 1,
    });
    spend(think, stats.cost);
    think.queuedPopulation += base.population;
    think.busy.add(building.id);
    return;
  }
}

function isHopeless(think: Think): boolean {
  if (
    think.villagers.length > 0 ||
    think.soldiers.length > 0 ||
    think.warships.length > 0 ||
    think.priests.length > 0 ||
    think.transports.some((transport) => (transport.own?.cargo.length ?? 0) > 0)
  ) {
    return false;
  }
  const villager = think.data.units[think.data.game.start.unit];
  if (!villager) {
    return true;
  }
  if ((think.queuedUnits[villager.id] ?? 0) > 0) {
    return false;
  }
  const cost = (unitStats(think.know, villager.id) ?? villager).cost;
  return !(
    think.buildings.some((building) => building.type === villager.building) &&
    canAfford(think, cost, true)
  );
}

function isStalemate(think: Think): boolean {
  let total = 0;
  for (const player of think.view.players) {
    if (!player.defeated) {
      total += player.score;
    }
  }
  if (total !== think.state.scoreSeen) {
    think.state.scoreSeen = total;
    think.state.scoreTick = think.tick;
  }
  return think.tick - think.state.scoreTick > think.params.stalemateTicks;
}

function concede(think: Think): boolean {
  if (isHopeless(think)) {
    think.commands.push({ type: 'resign', playerId: think.me });
    return true;
  }
  const stalemate = isStalemate(think);
  if (!stalemate && think.tick - think.state.contactTick <= think.params.concedeTicks) {
    return false;
  }
  const mine = think.view.players[think.me]?.score ?? 0;
  for (const other of think.view.players) {
    if (other.id === think.me || other.defeated || !isHostile(think, other.id)) {
      continue;
    }
    if (other.score > mine || (other.score === mine && other.id < think.me)) {
      think.commands.push({ type: 'resign', playerId: think.me });
      return true;
    }
  }
  return false;
}

export function manageMilitary(think: Think, roster: Roster): void {
  if (concede(think)) {
    return;
  }
  trainArmy(think, roster);
  trainPriests(think);
  commandArmy(think);
  commandPriests(think);
}
