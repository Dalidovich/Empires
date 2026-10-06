import type { BuildingDef, Effect, TechnologyDef } from '../data/types';
import { ageIndex, targetsUnit } from '../sim/effects/modifiers';
import type { EntityView } from '../sim/snapshot';
import type { Think } from './context';
import { canAfford, reserve, spend } from './context';
import { ageVillagerTarget, isWoodScarce, placeDropOff } from './economy';
import {
  buildingAvailable,
  buildingStats,
  costTotal,
  currentUnitType,
  nextAgeTechnology,
  techAllowed,
  techAvailable,
} from './knowledge';
import { findDockSite, findLandSite, placeBuilding } from './placement';
import type { Roster } from './roster';
import { ROLES } from './roster';

const BASE_RADIUS = 18;
const MIN_BASE_RADIUS = 4;
const WONDER_BUILDERS = 5;
const LARGE_BUILD_TIME = 60;
const MAX_RESEARCH_PER_THINK = 2;
const ECONOMY_SCORE = 100;
const UNLOCK_SCORE = 95;
const UPGRADE_SCORE = 85;
const STAT_SCORE = 70;
const NAVAL_SCORE = 55;
const PRIEST_SCORE = 40;
const COST_PENALTY = 1 / 40;
const SECOND_PRODUCTION_AGGRESSIVENESS = 0.7;
const DROP_OFF_USEFULNESS = 3.5;

export function isWaterMap(think: Think): boolean {
  return think.layout !== 'land';
}

function idleBuildings(think: Think, type: string): EntityView[] {
  return think.buildings.filter(
    (building) =>
      building.type === type &&
      building.own !== null &&
      building.own.research === null &&
      building.own.queue.length === 0,
  );
}

export function planAgeAdvance(think: Think): void {
  const technology = nextAgeTechnology(think.know);
  if (!technology || think.researching.includes(technology.id)) {
    return;
  }
  if (!techAvailable(think.know, technology.id, think.complete, think.researching)) {
    return;
  }
  if (!canAfford(think, technology.cost)) {
    return;
  }
  think.holdTownCenter = true;
  const building = idleBuildings(think, technology.building)[0];
  if (!building) {
    return;
  }
  think.commands.push({
    type: 'research',
    playerId: think.me,
    buildingId: building.id,
    technology: technology.id,
  });
  think.researching.push(technology.id);
  spend(think, technology.cost);
}

function reserveAgeAdvance(think: Think): void {
  const technology = nextAgeTechnology(think.know);
  if (!technology || think.researching.includes(technology.id)) {
    return;
  }
  if (think.villagers.length < ageVillagerTarget(think) - 1) {
    return;
  }
  const available = techAvailable(think.know, technology.id, think.complete, think.researching);
  const blocked =
    !available &&
    (isWoodScarce(think) || think.tick - think.state.ageTick > think.params.stallTicks);
  if (!blocked) {
    reserve(think, technology.cost);
  }
}

function ownedOrPending(think: Think, type: string): number {
  let count = think.total[type] ?? 0;
  for (const intent of think.state.intents) {
    if (intent.building === type) {
      count += 1;
    }
  }
  return count;
}

function buildableSomeday(think: Think, def: BuildingDef): boolean {
  if (think.know.modifiers.buildingUpgrades[def.id] !== undefined) {
    return false;
  }
  if (def.placement === 'shore' && !isWaterMap(think)) {
    return false;
  }
  return think.know.age >= ageIndex(def.age);
}

function pushChain(think: Think, wants: string[], id: string, depth = 0): void {
  const def = think.data.buildings[id];
  if (!def || depth > 6 || !buildableSomeday(think, def)) {
    return;
  }
  for (const required of def.requires.buildings) {
    if ((think.complete[required] ?? 0) === 0) {
      pushChain(think, wants, required, depth + 1);
    }
  }
  if (!wants.includes(id)) {
    wants.push(id);
  }
}

function usefulness(think: Think, def: BuildingDef, roster: Roster): number {
  let score = -costTotal(def.cost) / 1000;
  for (const role of ROLES) {
    if (roster[role]?.building === def.id) {
      score += 3;
    }
  }
  if (def.dropOff.length > 0) {
    score += DROP_OFF_USEFULNESS;
  }
  for (const other of Object.values(think.data.buildings)) {
    if (other.class.includes('farm') && other.requires.buildings.includes(def.id)) {
      score += 3;
    }
  }
  if (def.placement === 'shore') {
    score += think.layout === 'islands' ? 4 : 0.5;
  }
  return score;
}

