export type DataSource = '1.0' | 'DE';

export type ResourceKind = 'food' | 'wood' | 'stone' | 'gold';

export const RESOURCE_KINDS: readonly ResourceKind[] = ['food', 'wood', 'stone', 'gold'];

export type AgeId = 'stone' | 'tool' | 'bronze' | 'iron';

export const AGE_ORDER: readonly AgeId[] = ['stone', 'tool', 'bronze', 'iron'];

export type Cost = Partial<Record<ResourceKind, number>>;

export type ResourceAmounts = Record<ResourceKind, number>;

export type MovementDomain = 'land' | 'water';

export type AttackType = 'none' | 'melee' | 'ranged';

export type GatherKind =
  | 'forage'
  | 'farm'
  | 'wood'
  | 'stone'
  | 'gold'
  | 'hunt'
  | 'shore_fish'
  | 'boat_fish'
  | 'trade';

export type UnitClass =
  | 'villager'
  | 'civilian'
  | 'military'
  | 'infantry'
  | 'barracks_infantry'
  | 'academy_infantry'
  | 'sword_line'
  | 'archer'
  | 'foot_archer'
  | 'bowman_line'
  | 'mounted_archer'
  | 'horse_archer'
  | 'cavalry'
  | 'cavalry_line'
  | 'scout'
  | 'chariot'
  | 'elephant'
  | 'siege'
  | 'stone_thrower_line'
  | 'ballista_line'
  | 'machine'
  | 'priest'
  | 'ranged'
  | 'melee'
  | 'ship'
  | 'war_ship'
  | 'catapult_ship'
  | 'fishing_ship'
  | 'trade_ship'
  | 'transport_ship'
  | 'animal'
  | 'prey'
  | 'predator';

export type BuildingClass =
  | 'town_center'
  | 'house'
  | 'drop_off'
  | 'military'
  | 'economic'
  | 'dock'
  | 'farm'
  | 'wall'
  | 'tower'
  | 'wonder'
  | 'temple';

export type AnimalBehavior = 'flee' | 'aggressive' | 'retaliate';

export interface AttackBonus {
  targetClass: UnitClass;
  add?: number;
  multiply?: number;
}

export interface AnimalDef {
  behavior: AnimalBehavior;
  aggroRadius: number;
  food: number;
  carcass: string;
}

export interface HuntingDef {
  attack: number;
  range: number;
  projectileSpeed: number;
}

export interface UnitDef {
  id: string;
  class: UnitClass[];
  building: string | null;
  age: AgeId;
  cost: Cost;
  trainTime: number;
  hp: number;
  attack: number;
  attackInterval: number;
  armor: number;
  pierceArmor: number;
  range: number;
  minRange: number;
  speed: number;
  lineOfSight: number;
  blastRadius: number;
  bonuses: AttackBonus[];
  upgradesTo: string | null;
  source: DataSource;
  domain: MovementDomain;
  attackType: AttackType;
  population: number;
  radius: number;
  requiresTech?: string | null;
  projectileSpeed?: number;
  transportCapacity?: number;
  trample?: boolean;
  conversionResistance?: number;
  healRate?: number;
  animal?: AnimalDef;
  hunting?: HuntingDef;
}

export type PlacementKind = 'land' | 'shore';

export interface BuildingRequirements {
  buildings: string[];
  technologies: string[];
}

export interface BuildingDef {
  id: string;
  class: BuildingClass[];
  age: AgeId;
  cost: Cost;
  buildTime: number;
  hp: number;
  size: number;
  requires: BuildingRequirements;
  housing: number;
  dropOff: GatherKind[];
  attack: number;
  range: number;
  source: DataSource;
  attackInterval: number;
  armor: number;
  pierceArmor: number;
  lineOfSight: number;
  placement: PlacementKind;
  upgradesTo: string | null;
  requiresWhenOwned?: string[];
  projectileSpeed?: number;
  convertible?: boolean;
}

export type ModifierOp = 'add' | 'multiply' | 'set';

export type UnitStatKey =
  | 'hp'
  | 'attack'
  | 'attackInterval'
  | 'armor'
  | 'pierceArmor'
  | 'range'
  | 'minRange'
  | 'speed'
  | 'lineOfSight'
  | 'blastRadius'
  | 'trainTime'
  | 'buildTime'
  | 'transportCapacity'
  | 'healRate'
  | 'conversionResistance';

