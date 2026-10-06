import type {
  AgeId,
  AttackBonus,
  BuildingDef,
  CivilizationDef,
  ConversionParam,
  ConversionRules,
  Cost,
  Effect,
  EffectTarget,
  EffectType,
  GameData,
  GatherKind,
  ModifierOp,
  ModifyAttackBonusEffect,
  ModifyCostEffect,
  ModifyStatEffect,
  PlayerFlag,
  UnitDef,
  UnitStatKey,
} from '../../data/types';
import { AGE_ORDER, RESOURCE_KINDS } from '../../data/types';
import type { Player } from '../types';

export interface ConversionParams extends ConversionRules {
  faithRechargeTime: number;
}

export interface OpAccumulator {
  set: number | null;
  add: number;
  multiply: number;
}

export interface PlayerModifierSet {
  statEffects: ModifyStatEffect[];
  costEffects: ModifyCostEffect[];
  attackBonusEffects: ModifyAttackBonusEffect[];
  gatherRates: Record<GatherKind, number>;
  carryCapacity: Record<GatherKind, number>;
  farmFood: number;
  conversion: ConversionParams;
  flags: Partial<Record<PlayerFlag, boolean>>;
  unitUpgrades: Record<string, string>;
  buildingUpgrades: Record<string, string>;
  enabledUnits: string[];
  enabledBuildings: string[];
  age: AgeId | null;
  units: Map<string, UnitDef>;
  buildings: Map<string, BuildingDef>;
}

interface ModifierDraft {
  statEffects: ModifyStatEffect[];
  costEffects: ModifyCostEffect[];
  attackBonusEffects: ModifyAttackBonusEffect[];
  gatherRates: Partial<Record<GatherKind, OpAccumulator>>;
  carryCapacity: Partial<Record<GatherKind, OpAccumulator>>;
  farmFood: OpAccumulator;
  conversion: Partial<Record<ConversionParam, OpAccumulator>>;
  flags: Partial<Record<PlayerFlag, boolean>>;
  unitUpgrades: Record<string, string>;
  buildingUpgrades: Record<string, string>;
  enabledUnits: string[];
  enabledBuildings: string[];
  age: AgeId | null;
}

type EffectOf<T extends EffectType> = Extract<Effect, { type: T }>;

type EffectHandler<T extends EffectType> = (draft: ModifierDraft, effect: EffectOf<T>) => void;

const UNIT_STAT_KEYS: readonly UnitStatKey[] = [
  'hp',
  'attack',
  'attackInterval',
  'armor',
  'pierceArmor',
  'range',
  'minRange',
  'speed',
  'lineOfSight',
  'blastRadius',
  'trainTime',
  'transportCapacity',
  'healRate',
  'conversionResistance',
];

const BUILDING_STAT_KEYS: readonly UnitStatKey[] = [
  'hp',
  'attack',
  'attackInterval',
  'armor',
  'pierceArmor',
  'range',
  'lineOfSight',
  'buildTime',
];

const MAX_UPGRADE_CHAIN = 16;

export function ageIndex(age: AgeId): number {
  return AGE_ORDER.indexOf(age);
}

export function createAccumulator(): OpAccumulator {
  return { set: null, add: 0, multiply: 1 };
}

export function accumulate(accumulator: OpAccumulator, op: ModifierOp, value: number): void {
  if (op === 'set') {
    accumulator.set = value;
  } else if (op === 'add') {
    accumulator.add += value;
  } else {
    accumulator.multiply *= value;
  }
}

export function resolveAccumulator(accumulator: OpAccumulator | undefined, base: number): number {
  if (!accumulator) {
    return base;
  }
  return ((accumulator.set ?? base) + accumulator.add) * accumulator.multiply;
}

function accumulateKinds(
  table: Partial<Record<GatherKind, OpAccumulator>>,
  kinds: readonly GatherKind[],
  op: ModifierOp,
  value: number,
): void {
  for (const kind of kinds) {
    const accumulator = table[kind] ?? createAccumulator();
    accumulate(accumulator, op, value);
    table[kind] = accumulator;
  }
}

