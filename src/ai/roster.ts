import type { Cost, UnitDef } from '../data/types';
import { ageIndex } from '../sim/effects/modifiers';
import type { Knowledge } from './knowledge';
import { hasTech, techAllowed, unitAllowed, unitStats } from './knowledge';

export type Role = 'melee' | 'ranged' | 'siege';

export const ROLES: readonly Role[] = ['melee', 'ranged', 'siege'];

export interface RosterEntry {
  role: Role;
  unit: string;
  building: string;
  unlock: string | null;
  value: number;
}

export type Roster = Partial<Record<Role, RosterEntry>>;

const GOLD_WEIGHT = 1.5;
const COST_EXPONENT = 0.8;
const ARMOR_WEIGHT = 0.08;
const RANGE_WEIGHT = 0.04;
const SPEED_WEIGHT = 0.15;
const BASE_SPEED = 1.2;
const BLAST_WEIGHT = 0.3;

export function roleOf(def: UnitDef): Role {
  if (def.class.includes('siege')) {
    return 'siege';
  }
  if (def.class.includes('archer') || def.attackType === 'ranged') {
    return 'ranged';
  }
  return 'melee';
}

function weightedCost(cost: Cost): number {
  return (
    (cost.food ?? 0) +
    (cost.wood ?? 0) +
    ((cost.gold ?? 0) + (cost.stone ?? 0)) * GOLD_WEIGHT
  );
}

export function unitPower(def: UnitDef): number {
  if (def.attack <= 0 || def.attackInterval <= 0) {
    return 0;
  }
  const toughness = def.hp * (1 + (def.armor + def.pierceArmor) * ARMOR_WEIGHT);
  const damage = (def.attack / def.attackInterval) * (1 + def.blastRadius * BLAST_WEIGHT);
  const reach = 1 + def.range * RANGE_WEIGHT;
  const mobility = 1 + (def.speed - BASE_SPEED) * SPEED_WEIGHT;
  return Math.sqrt(toughness * damage) * reach * Math.max(0.5, mobility);
}

export function unitValue(def: UnitDef): number {
  const cost = Math.max(1, weightedCost(def.cost));
  return unitPower(def) / Math.pow(cost, COST_EXPONENT);
}

function unlockOf(know: Knowledge, def: UnitDef): string | null | undefined {
  if (know.modifiers.unitUpgrades[def.id] !== undefined) {
    return undefined;
  }
  if (know.age < ageIndex(def.age)) {
    return undefined;
  }
  const required = def.requiresTech ?? null;
  if (required === null || hasTech(know, required) || know.modifiers.enabledUnits.includes(def.id)) {
    return null;
  }
  const technology = know.data.technologies[required];
  if (!technology || !techAllowed(know, required) || know.age < ageIndex(technology.age)) {
    return undefined;
  }
  for (const effect of technology.effects) {
    if (effect.type === 'enable_unit' && effect.unit === def.id) {
      return technology.requires.every((id) => hasTech(know, id)) ? required : undefined;
    }
  }
  return undefined;
}

export function isLandFighter(def: UnitDef): boolean {
  return def.class.includes('military') && def.domain === 'land' && def.attack > 0;
}

export function chooseRoster(know: Knowledge): Roster {
  const roster: Roster = {};
  for (const base of Object.values(know.data.units)) {
    if (
      !isLandFighter(base) ||
      base.class.includes('scout') ||
      !unitAllowed(know, base.id) ||
      base.building === null
    ) {
      continue;
    }
    const unlock = unlockOf(know, base);
    if (unlock === undefined) {
      continue;
    }
    const stats = unitStats(know, base.id) ?? base;
    const role = roleOf(stats);
    const value = unitValue(stats);
    const known = roster[role];
    if (!known || value > known.value || (value === known.value && base.id < known.unit)) {
      roster[role] = { role, unit: base.id, building: base.building, unlock, value };
    }
  }
  return roster;
}
