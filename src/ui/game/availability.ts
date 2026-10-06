import type {
  AgeId,
  BuildingDef,
  CivilizationDef,
  Cost,
  Effect,
  EffectTarget,
  GameData,
  ModifyCostEffect,
  ResourceKind,
  UnitDef,
} from '../../data/types';
import { AGE_ORDER, RESOURCE_KINDS } from '../../data/types';
import type { EntityView, PlayerView } from '../../sim/snapshot';

export type DisabledReason =
  | 'resources'
  | 'age'
  | 'prerequisite'
  | 'housing'
  | 'population_limit'
  | 'busy';

export interface Availability {
  reason: DisabledReason | null;
  blocked: boolean;
  resource: ResourceKind | null;
}

export type Requirement =
  | { kind: 'age'; age: AgeId }
  | { kind: 'building'; id: string }
  | { kind: 'technology'; id: string }
  | { kind: 'age_buildings'; count: number; buildings: readonly string[] };

export interface Offer {
  id: string;
  cost: Cost;
  availability: Availability;
  requires: readonly Requirement[];
}

const AVAILABLE: Availability = { reason: null, blocked: false, resource: null };

function unavailable(reason: DisabledReason, blocked = true, resource: ResourceKind | null = null): Availability {
  return { reason, blocked, resource };
}

export function viewerCivilization(view: PlayerView, data: GameData): CivilizationDef | null {
  const self = view.players.find((player) => player.id === view.playerId);
  return self ? (data.civilizations[self.civilization] ?? null) : null;
}

export function viewerRestrictions(view: PlayerView, data: GameData): CivilizationDef | null {
  return view.settings.fullTechTree === true ? null : viewerCivilization(view, data);
}

function conditionHolds(effect: Effect, researched: ReadonlySet<string>): boolean {
  const condition = effect.condition;
  if (!condition) {
    return true;
  }
  if (condition.hasTech !== undefined && !researched.has(condition.hasTech)) {
    return false;
  }
  return condition.lacksTech === undefined || !researched.has(condition.lacksTech);
}

function costEffects(view: PlayerView, data: GameData): ModifyCostEffect[] {
  const researched = new Set(view.self.researched);
  const effects: Effect[] = [...(viewerRestrictions(view, data)?.bonuses ?? [])];
  for (const id of view.self.researched) {
    effects.push(...(data.technologies[id]?.effects ?? []));
  }
  return effects.filter(
    (effect): effect is ModifyCostEffect =>
      effect.type === 'modify_cost' && conditionHolds(effect, researched),
  );
}

function targetsUnit(target: EffectTarget, def: UnitDef): boolean {
  return (
    (target.units?.includes(def.id) ?? false) ||
    (target.unitClasses?.some((tag) => def.class.includes(tag)) ?? false)
  );
}

function targetsBuilding(target: EffectTarget, def: BuildingDef): boolean {
  return (
    (target.buildings?.includes(def.id) ?? false) ||
    (target.buildingClasses?.some((tag) => def.class.includes(tag)) ?? false)
  );
}

function applyCostEffects(base: Cost, effects: readonly ModifyCostEffect[]): Cost {
  const cost: Cost = {};
  for (const kind of RESOURCE_KINDS) {
    let amount = base[kind] ?? 0;
    if (amount <= 0) {
      continue;
    }
    for (const effect of effects) {
      if (effect.resource !== undefined && effect.resource !== kind) {
        continue;
      }
      if (effect.op === 'add') {
        amount += effect.value;
      } else if (effect.op === 'multiply') {
        amount *= effect.value;
      } else {
        amount = effect.value;
      }
    }
    cost[kind] = Math.max(0, Math.round(amount));
  }
  return cost;
}

export function unitCost(view: PlayerView, data: GameData, def: UnitDef): Cost {
  return applyCostEffects(
    def.cost,
    costEffects(view, data).filter((effect) => targetsUnit(effect.target, def)),
  );
}

