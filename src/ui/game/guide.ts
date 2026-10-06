import type { AgeId, AgeRule, Cost, GameData } from '../../data/types';
import { AGE_ORDER } from '../../data/types';
import type { PlayerView } from '../../sim/snapshot';
import { buildingCost, ownedBuildingTypes, unitCost, viewerRestrictions } from './availability';

export type GuideKind = 'building' | 'unit' | 'technology';

export const GUIDE_KINDS: readonly GuideKind[] = ['building', 'unit', 'technology'];

export interface GuideRef {
  kind: GuideKind;
  id: string;
}

export interface GuideChoice {
  count: number;
  buildings: readonly string[];
  owned: readonly string[];
}

export interface GuideStep {
  ref: GuideRef;
  age: AgeId;
  location: GuideRef | null;
  cost: Cost;
  done: boolean;
  advancesTo: AgeId | null;
  choice: GuideChoice | null;
}

export interface GuideChain {
  steps: GuideStep[];
  blocked: boolean;
  ready: boolean;
}

export interface GuideUnlocks {
  trains: GuideRef[];
  researches: GuideRef[];
  unlocks: GuideRef[];
}

export function refKey(ref: GuideRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function sameRef(a: GuideRef | null, b: GuideRef | null): boolean {
  return a !== null && b !== null && a.kind === b.kind && a.id === b.id;
}

export function guideEntries(data: GameData): GuideRef[] {
  const entries: GuideRef[] = [];
  for (const def of Object.values(data.buildings)) {
    entries.push({ kind: 'building', id: def.id });
  }
  for (const def of Object.values(data.units)) {
    if (def.building !== null) {
      entries.push({ kind: 'unit', id: def.id });
    }
  }
  for (const def of Object.values(data.technologies)) {
    entries.push({ kind: 'technology', id: def.id });
  }
  return entries;
}

function ageRuleOf(data: GameData, technology: string): AgeRule | undefined {
  return data.game.ages.find((rule) => rule.technology === technology);
}

function builderOf(data: GameData): GuideRef | null {
  const builder = Object.values(data.units).find((def) => def.class.includes('villager'));
  return builder ? { kind: 'unit', id: builder.id } : null;
}

function ownAge(data: GameData, ref: GuideRef): AgeId {
  switch (ref.kind) {
    case 'building':
      return data.buildings[ref.id]?.age ?? 'stone';
    case 'unit':
      return data.units[ref.id]?.age ?? 'stone';
    default:
      return data.technologies[ref.id]?.age ?? 'stone';
  }
}

export function guideDependencies(data: GameData, ref: GuideRef): GuideRef[] {
  const deps: GuideRef[] = [];
  const ageTechnology = data.game.ages.find((rule) => rule.id === ownAge(data, ref))?.technology ?? null;
  if (ageTechnology !== null) {
    deps.push({ kind: 'technology', id: ageTechnology });
  }
  const technologies = (ids: readonly string[]): void => {
    deps.push(...ids.map((id): GuideRef => ({ kind: 'technology', id })));
  };
  const buildings = (ids: readonly string[]): void => {
    deps.push(...ids.map((id): GuideRef => ({ kind: 'building', id })));
  };
  if (ref.kind === 'building') {
    const def = data.buildings[ref.id];
    technologies(def?.requires.technologies ?? []);
    buildings(def?.requires.buildings ?? []);
  } else if (ref.kind === 'unit') {
    const def = data.units[ref.id];
    buildings(def?.building ? [def.building] : []);
    technologies(def?.requiresTech ? [def.requiresTech] : []);
  } else {
    const def = data.technologies[ref.id];
    buildings(def ? [def.building] : []);
    technologies(def?.requires ?? []);
  }
  return deps;
}

function isDisabled(data: GameData, view: PlayerView, ref: GuideRef): boolean {
  const civilization = viewerRestrictions(view, data);
  if (!civilization) {
    return false;
  }
  if (ref.kind === 'unit') {
    return civilization.disabledUnits.includes(ref.id);
  }
  return ref.kind === 'technology' && civilization.disabledTechs.includes(ref.id);
}

function ageReached(view: PlayerView, age: AgeId): boolean {
  return AGE_ORDER.indexOf(view.self.age) >= AGE_ORDER.indexOf(age);
}

function isDone(data: GameData, view: PlayerView, owned: ReadonlySet<string>, ref: GuideRef): boolean {
  if (ref.kind === 'building') {
    return owned.has(ref.id);
  }
  if (ref.kind === 'unit') {
    return false;
  }
  const rule = ageRuleOf(data, ref.id);
  return rule ? ageReached(view, rule.id) : view.self.researched.includes(ref.id);
}

function stepCost(data: GameData, view: PlayerView, ref: GuideRef): Cost {
  if (ref.kind === 'building') {
    const def = data.buildings[ref.id];
    return def ? buildingCost(view, data, def) : {};
  }
  if (ref.kind === 'unit') {
    const def = data.units[ref.id];
    return def ? unitCost(view, data, def) : {};
  }
  return data.technologies[ref.id]?.cost ?? {};
}

function stepLocation(data: GameData, ref: GuideRef): GuideRef | null {
  if (ref.kind === 'building') {
    return builderOf(data);
  }
  const building =
    ref.kind === 'unit' ? data.units[ref.id]?.building : data.technologies[ref.id]?.building;
  return building ? { kind: 'building', id: building } : null;
}

export function guideChain(data: GameData, view: PlayerView, target: GuideRef): GuideChain {
  const owned = ownedBuildingTypes(view);
  const eras = new Map<string, number>();
  const visiting = new Set<string>();
  const ordered: GuideRef[] = [];
  const visit = (ref: GuideRef): number => {
    const key = refKey(ref);
    const known = eras.get(key);
    if (known !== undefined || visiting.has(key)) {
      return known ?? 0;
    }
    visiting.add(key);
    let era = AGE_ORDER.indexOf(ownAge(data, ref));
    for (const dependency of guideDependencies(data, ref)) {
      era = Math.max(era, visit(dependency));
    }
    eras.set(key, era);
    ordered.push(ref);
    return era;
  };
  visit(target);

  const done = new Set(ordered.filter((ref) => isDone(data, view, owned, ref)).map(refKey));
  const needed = new Set<string>();
  const need = (ref: GuideRef): void => {
    const key = refKey(ref);
    if (needed.has(key)) {
      return;
    }
    needed.add(key);
    if (!done.has(key) || sameRef(ref, target)) {
      guideDependencies(data, ref).forEach(need);
    }
  };
  need(target);

  const steps = ordered.map((ref): GuideStep => {
    const rule = ref.kind === 'technology' ? ageRuleOf(data, ref.id) : undefined;
    return {
      ref,
      age: AGE_ORDER[eras.get(refKey(ref)) ?? 0],
      location: stepLocation(data, ref),
      cost: stepCost(data, view, ref),
      done: done.has(refKey(ref)) || !needed.has(refKey(ref)),
      advancesTo: rule?.id ?? null,
      choice:
        rule && rule.requiredBuildingCount > 0
          ? {
              count: rule.requiredBuildingCount,
              buildings: rule.qualifyingBuildings,
              owned: rule.qualifyingBuildings.filter((id) => owned.has(id)),
            }
          : null,
    };
  });
  const rank = (step: GuideStep): number =>
    AGE_ORDER.indexOf(step.age) * 2 + (step.advancesTo === null ? 0 : 1);
  steps.sort((a, b) => rank(a) - rank(b));
  return {
    steps,
    blocked: ordered.some((ref) => isDisabled(data, view, ref)),
    ready: steps.every((step) => step.done || sameRef(step.ref, target)),
  };
}

export function guideUnlocks(data: GameData, ref: GuideRef): GuideUnlocks {
  const result: GuideUnlocks = { trains: [], researches: [], unlocks: [] };
  for (const entry of guideEntries(data)) {
    if (sameRef(entry, ref)) {
      continue;
    }
    if (ref.kind === 'building' && entry.kind === 'unit' && data.units[entry.id]?.building === ref.id) {
      result.trains.push(entry);
    } else if (
      ref.kind === 'building' &&
      entry.kind === 'technology' &&
      data.technologies[entry.id]?.building === ref.id
    ) {
      result.researches.push(entry);
    } else if (
      guideDependencies(data, entry).some((dependency) => sameRef(dependency, ref)) ||
      (ref.kind === 'building' &&
        entry.kind === 'technology' &&
        (ageRuleOf(data, entry.id)?.qualifyingBuildings.includes(ref.id) ?? false))
    ) {
      result.unlocks.push(entry);
    }
  }
  return result;
}
