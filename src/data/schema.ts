import { z } from 'zod';
import type {
  AiData,
  AiLevelDef,
  BuildingDef,
  CivilizationDef,
  Effect,
  GameRules,
  MapObjectDef,
  MapSizeDef,
  MapTypeDef,
  MapsData,
  ResourceSourceDef,
  ResourcesData,
  TechnologyDef,
  UnitDef,
} from './types';

const idPattern = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export const idSchema = z.string().regex(idPattern);

export const dataSourceSchema = z.enum(['1.0', 'DE']);

export const resourceKindSchema = z.enum(['food', 'wood', 'stone', 'gold']);

export const ageIdSchema = z.enum(['stone', 'tool', 'bronze', 'iron']);

export const costSchema = z.partialRecord(resourceKindSchema, z.number().nonnegative());

export const resourceAmountsSchema = z.record(resourceKindSchema, z.number().nonnegative());

export const movementDomainSchema = z.enum(['land', 'water']);

export const attackTypeSchema = z.enum(['none', 'melee', 'ranged']);

export const gatherKindSchema = z.enum([
  'forage',
  'farm',
  'wood',
  'stone',
  'gold',
  'hunt',
  'shore_fish',
  'boat_fish',
  'trade',
]);

export const unitClassSchema = z.enum([
  'villager',
  'civilian',
  'military',
  'infantry',
  'barracks_infantry',
  'academy_infantry',
  'sword_line',
  'archer',
  'foot_archer',
  'bowman_line',
  'mounted_archer',
  'horse_archer',
  'cavalry',
  'cavalry_line',
  'scout',
  'chariot',
  'elephant',
  'siege',
  'stone_thrower_line',
  'ballista_line',
  'machine',
  'priest',
  'ranged',
  'melee',
  'ship',
  'war_ship',
  'catapult_ship',
  'fishing_ship',
  'trade_ship',
  'transport_ship',
  'animal',
  'prey',
  'predator',
]);

export const buildingClassSchema = z.enum([
  'town_center',
  'house',
  'drop_off',
  'military',
  'economic',
  'dock',
  'farm',
  'wall',
  'tower',
  'wonder',
  'temple',
]);

export const attackBonusSchema = z.strictObject({
  targetClass: unitClassSchema,
  add: z.number().optional(),
  multiply: z.number().optional(),
});

export const animalSchema = z.strictObject({
  behavior: z.enum(['flee', 'aggressive', 'retaliate']),
  aggroRadius: z.number().nonnegative(),
  food: z.number().nonnegative(),
  carcass: idSchema,
});

export const huntingSchema = z.strictObject({
  attack: z.number().positive(),
  range: z.number().positive(),
  projectileSpeed: z.number().positive(),
});

export const unitSchema: z.ZodType<UnitDef> = z.strictObject({
  id: idSchema,
  class: z.array(unitClassSchema),
  building: idSchema.nullable(),
  age: ageIdSchema,
  cost: costSchema,
  trainTime: z.number().nonnegative(),
  hp: z.number().positive(),
  attack: z.number().nonnegative(),
  attackInterval: z.number().nonnegative(),
  armor: z.number().nonnegative(),
  pierceArmor: z.number().nonnegative(),
  range: z.number().nonnegative(),
  minRange: z.number().nonnegative(),
  speed: z.number().nonnegative(),
  lineOfSight: z.number().nonnegative(),
  blastRadius: z.number().nonnegative(),
  bonuses: z.array(attackBonusSchema),
  upgradesTo: idSchema.nullable(),
  source: dataSourceSchema,
  domain: movementDomainSchema,
  attackType: attackTypeSchema,
  population: z.number().int().nonnegative(),
  radius: z.number().positive(),
  requiresTech: idSchema.nullable().optional(),
  projectileSpeed: z.number().positive().optional(),
  transportCapacity: z.number().int().nonnegative().optional(),
  trample: z.boolean().optional(),
  conversionResistance: z.number().nonnegative().optional(),
  healRate: z.number().nonnegative().optional(),
  animal: animalSchema.optional(),
  hunting: huntingSchema.optional(),
});

export const buildingSchema: z.ZodType<BuildingDef> = z.strictObject({
  id: idSchema,
  class: z.array(buildingClassSchema),
  age: ageIdSchema,
  cost: costSchema,
  buildTime: z.number().nonnegative(),
  hp: z.number().positive(),
  size: z.number().int().positive(),
  requires: z.strictObject({
    buildings: z.array(idSchema),
    technologies: z.array(idSchema),
  }),
  housing: z.number().int().nonnegative(),
  dropOff: z.array(gatherKindSchema),
  attack: z.number().nonnegative(),
  range: z.number().nonnegative(),
  source: dataSourceSchema,
  attackInterval: z.number().nonnegative(),
  armor: z.number().nonnegative(),
  pierceArmor: z.number().nonnegative(),
  lineOfSight: z.number().nonnegative(),
  placement: z.enum(['land', 'shore']),
  upgradesTo: idSchema.nullable(),
  requiresWhenOwned: z.array(idSchema).optional(),
  projectileSpeed: z.number().positive().optional(),
  convertible: z.boolean().optional(),
});

