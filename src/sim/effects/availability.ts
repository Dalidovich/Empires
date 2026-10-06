import { loadGameData } from '../../data';
import type { Cost, GameData, ResourceKind } from '../../data/types';
import { RESOURCE_KINDS } from '../../data/types';
import type { Entity, GameState, Player, PlayerId } from '../types';
import {
  ageIndex,
  modifiedBuilding,
  modifiedUnit,
  modifiersOf,
  restrictionsOf,
  upgradedBuildingType,
  upgradedUnitType,
} from './modifiers';

export type ActionBlockReason =
  | 'resources'
  | 'age'
  | 'prerequisite'
  | 'housing'
  | 'population_limit'
  | 'busy'
  | 'unavailable';

export type ActionKind = 'train' | 'build' | 'research';

export interface AvailableAction {
  kind: ActionKind;
  id: string;
  enabled: boolean;
  reason: ActionBlockReason | null;
  cost: Cost;
  time: number;
}

export interface OwnedBuildings {
  complete: Record<string, number>;
  total: Record<string, number>;
  researching: string[];
}

export const MAX_QUEUE_LENGTH = 30;

export function missingResource(player: Player, cost: Cost): ResourceKind | null {
  for (const resource of RESOURCE_KINDS) {
    if (player.resources[resource] < (cost[resource] ?? 0)) {
      return resource;
    }
  }
  return null;
}

export function payCost(player: Player, cost: Cost): void {
  for (const resource of RESOURCE_KINDS) {
    player.resources[resource] -= cost[resource] ?? 0;
  }
}

export function refundCost(player: Player | undefined, cost: Cost | null): void {
  if (!player || !cost) {
    return;
  }
  for (const resource of RESOURCE_KINDS) {
    player.resources[resource] += cost[resource] ?? 0;
  }
}

export function hasTechnology(player: Player, technology: string, data: GameData): boolean {
  if (player.researched.includes(technology)) {
    return true;
  }
  const reached = ageIndex(player.age);
  for (const rule of data.game.ages) {
    if (rule.technology === technology && ageIndex(rule.id) <= reached) {
      return true;
    }
  }
  return false;
}

export function ownedBuildings(state: GameState, playerId: PlayerId): OwnedBuildings {
  const owned: OwnedBuildings = { complete: {}, total: {}, researching: [] };
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'building' || entity.owner !== playerId) {
      continue;
    }
    owned.total[entity.type] = (owned.total[entity.type] ?? 0) + 1;
    if (entity.buildProgress === 1) {
      owned.complete[entity.type] = (owned.complete[entity.type] ?? 0) + 1;
    }
    if (entity.research) {
      owned.researching.push(entity.research.technology);
    }
  }
  return owned;
}

export function resolveUnitType(player: Player, type: string, data: GameData): string {
  return upgradedUnitType(modifiersOf(player, data), type);
}

export function resolveBuildingType(player: Player, type: string, data: GameData): string {
  return upgradedBuildingType(modifiersOf(player, data), type);
}

export function unitBlockReason(
  player: Player,
  unitId: string,
  data: GameData,
): ActionBlockReason | null {
  const def = data.units[unitId];
  const modifiers = modifiersOf(player, data);
  if (!def || def.building === null || modifiers.unitUpgrades[unitId] !== undefined) {
    return 'unavailable';
  }
  if (restrictionsOf(player, data)?.disabledUnits.includes(unitId)) {
    return 'unavailable';
  }
  if (ageIndex(player.age) < ageIndex(def.age)) {
    return 'age';
  }
  const required = def.requiresTech ?? null;
  if (
    required !== null &&
    !hasTechnology(player, required, data) &&
    !modifiers.enabledUnits.includes(unitId)
  ) {
    return 'prerequisite';
  }
  return null;
}

export function buildingBlockReason(
  player: Player,
  buildingId: string,
  owned: OwnedBuildings,
  data: GameData,
): ActionBlockReason | null {
  const def = data.buildings[buildingId];
  const modifiers = modifiersOf(player, data);
  if (!def || modifiers.buildingUpgrades[buildingId] !== undefined) {
    return 'unavailable';
  }
  if (ageIndex(player.age) < ageIndex(def.age)) {
    return 'age';
  }
  if (!modifiers.enabledBuildings.includes(buildingId)) {
    for (const technology of def.requires.technologies) {
      if (!hasTechnology(player, technology, data)) {
        return 'prerequisite';
      }
    }
  }
  for (const required of def.requires.buildings) {
    if ((owned.complete[required] ?? 0) === 0) {
      return 'prerequisite';
    }
  }
  if ((owned.total[buildingId] ?? 0) > 0) {
    for (const required of def.requiresWhenOwned ?? []) {
      if ((owned.complete[required] ?? 0) === 0) {
        return 'prerequisite';
      }
    }
  }
  return null;
}