export const EFFECT_HANDLERS: { readonly [T in EffectType]: EffectHandler<T> } = {
  advance_age: (draft, effect) => {
    if (draft.age === null || ageIndex(effect.age) > ageIndex(draft.age)) {
      draft.age = effect.age;
    }
  },
  modify_stat: (draft, effect) => {
    draft.statEffects.push(effect);
  },
  modify_cost: (draft, effect) => {
    draft.costEffects.push(effect);
  },
  modify_attack_bonus: (draft, effect) => {
    draft.attackBonusEffects.push(effect);
  },
  modify_gather_rate: (draft, effect) => {
    accumulateKinds(draft.gatherRates, effect.kinds, effect.op, effect.value);
  },
  modify_carry_capacity: (draft, effect) => {
    accumulateKinds(draft.carryCapacity, effect.kinds, effect.op, effect.value);
  },
  modify_farm_food: (draft, effect) => {
    accumulate(draft.farmFood, effect.op, effect.value);
  },
  modify_conversion: (draft, effect) => {
    const accumulator = draft.conversion[effect.param] ?? createAccumulator();
    accumulate(accumulator, effect.op, effect.value);
    draft.conversion[effect.param] = accumulator;
  },
  enable_unit: (draft, effect) => {
    if (!draft.enabledUnits.includes(effect.unit)) {
      draft.enabledUnits.push(effect.unit);
    }
  },
  enable_building: (draft, effect) => {
    if (!draft.enabledBuildings.includes(effect.building)) {
      draft.enabledBuildings.push(effect.building);
    }
  },
  upgrade_unit: (draft, effect) => {
    draft.unitUpgrades[effect.from] = effect.to;
  },
  upgrade_building: (draft, effect) => {
    draft.buildingUpgrades[effect.from] = effect.to;
  },
  set_flag: (draft, effect) => {
    draft.flags[effect.flag] = true;
  },
};