export const modifierOpSchema = z.enum(['add', 'multiply', 'set']);

export const unitStatKeySchema = z.enum([
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
  'buildTime',
  'transportCapacity',
  'healRate',
  'conversionResistance',
]);

export const conversionParamSchema = z.enum([
  'chance',
  'faithRechargeRate',
  'faithRechargeTime',
  'attemptInterval',
]);

export const playerFlagSchema = z.enum([
  'no_tribute_tax',
  'shared_exploration',
  'ballistics',
  'villagers_damage_walls',
  'convert_buildings',
  'convert_priests',
]);

export const effectTargetSchema = z.strictObject({
  units: z.array(idSchema).optional(),
  unitClasses: z.array(unitClassSchema).optional(),
  buildings: z.array(idSchema).optional(),
  buildingClasses: z.array(buildingClassSchema).optional(),
});

export const effectConditionSchema = z.strictObject({
  hasTech: idSchema.optional(),
  lacksTech: idSchema.optional(),
});

const condition = effectConditionSchema.optional();

export const effectSchema: z.ZodType<Effect> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('advance_age'), age: ageIdSchema, condition }),
  z.strictObject({
    type: z.literal('modify_stat'),
    target: effectTargetSchema,
    stat: unitStatKeySchema,
    op: modifierOpSchema,
    value: z.number(),
    condition,
  }),
  z.strictObject({
    type: z.literal('modify_cost'),
    target: effectTargetSchema,
    resource: resourceKindSchema.optional(),
    op: modifierOpSchema,
    value: z.number(),
    condition,
  }),
  z.strictObject({
    type: z.literal('modify_attack_bonus'),
    target: effectTargetSchema,
    targetClass: unitClassSchema,
    op: modifierOpSchema,
    value: z.number(),
    condition,
  }),
  z.strictObject({
    type: z.literal('modify_gather_rate'),
    kinds: z.array(gatherKindSchema),
    op: modifierOpSchema,
    value: z.number(),
    condition,
  }),
  z.strictObject({
    type: z.literal('modify_carry_capacity'),
    kinds: z.array(gatherKindSchema),
    op: modifierOpSchema,
    value: z.number(),
    condition,
  }),
  z.strictObject({
    type: z.literal('modify_farm_food'),
    op: modifierOpSchema,
    value: z.number(),
    condition,
  }),
  z.strictObject({
    type: z.literal('modify_conversion'),
    param: conversionParamSchema,
    op: modifierOpSchema,
    value: z.number(),
    condition,
  }),
  z.strictObject({ type: z.literal('enable_unit'), unit: idSchema, condition }),
  z.strictObject({ type: z.literal('enable_building'), building: idSchema, condition }),
  z.strictObject({ type: z.literal('upgrade_unit'), from: idSchema, to: idSchema, condition }),
  z.strictObject({ type: z.literal('upgrade_building'), from: idSchema, to: idSchema, condition }),
  z.strictObject({ type: z.literal('set_flag'), flag: playerFlagSchema, condition }),
]);

export const technologySchema: z.ZodType<TechnologyDef> = z.strictObject({
  id: idSchema,
  building: idSchema,
  age: ageIdSchema,
  cost: costSchema,
  researchTime: z.number().nonnegative(),
  requires: z.array(idSchema),
  effects: z.array(effectSchema),
  source: dataSourceSchema,
});

export const civilizationSchema: z.ZodType<CivilizationDef> = z.strictObject({
  id: idSchema,
  architectureSet: z.enum(['egyptian', 'mesopotamian', 'greek', 'asian']),
  bonuses: z.array(effectSchema),
  disabledTechs: z.array(idSchema),
  disabledUnits: z.array(idSchema),
  source: dataSourceSchema,
});

export const resourceSourceSchema: z.ZodType<ResourceSourceDef> = z.strictObject({
  id: idSchema,
  resource: resourceKindSchema,
  gatherKind: gatherKindSchema,
  amount: z.number().nonnegative(),
  size: z.number().int().positive(),
  domain: movementDomainSchema,
  blocksMovement: z.boolean(),
  source: dataSourceSchema,
});

export const mapObjectSchema: z.ZodType<MapObjectDef> = z.strictObject({
  id: idSchema,
  kind: z.enum(['ruin', 'artifact']),
  size: z.number().int().positive(),
  speed: z.number().nonnegative(),
  lineOfSight: z.number().nonnegative(),
  captureRadius: z.number().nonnegative(),
  source: dataSourceSchema,
});