export function technologyBlockReason(
  player: Player,
  technologyId: string,
  owned: OwnedBuildings,
  data: GameData,
): ActionBlockReason | null {
  const def = data.technologies[technologyId];
  if (!def || hasTechnology(player, technologyId, data)) {
    return 'unavailable';
  }
  if (restrictionsOf(player, data)?.disabledTechs.includes(technologyId)) {
    return 'unavailable';
  }
  if (owned.researching.includes(technologyId)) {
    return 'busy';
  }
  if (ageIndex(player.age) < ageIndex(def.age)) {
    return 'age';
  }
  for (const required of def.requires) {
    if (!hasTechnology(player, required, data)) {
      return 'prerequisite';
    }
  }
  for (const rule of data.game.ages) {
    if (rule.technology !== technologyId) {
      continue;
    }
    let qualifying = 0;
    for (const building of rule.qualifyingBuildings) {
      if ((owned.complete[building] ?? 0) > 0) {
        qualifying += 1;
      }
    }
    if (qualifying < rule.requiredBuildingCount) {
      return 'prerequisite';
    }
  }
  return null;
}

export function populationCap(state: GameState, player: Player): number {
  return Math.min(player.housing, state.settings.populationLimit);
}

export function housingBlockReason(
  state: GameState,
  player: Player,
  population: number,
): ActionBlockReason | null {
  if (population > state.settings.populationLimit) {
    return 'population_limit';
  }
  return population > player.housing ? 'housing' : null;
}

export function refreshBuildingState(building: Entity): void {
  if (building.kind !== 'building' || building.buildProgress !== 1) {
    return;
  }
  if (building.queue.length > 0 || building.research !== null) {
    building.state = 'producing';
  } else if (building.state === 'producing') {
    building.state = 'idle';
  }
}

function isUpgradeTarget(defs: Readonly<Record<string, { upgradesTo: string | null }>>, id: string): boolean {
  for (const def of Object.values(defs)) {
    if (def.upgradesTo === id) {
      return true;
    }
  }
  return false;
}

function action(
  kind: ActionKind,
  id: string,
  reason: ActionBlockReason | null,
  cost: Cost,
  time: number,
  advisory = false,
): AvailableAction {
  return { kind, id, enabled: reason === null || advisory, reason, cost, time };
}

function buildingActions(
  state: GameState,
  player: Player,
  building: Entity,
  data: GameData,
): AvailableAction[] {
  const actions: AvailableAction[] = [];
  const modifiers = modifiersOf(player, data);
  const civilization = restrictionsOf(player, data);
  const owned = ownedBuildings(state, player.id);
  const researching = building.research !== null;
  for (const def of Object.values(data.units)) {
    if (def.building !== building.type || modifiers.unitUpgrades[def.id] !== undefined) {
      continue;
    }
    if (civilization?.disabledUnits.includes(def.id)) {
      continue;
    }
    const required = def.requiresTech ?? null;
    if (
      required !== null &&
      !hasTechnology(player, required, data) &&
      isUpgradeTarget(data.units, def.id)
    ) {
      continue;
    }
    let reason = unitBlockReason(player, def.id, data);
    const stats = modifiedUnit(modifiers, def);
    let advisory = false;
    if (reason === null && (researching || building.queue.length >= MAX_QUEUE_LENGTH)) {
      reason = 'busy';
    }
    if (reason === null && missingResource(player, stats.cost) !== null) {
      reason = 'resources';
    }
    if (reason === null) {
      reason = housingBlockReason(state, player, player.population + def.population);
      advisory = reason !== null;
    }
    actions.push(action('train', def.id, reason, stats.cost, stats.trainTime, advisory));
  }
  for (const def of Object.values(data.technologies)) {
    if (def.building !== building.type || hasTechnology(player, def.id, data)) {
      continue;
    }
    if (civilization?.disabledTechs.includes(def.id)) {
      continue;
    }
    let reason = technologyBlockReason(player, def.id, owned, data);
    if (reason === null && (researching || building.queue.length > 0)) {
      reason = 'busy';
    }
    if (reason === null && missingResource(player, def.cost) !== null) {
      reason = 'resources';
    }
    actions.push(action('research', def.id, reason, def.cost, def.researchTime));
  }
  return actions;
}

function builderActions(state: GameState, player: Player, data: GameData): AvailableAction[] {
  const actions: AvailableAction[] = [];
  const modifiers = modifiersOf(player, data);
  const owned = ownedBuildings(state, player.id);
  for (const def of Object.values(data.buildings)) {
    if (modifiers.buildingUpgrades[def.id] !== undefined) {
      continue;
    }
    const unlocked = def.requires.technologies.every((technology) =>
      hasTechnology(player, technology, data),
    );
    if (!unlocked && isUpgradeTarget(data.buildings, def.id)) {
      continue;
    }
    let reason = buildingBlockReason(player, def.id, owned, data);
    const stats = modifiedBuilding(modifiers, def);
    if (reason === null && missingResource(player, stats.cost) !== null) {
      reason = 'resources';
    }
    actions.push(action('build', def.id, reason, stats.cost, stats.buildTime));
  }
  return actions;
}

export function availableActions(
  state: GameState,
  playerId: PlayerId,
  entity: Entity,
  data: GameData = loadGameData(),
): AvailableAction[] {
  const player = state.players[playerId];
  if (!player || entity.owner !== playerId) {
    return [];
  }
  if (entity.kind === 'building') {
    return entity.buildProgress === 1 ? buildingActions(state, player, entity, data) : [];
  }
  if (entity.kind === 'unit' && data.units[entity.type]?.class.includes('villager')) {
    return builderActions(state, player, data);
  }
  return [];
}