export function isEffectHandled(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(EFFECT_HANDLERS, type);
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

function applyEffect(draft: ModifierDraft, effect: Effect): void {
  const handler = EFFECT_HANDLERS[effect.type] as ((draft: ModifierDraft, effect: Effect) => void) | undefined;
  if (handler) {
    handler(draft, effect);
  }
}

function resolveKinds(
  base: Readonly<Record<GatherKind, number>>,
  table: Partial<Record<GatherKind, OpAccumulator>>,
): Record<GatherKind, number> {
  const resolved = { ...base };
  for (const kind of Object.keys(base) as GatherKind[]) {
    resolved[kind] = Math.max(0, resolveAccumulator(table[kind], base[kind]));
  }
  return resolved;
}

function resolveConversion(
  rules: ConversionRules,
  table: Partial<Record<ConversionParam, OpAccumulator>>,
): ConversionParams {
  const chance = Math.min(1, Math.max(0, resolveAccumulator(table.chance, rules.chance)));
  const attemptInterval = Math.max(0, resolveAccumulator(table.attemptInterval, rules.attemptInterval));
  let rate = Math.max(0, resolveAccumulator(table.faithRechargeRate, rules.faithRechargeRate));
  let time = rate > 0 ? rules.faithMax / rate : 0;
  if (table.faithRechargeTime) {
    time = Math.max(0, resolveAccumulator(table.faithRechargeTime, time));
    rate = time > 0 ? rules.faithMax / time : rate;
  }
  return {
    attemptInterval,
    guaranteedFailures: rules.guaranteedFailures,
    chance,
    faithMax: rules.faithMax,
    faithRechargeRate: rate,
    faithRechargeTime: time,
  };
}

export function compileModifiers(
  civilization: string,
  researched: readonly string[],
  data: GameData,
  fullTechTree = false,
): PlayerModifierSet {
  const draft: ModifierDraft = {
    statEffects: [],
    costEffects: [],
    attackBonusEffects: [],
    gatherRates: {},
    carryCapacity: {},
    farmFood: createAccumulator(),
    conversion: {},
    flags: {},
    unitUpgrades: {},
    buildingUpgrades: {},
    enabledUnits: [],
    enabledBuildings: [],
    age: null,
  };
  const known = new Set(researched);
  const sources: (readonly Effect[])[] = [
    fullTechTree ? [] : (data.civilizations[civilization]?.bonuses ?? []),
  ];
  const applied = new Set<string>();
  for (const id of researched) {
    const technology = data.technologies[id];
    if (technology && !applied.has(id)) {
      applied.add(id);
      sources.push(technology.effects);
    }
  }
  for (const effects of sources) {
    for (const effect of effects) {
      if (conditionHolds(effect, known)) {
        applyEffect(draft, effect);
      }
    }
  }
  return {
    statEffects: draft.statEffects,
    costEffects: draft.costEffects,
    attackBonusEffects: draft.attackBonusEffects,
    gatherRates: resolveKinds(data.resources.gatherRates, draft.gatherRates),
    carryCapacity: resolveKinds(data.resources.carryCapacity, draft.carryCapacity),
    farmFood: Math.max(0, Math.round(resolveAccumulator(draft.farmFood, data.resources.farmFood))),
    conversion: resolveConversion(data.game.conversion, draft.conversion),
    flags: draft.flags,
    unitUpgrades: draft.unitUpgrades,
    buildingUpgrades: draft.buildingUpgrades,
    enabledUnits: draft.enabledUnits,
    enabledBuildings: draft.enabledBuildings,
    age: draft.age,
    units: new Map(),
    buildings: new Map(),
  };
}

interface CacheEntry {
  data: GameData;
  civilization: string;
  fullTechTree: boolean;
  researched: string[];
  count: number;
  last: string | undefined;
  modifiers: PlayerModifierSet;
}

const cache = new WeakMap<Player, CacheEntry>();

export function restrictionsOf(player: Player, data: GameData): CivilizationDef | undefined {
  return player.fullTechTree === true ? undefined : data.civilizations[player.civilization];
}

export function modifiersOf(player: Player, data: GameData): PlayerModifierSet {
  const researched = player.researched;
  const last = researched.length > 0 ? researched[researched.length - 1] : undefined;
  const fullTechTree = player.fullTechTree === true;
  const entry = cache.get(player);
  if (
    entry &&
    entry.data === data &&
    entry.civilization === player.civilization &&
    entry.fullTechTree === fullTechTree &&
    entry.researched === researched &&
    entry.count === researched.length &&
    entry.last === last
  ) {
    return entry.modifiers;
  }
  const modifiers = compileModifiers(player.civilization, researched, data, fullTechTree);
  cache.set(player, {
    data,
    civilization: player.civilization,
    fullTechTree,
    researched,
    count: researched.length,
    last,
    modifiers,
  });
  return modifiers;
}

function intersects<T>(list: readonly T[] | undefined, values: readonly T[]): boolean {
  if (!list) {
    return false;
  }
  for (const value of values) {
    if (list.includes(value)) {
      return true;
    }
  }
  return false;
}

export function targetsUnit(target: EffectTarget, def: UnitDef): boolean {
  return (target.units?.includes(def.id) ?? false) || intersects(target.unitClasses, def.class);
}

export function targetsBuilding(target: EffectTarget, def: BuildingDef): boolean {
  return (
    (target.buildings?.includes(def.id) ?? false) || intersects(target.buildingClasses, def.class)
  );
}

function modifiedCost(base: Cost, effects: readonly ModifyCostEffect[]): Cost {
  if (effects.length === 0) {
    return base;
  }
  const cost: Cost = {};
  for (const resource of RESOURCE_KINDS) {
    const accumulator = createAccumulator();
    for (const effect of effects) {
      if (effect.resource === undefined || effect.resource === resource) {
        accumulate(accumulator, effect.op, effect.value);
      }
    }
    const amount = Math.max(0, Math.round(resolveAccumulator(accumulator, base[resource] ?? 0)));
    if (amount > 0 || base[resource] !== undefined) {
      cost[resource] = amount;
    }
  }
  return cost;
}

function modifiedStats(
  target: Record<string, unknown>,
  keys: readonly UnitStatKey[],
  effects: readonly ModifyStatEffect[],
): void {
  if (effects.length === 0) {
    return;
  }
  const accumulators: Partial<Record<UnitStatKey, OpAccumulator>> = {};
  for (const effect of effects) {
    if (!keys.includes(effect.stat)) {
      continue;
    }
    const accumulator = accumulators[effect.stat] ?? createAccumulator();
    accumulate(accumulator, effect.op, effect.value);
    accumulators[effect.stat] = accumulator;
  }
  for (const key of keys) {
    const accumulator = accumulators[key];
    if (!accumulator) {
      continue;
    }
    const raw = target[key];
    const value = resolveAccumulator(accumulator, typeof raw === 'number' ? raw : 0);
    target[key] = key === 'hp' ? Math.max(1, Math.round(value)) : Math.max(0, value);
  }
}

function modifiedBonuses(
  base: readonly AttackBonus[],
  effects: readonly ModifyAttackBonusEffect[],
): AttackBonus[] {
  const bonuses = base.map((bonus) => ({ ...bonus }));
  for (const effect of effects) {
    let bonus = bonuses.find((entry) => entry.targetClass === effect.targetClass);
    if (!bonus) {
      bonus = { targetClass: effect.targetClass };
      bonuses.push(bonus);
    }
    if (effect.op === 'multiply') {
      bonus.multiply = (bonus.multiply ?? 1) * effect.value;
    } else if (effect.op === 'add') {
      bonus.add = (bonus.add ?? 0) + effect.value;
    } else {
      bonus.add = effect.value;
    }
  }
  return bonuses;
}

export function modifiedUnit(modifiers: PlayerModifierSet, def: UnitDef): UnitDef {
  const known = modifiers.units.get(def.id);
  if (known) {
    return known;
  }
  const statEffects = modifiers.statEffects.filter((effect) => targetsUnit(effect.target, def));
  const costEffects = modifiers.costEffects.filter((effect) => targetsUnit(effect.target, def));
  const bonusEffects = modifiers.attackBonusEffects.filter((effect) =>
    targetsUnit(effect.target, def),
  );
  let stats = def;
  if (statEffects.length > 0 || costEffects.length > 0 || bonusEffects.length > 0) {
    const draft: UnitDef = { ...def };
    modifiedStats(draft as unknown as Record<string, unknown>, UNIT_STAT_KEYS, statEffects);
    draft.cost = modifiedCost(def.cost, costEffects);
    if (bonusEffects.length > 0) {
      draft.bonuses = modifiedBonuses(def.bonuses, bonusEffects);
    }
    stats = Object.freeze(draft);
  }
  modifiers.units.set(def.id, stats);
  return stats;
}

export function modifiedBuilding(modifiers: PlayerModifierSet, def: BuildingDef): BuildingDef {
  const known = modifiers.buildings.get(def.id);
  if (known) {
    return known;
  }
  const statEffects = modifiers.statEffects.filter((effect) => targetsBuilding(effect.target, def));
  const costEffects = modifiers.costEffects.filter((effect) => targetsBuilding(effect.target, def));
  let stats = def;
  if (statEffects.length > 0 || costEffects.length > 0) {
    const draft: BuildingDef = { ...def };
    modifiedStats(draft as unknown as Record<string, unknown>, BUILDING_STAT_KEYS, statEffects);
    draft.cost = modifiedCost(def.cost, costEffects);
    stats = Object.freeze(draft);
  }
  modifiers.buildings.set(def.id, stats);
  return stats;
}

function followUpgrades(upgrades: Readonly<Record<string, string>>, type: string): string {
  let current = type;
  for (let hop = 0; hop < MAX_UPGRADE_CHAIN; hop++) {
    const next = upgrades[current];
    if (next === undefined || next === current) {
      break;
    }
    current = next;
  }
  return current;
}

export function upgradedUnitType(modifiers: PlayerModifierSet, type: string): string {
  return followUpgrades(modifiers.unitUpgrades, type);
}

export function upgradedBuildingType(modifiers: PlayerModifierSet, type: string): string {
  return followUpgrades(modifiers.buildingUpgrades, type);
}