export type ConversionParam = 'chance' | 'faithRechargeRate' | 'faithRechargeTime' | 'attemptInterval';

export type PlayerFlag =
  | 'no_tribute_tax'
  | 'shared_exploration'
  | 'ballistics'
  | 'villagers_damage_walls'
  | 'convert_buildings'
  | 'convert_priests';

export interface EffectTarget {
  units?: string[];
  unitClasses?: UnitClass[];
  buildings?: string[];
  buildingClasses?: BuildingClass[];
}

export interface EffectCondition {
  hasTech?: string;
  lacksTech?: string;
}

export interface AdvanceAgeEffect {
  type: 'advance_age';
  age: AgeId;
  condition?: EffectCondition;
}

export interface ModifyStatEffect {
  type: 'modify_stat';
  target: EffectTarget;
  stat: UnitStatKey;
  op: ModifierOp;
  value: number;
  condition?: EffectCondition;
}

export interface ModifyCostEffect {
  type: 'modify_cost';
  target: EffectTarget;
  resource?: ResourceKind;
  op: ModifierOp;
  value: number;
  condition?: EffectCondition;
}

export interface ModifyAttackBonusEffect {
  type: 'modify_attack_bonus';
  target: EffectTarget;
  targetClass: UnitClass;
  op: ModifierOp;
  value: number;
  condition?: EffectCondition;
}

export interface ModifyGatherRateEffect {
  type: 'modify_gather_rate';
  kinds: GatherKind[];
  op: ModifierOp;
  value: number;
  condition?: EffectCondition;
}

export interface ModifyCarryCapacityEffect {
  type: 'modify_carry_capacity';
  kinds: GatherKind[];
  op: ModifierOp;
  value: number;
  condition?: EffectCondition;
}

export interface ModifyFarmFoodEffect {
  type: 'modify_farm_food';
  op: ModifierOp;
  value: number;
  condition?: EffectCondition;
}

export interface ModifyConversionEffect {
  type: 'modify_conversion';
  param: ConversionParam;
  op: ModifierOp;
  value: number;
  condition?: EffectCondition;
}

export interface EnableUnitEffect {
  type: 'enable_unit';
  unit: string;
  condition?: EffectCondition;
}

export interface EnableBuildingEffect {
  type: 'enable_building';
  building: string;
  condition?: EffectCondition;
}

export interface UpgradeUnitEffect {
  type: 'upgrade_unit';
  from: string;
  to: string;
  condition?: EffectCondition;
}

export interface UpgradeBuildingEffect {
  type: 'upgrade_building';
  from: string;
  to: string;
  condition?: EffectCondition;
}

export interface SetFlagEffect {
  type: 'set_flag';
  flag: PlayerFlag;
  condition?: EffectCondition;
}

export type Effect =
  | AdvanceAgeEffect
  | ModifyStatEffect
  | ModifyCostEffect
  | ModifyAttackBonusEffect
  | ModifyGatherRateEffect
  | ModifyCarryCapacityEffect
  | ModifyFarmFoodEffect
  | ModifyConversionEffect
  | EnableUnitEffect
  | EnableBuildingEffect
  | UpgradeUnitEffect
  | UpgradeBuildingEffect
  | SetFlagEffect;

export type EffectType = Effect['type'];

export interface TechnologyDef {
  id: string;
  building: string;
  age: AgeId;
  cost: Cost;
  researchTime: number;
  requires: string[];
  effects: Effect[];
  source: DataSource;
}

export type ArchitectureSet = 'egyptian' | 'mesopotamian' | 'greek' | 'asian';

export interface CivilizationDef {
  id: string;
  architectureSet: ArchitectureSet;
  bonuses: Effect[];
  disabledTechs: string[];
  disabledUnits: string[];
  source: DataSource;
}

export interface ResourceSourceDef {
  id: string;
  resource: ResourceKind;
  gatherKind: GatherKind;
  amount: number;
  size: number;
  domain: MovementDomain;
  blocksMovement: boolean;
  source: DataSource;
}

export type MapObjectKind = 'ruin' | 'artifact';

export interface MapObjectDef {
  id: string;
  kind: MapObjectKind;
  size: number;
  speed: number;
  lineOfSight: number;
  captureRadius: number;
  source: DataSource;
}