export function buildingCost(view: PlayerView, data: GameData, def: BuildingDef): Cost {
  return applyCostEffects(
    def.cost,
    costEffects(view, data).filter((effect) => targetsBuilding(effect.target, def)),
  );
}

export function missingResource(view: PlayerView, cost: Cost): ResourceKind | null {
  for (const kind of RESOURCE_KINDS) {
    if ((cost[kind] ?? 0) > view.self.resources[kind]) {
      return kind;
    }
  }
  return null;
}

function ageReached(view: PlayerView, age: AgeId): boolean {
  return AGE_ORDER.indexOf(view.self.age) >= AGE_ORDER.indexOf(age);
}

function missingAge(view: PlayerView, age: AgeId): Requirement[] {
  return ageReached(view, age) ? [] : [{ kind: 'age', age }];
}

function missingBuildings(ids: readonly string[], completed: ReadonlySet<string>): Requirement[] {
  return ids.filter((id) => !completed.has(id)).map((id) => ({ kind: 'building', id }));
}

function missingTechnologies(ids: readonly string[], researched: ReadonlySet<string>): Requirement[] {
  return ids.filter((id) => !researched.has(id)).map((id) => ({ kind: 'technology', id }));
}

export function isCompleted(entity: EntityView): boolean {
  return entity.buildProgress === null || entity.buildProgress >= 1;
}

export function ownedBuildingTypes(view: PlayerView, completedOnly = true): Set<string> {
  const types = new Set<string>();
  for (const entity of view.entities) {
    if (
      entity.kind === 'building' &&
      entity.owner === view.playerId &&
      (!completedOnly || isCompleted(entity))
    ) {
      types.add(entity.type);
    }
  }
  return types;
}

function successorIds<T extends { upgradesTo: string | null }>(defs: readonly T[]): Set<string> {
  const ids = new Set<string>();
  for (const def of defs) {
    if (def.upgradesTo !== null) {
      ids.add(def.upgradesTo);
    }
  }
  return ids;
}

export function buildableBuildings(view: PlayerView, data: GameData): Offer[] {
  const researched = new Set(view.self.researched);
  const disabledTechs = new Set(viewerRestrictions(view, data)?.disabledTechs ?? []);
  const completed = ownedBuildingTypes(view);
  const present = ownedBuildingTypes(view, false);
  const defs = Object.values(data.buildings);
  const successors = successorIds(defs);
  const unlocked = (def: BuildingDef): boolean =>
    def.requires.technologies.every((id) => researched.has(id));
  const offers: Offer[] = [];
  for (const def of defs) {
    if (def.requires.technologies.some((id) => disabledTechs.has(id))) {
      continue;
    }
    if (successors.has(def.id) && !unlocked(def)) {
      continue;
    }
    const next = def.upgradesTo === null ? undefined : data.buildings[def.upgradesTo];
    if (next && next.requires.technologies.length > 0 && unlocked(next)) {
      continue;
    }
    const cost = buildingCost(view, data, def);
    const missing = missingResource(view, cost);
    let availability = AVAILABLE;
    if (!ageReached(view, def.age)) {
      availability = unavailable('age');
    } else if (
      !unlocked(def) ||
      !def.requires.buildings.every((id) => completed.has(id)) ||
      (present.has(def.id) && !(def.requiresWhenOwned ?? []).every((id) => completed.has(id)))
    ) {
      availability = unavailable('prerequisite');
    } else if (missing !== null) {
      availability = unavailable('resources', true, missing);
    }
    const requires = [
      ...missingAge(view, def.age),
      ...missingTechnologies(def.requires.technologies, researched),
      ...missingBuildings(def.requires.buildings, completed),
      ...(present.has(def.id) ? missingBuildings(def.requiresWhenOwned ?? [], completed) : []),
    ];
    offers.push({ id: def.id, cost, availability, requires });
  }
  return offers;
}