function wantedBuildings(think: Think, roster: Roster): string[] {
  const wants: string[] = [];
  const start = think.data.game.start.building;
  if (ownedOrPending(think, start) === 0) {
    wants.push(start);
  }
  for (const def of Object.values(think.data.buildings)) {
    if (def.class.includes('farm')) {
      for (const required of def.requires.buildings) {
        pushChain(think, wants, required);
      }
    }
  }
  const rule = think.data.game.ages[think.know.age + 1];
  if (rule) {
    const owned = rule.qualifyingBuildings.filter((id) => ownedOrPending(think, id) > 0);
    const missing = rule.qualifyingBuildings
      .map((id) => think.data.buildings[id])
      .filter(
        (def): def is BuildingDef =>
          def !== undefined && !owned.includes(def.id) && buildableSomeday(think, def),
      )
      .sort(
        (a, b) =>
          usefulness(think, b, roster) - usefulness(think, a, roster) || (a.id < b.id ? -1 : 1),
      );
    for (const def of missing.slice(0, Math.max(0, rule.requiredBuildingCount - owned.length))) {
      pushChain(think, wants, def.id);
    }
  }
  if (think.layout === 'islands') {
    for (const def of Object.values(think.data.buildings)) {
      if (def.class.includes('dock')) {
        pushChain(think, wants, def.id);
      }
    }
  }
  const scarce = isWoodScarce(think);
  for (const role of ROLES) {
    const entry = roster[role];
    if (entry && (!scarce || role === 'melee' || (think.total[entry.building] ?? 0) > 0)) {
      pushChain(think, wants, entry.building);
    }
  }
  if (isWaterMap(think) && think.know.age >= 1) {
    for (const def of Object.values(think.data.buildings)) {
      if (def.class.includes('dock')) {
        pushChain(think, wants, def.id);
      }
    }
  }
  if (scarce) {
    return wants;
  }
  if (think.know.age >= 1) {
    for (const def of Object.values(think.data.buildings)) {
      if (def.dropOff.length > 0 && def.placement === 'land' && !def.class.includes('town_center')) {
        pushChain(think, wants, def.id);
      }
    }
  }
  if (think.params.priests > 0) {
    for (const def of Object.values(think.data.buildings)) {
      if (def.class.includes('temple')) {
        pushChain(think, wants, def.id);
      }
    }
  }
  if (nextAgeTechnology(think.know) === null) {
    for (const technology of Object.values(think.data.technologies)) {
      if (techAllowed(think.know, technology.id) && scoreTechnology(think, technology, roster) > 0) {
        pushChain(think, wants, technology.building);
      }
    }
  }
  return wants;
}

function desiredCount(think: Think, id: string, roster: Roster): number {
  if (
    think.know.age >= 2 &&
    !isWoodScarce(think) &&
    think.level.aggressiveness >= SECOND_PRODUCTION_AGGRESSIVENESS &&
    roster.melee?.building === id
  ) {
    return 2;
  }
  return 1;
}

function placePlanned(think: Think, id: string): boolean {
  const def = think.data.buildings[id];
  if (!def) {
    return false;
  }
  if (def.placement === 'shore') {
    const site = findDockSite(think, id);
    return site !== null && placeBuilding(think, id, site, 1);
  }
  if (def.dropOff.length > 0 && !def.class.includes('town_center')) {
    return placeDropOff(think, id, true);
  }
  const wonder = def.class.includes('wonder');
  const site = findLandSite(think, id, {
    anchor: think.home,
    minRadius: MIN_BASE_RADIUS,
    maxRadius: BASE_RADIUS,
    gap: 1,
    maxSolidRing: 4,
  });
  const builders = wonder ? WONDER_BUILDERS : def.buildTime >= LARGE_BUILD_TIME ? 2 : 1;
  return site !== null && placeBuilding(think, id, site, builders);
}

function isPlanFoundation(think: Think, foundation: EntityView): boolean {
  const def = think.data.buildings[foundation.type];
  return def !== undefined && !def.class.includes('house') && !def.class.includes('farm');
}

function buildPlanned(think: Think, roster: Roster): void {
  let active = 0;
  for (const foundation of think.foundations) {
    if (isPlanFoundation(think, foundation)) {
      active += 1;
    }
  }
  for (const intent of think.state.intents) {
    const def = think.data.buildings[intent.building];
    if (def && !def.class.includes('house') && !def.class.includes('farm')) {
      active += 1;
    }
  }
  for (const id of wantedBuildings(think, roster)) {
    if (ownedOrPending(think, id) >= desiredCount(think, id, roster)) {
      continue;
    }
    if (active >= think.params.concurrentBuildings) {
      return;
    }
    if (!buildingAvailable(think.know, id, think.complete, think.total)) {
      continue;
    }
    const stats = buildingStats(think.know, id);
    if (!stats) {
      continue;
    }
    if (!canAfford(think, stats.cost, true)) {
      reserve(think, stats.cost);
      return;
    }
    if (placePlanned(think, id)) {
      active += 1;
      think.plannedBuildings += 1;
    }
  }
}