export interface ResourcesData {
  sources: ResourceSourceDef[];
  objects: MapObjectDef[];
  gatherRates: Record<GatherKind, number>;
  carryCapacity: Record<GatherKind, number>;
  farmFood: number;
  carcassDecayRate: number;
  source: DataSource;
}

export type MapTypeId =
  | 'small_islands'
  | 'large_islands'
  | 'coastal'
  | 'inland'
  | 'highland'
  | 'sandbox';

export type MapSizeId = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

export type MapLayout = 'islands' | 'coastal' | 'land';

export interface MapSizeDef {
  id: MapSizeId;
  tiles: number;
}

export interface MapTypeDef {
  id: MapTypeId;
  layout: MapLayout;
  landRatio: number;
  forestRatio: number;
  desertRatio: number;
  maxElevation: number;
  elevationRoughness: number;
  startZoneRadius: number;
  startResources: Record<string, number>;
  areaResources: Record<string, number>;
  areaAnimals: Record<string, number>;
  ruins: number;
  artifacts: number;
  sizeScale: Partial<Record<MapSizeId, number>>;
  params: Record<string, number>;
}

export interface MapsData {
  sizes: MapSizeDef[];
  types: MapTypeDef[];
}

export type AiDifficulty = 'easiest' | 'easy' | 'moderate' | 'hard' | 'hardest';

export const AI_DIFFICULTIES: readonly AiDifficulty[] = [
  'easiest',
  'easy',
  'moderate',
  'hard',
  'hardest',
];

export interface AiLevelDef {
  id: AiDifficulty;
  decisionIntervalTicks: number;
  maxVillagers: number;
  aggressiveness: number;
  microQuality: number;
  resourceBonus: Cost;
  params: Record<string, number>;
}

export interface AiData {
  levels: AiLevelDef[];
}

export type GameSpeed = 'slow' | 'normal' | 'fast';

export interface AgeRule {
  id: AgeId;
  technology: string | null;
  requiredBuildingCount: number;
  qualifyingBuildings: string[];
}

export interface ConversionRules {
  attemptInterval: number;
  guaranteedFailures: number;
  chance: number;
  faithMax: number;
  faithRechargeRate: number;
}

export interface ElevationRules {
  highGroundMultiplier: number;
  lowGroundMultiplier: number;
}

export interface TradeRules {
  minGold: number;
  maxGold: number;
  goodsPerTrip: number;
  maxDistance: number;
}

export interface StartRules {
  building: string;
  unit: string;
  unitCount: number;
}

export interface GameRules {
  tickRate: number;
  ticksPerGameYear: number;
  victoryCountdownYears: number;
  speedMultipliers: Record<GameSpeed, number>;
  tributeTax: number;
  tributeAmount: number;
  startingResources: ResourceAmounts;
  start: StartRules;
  populationLimits: number[];
  ages: AgeRule[];
  conversion: ConversionRules;
  elevation: ElevationRules;
  trade: TradeRules;
  source: DataSource;
  resourceLevels?: Record<string, ResourceAmounts>;
  nomadStart?: NomadStartRules;
}

export interface NomadStartRules {
  unitCount: number;
}

export interface GameData {
  readonly units: Readonly<Record<string, UnitDef>>;
  readonly buildings: Readonly<Record<string, BuildingDef>>;
  readonly technologies: Readonly<Record<string, TechnologyDef>>;
  readonly civilizations: Readonly<Record<string, CivilizationDef>>;
  readonly resources: Readonly<ResourcesData>;
  readonly resourceSources: Readonly<Record<string, ResourceSourceDef>>;
  readonly mapObjects: Readonly<Record<string, MapObjectDef>>;
  readonly maps: Readonly<MapsData>;
  readonly mapSizes: Readonly<Record<MapSizeId, MapSizeDef>>;
  readonly mapTypes: Readonly<Record<MapTypeId, MapTypeDef>>;
  readonly ai: Readonly<AiData>;
  readonly aiLevels: Readonly<Record<AiDifficulty, AiLevelDef>>;
  readonly game: Readonly<GameRules>;
}

export interface RawGameData {
  units: unknown;
  buildings: unknown;
  technologies: unknown;
  civilizations: unknown;
  resources: unknown;
  maps: unknown;
  ai: unknown;
  game: unknown;
}
