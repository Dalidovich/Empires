import type {
  BuildingDef,
  CivilizationDef,
  Cost,
  GameData,
  TechnologyDef,
  UnitDef,
} from '../data/types';
import type { PlayerModifierSet } from '../sim/effects/modifiers';
import {
  ageIndex,
  compileModifiers,
  modifiedBuilding,
  modifiedUnit,
  upgradedBuildingType,
  upgradedUnitType,
} from '../sim/effects/modifiers';
import type { PlayerView } from '../sim/snapshot';

export type Counts = Record<string, number>;

export interface Knowledge {
  data: GameData;
  civilization: CivilizationDef | undefined;
  modifiers: PlayerModifierSet;
  age: number;
  researched: ReadonlySet<string>;
}

export function createKnowledge(view: PlayerView, data: GameData): Knowledge {
  const own = data.civilizations[view.players[view.playerId]?.civilization ?? ''];
  const fullTechTree = view.settings.fullTechTree === true;
  return {
    data,
    civilization: fullTechTree ? undefined : own,
    modifiers: compileModifiers(own?.id ?? '', view.self.researched, data, fullTechTree),
    age: ageIndex(view.self.age),
    researched: new Set(view.self.researched),
  };
}

export function hasTech(know: Knowledge, technology: string): boolean {
  if (know.researched.has(technology)) {
    return true;
  }
  for (const rule of know.data.game.ages) {
    if (rule.technology === technology && ageIndex(rule.id) <= know.age) {
      return true;
    }
  }
  return false;
}

export function unitStats(know: Knowledge, id: string): UnitDef | null {
  const def = know.data.units[id];
  return def ? modifiedUnit(know.modifiers, def) : null;
}

export function buildingStats(know: Knowledge, id: string): BuildingDef | null {
  const def = know.data.buildings[id];
  return def ? modifiedBuilding(know.modifiers, def) : null;
}

export function currentUnitType(know: Knowledge, id: string): string {
  return upgradedUnitType(know.modifiers, id);
}

export function currentBuildingType(know: Knowledge, id: string): string {
  return upgradedBuildingType(know.modifiers, id);
}

export function techAllowed(know: Knowledge, id: string): boolean {
  return (
    know.data.technologies[id] !== undefined &&
    !(know.civilization?.disabledTechs.includes(id) ?? false)
  );
}

export function unitAllowed(know: Knowledge, id: string): boolean {
  const def = know.data.units[id];
  return (
    def !== undefined &&
    def.building !== null &&
    !(know.civilization?.disabledUnits.includes(id) ?? false)
  );
}

export function unitTrainable(know: Knowledge, id: string): boolean {
  const def = know.data.units[id];
  if (!def || !unitAllowed(know, id) || know.modifiers.unitUpgrades[id] !== undefined) {
    return false;
  }
  if (know.age < ageIndex(def.age)) {
    return false;
  }
  const required = def.requiresTech ?? null;
  return (
    required === null || hasTech(know, required) || know.modifiers.enabledUnits.includes(id)
  );
}

export function buildingAvailable(
  know: Knowledge,
  id: string,
  complete: Counts,
  total: Counts,
): boolean {
  const def = know.data.buildings[id];
  if (!def || know.modifiers.buildingUpgrades[id] !== undefined) {
    return false;
  }
  if (know.age < ageIndex(def.age)) {
    return false;
  }
  if (!know.modifiers.enabledBuildings.includes(id)) {
    for (const technology of def.requires.technologies) {
      if (!hasTech(know, technology)) {
        return false;
      }
    }
  }
  for (const required of def.requires.buildings) {
    if ((complete[required] ?? 0) === 0) {
      return false;
    }
  }
  if ((total[id] ?? 0) > 0) {
    for (const required of def.requiresWhenOwned ?? []) {
      if ((complete[required] ?? 0) === 0) {
        return false;
      }
    }
  }
  return true;
}

export function ageRuleMet(know: Knowledge, technology: string, complete: Counts): boolean {
  for (const rule of know.data.game.ages) {
    if (rule.technology !== technology) {
      continue;
    }
    let qualifying = 0;
    for (const building of rule.qualifyingBuildings) {
      if ((complete[building] ?? 0) > 0) {
        qualifying += 1;
      }
    }
    if (qualifying < rule.requiredBuildingCount) {
      return false;
    }
  }
  return true;
}

export function techAvailable(
  know: Knowledge,
  id: string,
  complete: Counts,
  researching: readonly string[],
): boolean {
  const def = know.data.technologies[id];
  if (!def || hasTech(know, id) || !techAllowed(know, id) || researching.includes(id)) {
    return false;
  }
  if (know.age < ageIndex(def.age)) {
    return false;
  }
  for (const required of def.requires) {
    if (!hasTech(know, required)) {
      return false;
    }
  }
  return ageRuleMet(know, id, complete);
}

export function nextAgeTechnology(know: Knowledge): TechnologyDef | null {
  const rule = know.data.game.ages[know.age + 1];
  if (!rule || rule.technology === null) {
    return null;
  }
  return know.data.technologies[rule.technology] ?? null;
}

export function costTotal(cost: Cost): number {
  return (cost.food ?? 0) + (cost.wood ?? 0) + (cost.stone ?? 0) + (cost.gold ?? 0);
}