function buildWonder(think: Think): void {
  if (
    think.view.settings.victoryMode !== 'standard' ||
    think.params.wonder <= 0 ||
    nextAgeTechnology(think.know) !== null
  ) {
    return;
  }
  for (const def of Object.values(think.data.buildings)) {
    if (!def.class.includes('wonder') || ownedOrPending(think, def.id) > 0) {
      continue;
    }
    const stats = buildingStats(think.know, def.id);
    if (
      stats &&
      buildingAvailable(think.know, def.id, think.complete, think.total) &&
      canAfford(think, stats.cost)
    ) {
      placePlanned(think, def.id);
    }
    return;
  }
}

function rosterUnits(think: Think, roster: Roster): string[] {
  const units: string[] = [];
  for (const soldier of think.soldiers) {
    if (!units.includes(soldier.type)) {
      units.push(soldier.type);
    }
  }
  for (const role of ROLES) {
    const entry = roster[role];
    if (entry) {
      units.push(entry.unit, currentUnitType(think.know, entry.unit));
    }
  }
  return units;
}

function effectScore(think: Think, effect: Effect, roster: Roster, units: readonly string[]): number {
  switch (effect.type) {
    case 'modify_gather_rate':
    case 'modify_carry_capacity':
    case 'modify_farm_food':
      return ECONOMY_SCORE;
    case 'enable_unit':
      return ROLES.some((role) => roster[role]?.unlock !== null && roster[role]?.unit === effect.unit)
        ? UNLOCK_SCORE
        : 0;
    case 'upgrade_unit': {
      if (units.includes(effect.from)) {
        return UPGRADE_SCORE;
      }
      const from = think.data.units[effect.from];
      if (from && from.class.includes('ship') && isWaterMap(think)) {
        return NAVAL_SCORE;
      }
      return 0;
    }
    case 'modify_stat':
    case 'modify_attack_bonus':
    case 'modify_cost': {
      for (const id of units) {
        const def = think.data.units[id];
        if (def && targetsUnit(effect.target, def)) {
          return STAT_SCORE;
        }
      }
      if (think.priests.length > 0 && (effect.target.unitClasses?.includes('priest') ?? false)) {
        return PRIEST_SCORE;
      }
      return 0;
    }
    case 'modify_conversion':
      return think.priests.length > 0 ? PRIEST_SCORE : 0;
    default:
      return 0;
  }
}

export function scoreTechnology(think: Think, technology: TechnologyDef, roster: Roster): number {
  const units = rosterUnits(think, roster);
  let best = 0;
  for (const effect of technology.effects) {
    if (effect.type === 'advance_age') {
      return 0;
    }
    best = Math.max(best, effectScore(think, effect, roster, units));
  }
  if (best <= 0) {
    return 0;
  }
  return Math.max(1, best - costTotal(technology.cost) * COST_PENALTY);
}

function research(think: Think, roster: Roster): void {
  const scarce = isWoodScarce(think);
  let started = 0;
  const candidates: { technology: TechnologyDef; score: number }[] = [];
  for (const technology of Object.values(think.data.technologies)) {
    if (!techAvailable(think.know, technology.id, think.complete, think.researching)) {
      continue;
    }
    const score = scoreTechnology(think, technology, roster);
    if (score > 0) {
      candidates.push({ technology, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || (a.technology.id < b.technology.id ? -1 : 1));
  const used = new Set<number>();
  for (const { technology } of candidates) {
    if (started >= MAX_RESEARCH_PER_THINK) {
      return;
    }
    if (!canAfford(think, technology.cost)) {
      continue;
    }
    if (scarce && (technology.cost.wood ?? 0) > 0) {
      continue;
    }
    const building = idleBuildings(think, technology.building).find((entry) => !used.has(entry.id));
    if (!building) {
      continue;
    }
    if (think.holdTownCenter && building.type === think.data.game.start.building) {
      continue;
    }
    used.add(building.id);
    think.commands.push({
      type: 'research',
      playerId: think.me,
      buildingId: building.id,
      technology: technology.id,
    });
    think.researching.push(technology.id);
    think.busy.add(building.id);
    spend(think, technology.cost);
    started += 1;
  }
}

export function manageStrategy(think: Think, roster: Roster): void {
  reserveAgeAdvance(think);
  buildPlanned(think, roster);
  research(think, roster);
  buildWonder(think);
}