export function trainableUnits(buildingType: string, view: PlayerView, data: GameData): Offer[] {
  const researched = new Set(view.self.researched);
  const civilization = viewerRestrictions(view, data);
  const disabledUnits = new Set(civilization?.disabledUnits ?? []);
  const disabledTechs = new Set(civilization?.disabledTechs ?? []);
  const defs = Object.values(data.units).filter((def) => def.building === buildingType);
  const successors = successorIds(Object.values(data.units));
  const unlocked = (def: UnitDef): boolean => !def.requiresTech || researched.has(def.requiresTech);
  const offers: Offer[] = [];
  for (const def of defs) {
    if (disabledUnits.has(def.id) || (def.requiresTech && disabledTechs.has(def.requiresTech))) {
      continue;
    }
    if (successors.has(def.id) && !unlocked(def)) {
      continue;
    }
    const next = def.upgradesTo === null ? undefined : data.units[def.upgradesTo];
    if (next && next.requiresTech && unlocked(next) && !disabledUnits.has(next.id)) {
      continue;
    }
    const cost = unitCost(view, data, def);
    const missing = missingResource(view, cost);
    let availability = AVAILABLE;
    if (!ageReached(view, def.age)) {
      availability = unavailable('age');
    } else if (!unlocked(def)) {
      availability = unavailable('prerequisite');
    } else if (missing !== null) {
      availability = unavailable('resources', true, missing);
    } else if (view.self.population + def.population > view.self.populationLimit) {
      availability = unavailable('population_limit', false);
    } else if (view.self.population + def.population > view.self.housing) {
      availability = unavailable('housing', false);
    }
    const requires = [
      ...missingAge(view, def.age),
      ...missingTechnologies(def.requiresTech ? [def.requiresTech] : [], researched),
    ];
    offers.push({ id: def.id, cost, availability, requires });
  }
  return offers;
}

function inProgressTechs(view: PlayerView): Set<string> {
  const ids = new Set<string>();
  for (const entity of view.entities) {
    if (entity.own?.research) {
      ids.add(entity.own.research.technology);
    }
  }
  return ids;
}

function ageRuleSatisfied(technology: string, view: PlayerView, data: GameData): boolean {
  const rule = data.game.ages.find((age) => age.technology === technology);
  if (!rule) {
    return true;
  }
  const completed = ownedBuildingTypes(view);
  const count = rule.qualifyingBuildings.filter((id) => completed.has(id)).length;
  return count >= rule.requiredBuildingCount;
}

function missingAgeBuildings(technology: string, view: PlayerView, data: GameData): Requirement[] {
  const rule = data.game.ages.find((age) => age.technology === technology);
  if (!rule || ageRuleSatisfied(technology, view, data)) {
    return [];
  }
  return [
    { kind: 'age_buildings', count: rule.requiredBuildingCount, buildings: rule.qualifyingBuildings },
  ];
}

export function researchableTechs(building: EntityView, view: PlayerView, data: GameData): Offer[] {
  const researched = new Set(view.self.researched);
  const disabledTechs = new Set(viewerRestrictions(view, data)?.disabledTechs ?? []);
  const inProgress = inProgressTechs(view);
  const busy = building.own?.research != null;
  const offers: Offer[] = [];
  for (const def of Object.values(data.technologies)) {
    if (def.building !== building.type || researched.has(def.id) || inProgress.has(def.id)) {
      continue;
    }
    if (disabledTechs.has(def.id) || def.requires.some((id) => disabledTechs.has(id))) {
      continue;
    }
    const missing = missingResource(view, def.cost);
    let availability = AVAILABLE;
    if (!ageReached(view, def.age)) {
      availability = unavailable('age');
    } else if (
      !def.requires.every((id) => researched.has(id)) ||
      !ageRuleSatisfied(def.id, view, data)
    ) {
      availability = unavailable('prerequisite');
    } else if (busy) {
      availability = unavailable('busy');
    } else if (missing !== null) {
      availability = unavailable('resources', true, missing);
    }
    const requires = [
      ...missingAge(view, def.age),
      ...missingTechnologies(def.requires, researched),
      ...missingAgeBuildings(def.id, view, data),
    ];
    offers.push({ id: def.id, cost: def.cost, availability, requires });
  }
  return offers;
}