export const resourcesSchema: z.ZodType<ResourcesData> = z.strictObject({
  sources: z.array(resourceSourceSchema),
  objects: z.array(mapObjectSchema),
  gatherRates: z.record(gatherKindSchema, z.number().nonnegative()),
  carryCapacity: z.record(gatherKindSchema, z.number().nonnegative()),
  farmFood: z.number().nonnegative(),
  carcassDecayRate: z.number().nonnegative(),
  source: dataSourceSchema,
});

export const mapTypeIdSchema = z.enum([
  'small_islands',
  'large_islands',
  'coastal',
  'inland',
  'highland',
]);

export const mapSizeIdSchema = z.enum(['tiny', 'small', 'medium', 'large', 'huge']);

export const mapSizeSchema: z.ZodType<MapSizeDef> = z.strictObject({
  id: mapSizeIdSchema,
  tiles: z.number().int().positive(),
});

export const mapTypeSchema: z.ZodType<MapTypeDef> = z.strictObject({
  id: mapTypeIdSchema,
  layout: z.enum(['islands', 'coastal', 'land']),
  landRatio: z.number().min(0).max(1),
  forestRatio: z.number().min(0).max(1),
  desertRatio: z.number().min(0).max(1),
  maxElevation: z.number().int().nonnegative(),
  elevationRoughness: z.number().nonnegative(),
  startZoneRadius: z.number().positive(),
  startResources: z.record(idSchema, z.number().nonnegative()),
  areaResources: z.record(idSchema, z.number().nonnegative()),
  areaAnimals: z.record(idSchema, z.number().nonnegative()),
  ruins: z.number().int().nonnegative(),
  artifacts: z.number().int().nonnegative(),
  sizeScale: z.partialRecord(mapSizeIdSchema, z.number().positive()),
  params: z.record(z.string(), z.number()),
});

export const mapsSchema: z.ZodType<MapsData> = z.strictObject({
  sizes: z.array(mapSizeSchema),
  types: z.array(mapTypeSchema),
});

export const aiDifficultySchema = z.enum(['easiest', 'easy', 'moderate', 'hard', 'hardest']);

export const aiLevelSchema: z.ZodType<AiLevelDef> = z.strictObject({
  id: aiDifficultySchema,
  decisionIntervalTicks: z.number().int().positive(),
  maxVillagers: z.number().int().nonnegative(),
  aggressiveness: z.number().min(0).max(1),
  microQuality: z.number().min(0).max(1),
  resourceBonus: costSchema,
  params: z.record(z.string(), z.number()),
});

export const aiSchema: z.ZodType<AiData> = z.strictObject({
  levels: z.array(aiLevelSchema),
});

export const gameSpeedSchema = z.enum(['slow', 'normal', 'fast']);

export const gameRulesSchema: z.ZodType<GameRules> = z.strictObject({
  tickRate: z.number().int().positive(),
  ticksPerGameYear: z.number().positive(),
  victoryCountdownYears: z.number().positive(),
  speedMultipliers: z.record(gameSpeedSchema, z.number().positive()),
  tributeTax: z.number().min(0).max(1),
  tributeAmount: z.number().positive(),
  startingResources: resourceAmountsSchema,
  start: z.strictObject({
    building: idSchema,
    unit: idSchema,
    unitCount: z.number().int().nonnegative(),
  }),
  populationLimits: z.array(z.number().int().positive()),
  ages: z.array(
    z.strictObject({
      id: ageIdSchema,
      technology: idSchema.nullable(),
      requiredBuildingCount: z.number().int().nonnegative(),
      qualifyingBuildings: z.array(idSchema),
    }),
  ),
  conversion: z.strictObject({
    attemptInterval: z.number().positive(),
    guaranteedFailures: z.number().int().nonnegative(),
    chance: z.number().min(0).max(1),
    faithMax: z.number().positive(),
    faithRechargeRate: z.number().positive(),
  }),
  elevation: z.strictObject({
    highGroundMultiplier: z.number().positive(),
    lowGroundMultiplier: z.number().positive(),
  }),
  trade: z.strictObject({
    minGold: z.number().nonnegative(),
    maxGold: z.number().nonnegative(),
    goodsPerTrip: z.number().positive(),
    maxDistance: z.number().positive(),
  }),
  source: dataSourceSchema,
  resourceLevels: z.record(idSchema, resourceAmountsSchema).optional(),
  nomadStart: z.strictObject({ unitCount: z.number().int().positive() }).optional(),
});

export const unitsFileSchema = z.array(unitSchema);
export const buildingsFileSchema = z.array(buildingSchema);
export const technologiesFileSchema = z.array(technologySchema);
export const civilizationsFileSchema = z.array(civilizationSchema);
