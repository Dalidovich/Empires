import type { CivilizationDef, GameData } from '../data/types';
import type { GuideKind, GuideRef } from './game/guide';
import { GUIDE_KINDS, guideDependencies, guideEntries, refKey } from './game/guide';

export interface CivilizationEntry {
  ref: GuideRef;
  available: boolean;
}

export interface CivilizationSection {
  building: CivilizationEntry;
  units: CivilizationEntry[];
  technologies: CivilizationEntry[];
}

export interface CivilizationOverview {
  id: string;
  entries: Record<GuideKind, CivilizationEntry[]>;
  sections: CivilizationSection[];
}

function isDisabled(civilization: CivilizationDef | undefined, ref: GuideRef): boolean {
  if (ref.kind === 'unit') {
    return civilization?.disabledUnits.includes(ref.id) ?? false;
  }
  return ref.kind === 'technology' && (civilization?.disabledTechs.includes(ref.id) ?? false);
}

export function civilizationOverview(data: GameData, id: string): CivilizationOverview {
  const civilization = data.civilizations[id];
  const known = new Map<string, boolean>();
  const available = (ref: GuideRef): boolean => {
    const key = refKey(ref);
    const cached = known.get(key);
    if (cached !== undefined) {
      return cached;
    }
    known.set(key, true);
    const result = !isDisabled(civilization, ref) && guideDependencies(data, ref).every(available);
    known.set(key, result);
    return result;
  };
  const all = guideEntries(data).map((ref): CivilizationEntry => ({ ref, available: available(ref) }));
  const entries = Object.fromEntries(
    GUIDE_KINDS.map((kind) => [kind, all.filter((entry) => entry.ref.kind === kind)]),
  ) as Record<GuideKind, CivilizationEntry[]>;
  const sections: CivilizationSection[] = [];
  for (const building of entries.building) {
    const units = entries.unit.filter((entry) => data.units[entry.ref.id]?.building === building.ref.id);
    const technologies = entries.technology.filter(
      (entry) => data.technologies[entry.ref.id]?.building === building.ref.id,
    );
    if (units.length + technologies.length > 0) {
      sections.push({ building, units, technologies });
    }
  }
  return { id, entries, sections };
}

export function unavailableRefs(entries: readonly CivilizationEntry[]): GuideRef[] {
  return entries.filter((entry) => !entry.available).map((entry) => entry.ref);
}

export function availableCount(entries: readonly CivilizationEntry[]): number {
  return entries.filter((entry) => entry.available).length;
}
