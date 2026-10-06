import type {
  AgeId,
  AiDifficulty,
  Cost,
  GameSpeed,
  GatherKind,
  MapSizeId,
  MapTypeId,
  PlayerFlag,
  ResourceAmounts,
  ResourceKind,
} from '../data/types';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EntityId = number;

export type PlayerId = number;

export const GAIA_PLAYER_ID = -1;

export const MAX_PLAYERS = 8;

export interface Vec2 {
  x: number;
  y: number;
}

export interface TileCoord {
  x: number;
  y: number;
}

export type VictoryMode = 'conquest' | 'standard';

export interface Settings {
  mapType: MapTypeId;
  mapSize: MapSizeId;
  victoryMode: VictoryMode;
  populationLimit: number;
  startingAge: AgeId;
  revealMap: boolean;
  lockTeams: boolean;
  speed: GameSpeed;
  resourceLevel?: string;
  startMode?: StartMode;
  fullTechTree?: boolean;
}

export const TERRAIN = {
  grass: 0,
  desert: 1,
  forest: 2,
  shallows: 3,
  deepWater: 4,
  shore: 5,
  cliff: 6,
} as const;

export type TerrainName = keyof typeof TERRAIN;

export type TerrainCode = (typeof TERRAIN)[TerrainName];

export const TILE_FREE = 0;

export interface GameMap {
  size: number;
  terrain: number[];
  elevation: number[];
  occupancy: number[];
}

export type PlayerKind = 'human' | 'ai';

export type Stance = 'ally' | 'neutral' | 'enemy';

export interface PlayerSetup {
  id: PlayerId;
  kind: PlayerKind;
  civilization: string;
  team: number | null;
  color: number;
  difficulty: AiDifficulty | null;
}

export type PlayerStats = Record<string, number>;

export interface PlayerModifiers {
  flags: Partial<Record<PlayerFlag, boolean>>;
  state: JsonValue;
}

export type FogState = 0 | 1 | 2;

export const FOG = {
  unexplored: 0,
  explored: 1,
  visible: 2,
} as const;

export interface RememberedEntity {
  id: EntityId;
  kind: EntityKind;
  type: string;
  owner: PlayerId;
  position: Vec2;
  hp: number;
  buildProgress: number | null;
  tick: number;
}

export interface Player {
  id: PlayerId;
  kind: PlayerKind;
  civilization: string;
  team: number | null;
  color: number;
  difficulty: AiDifficulty | null;
  resources: ResourceAmounts;
  age: AgeId;
  researched: string[];
  diplomacy: Record<string, Stance>;
  explored: number[];
  visible: number[];
  remembered: Record<string, RememberedEntity>;
  sharedExploration: boolean;
  population: number;
  housing: number;
  modifiers: PlayerModifiers;
  aiState: JsonValue;
  stats: PlayerStats;
  defeated: boolean;
  resigned: boolean;
  fullTechTree?: boolean;
}

export type EntityKind = 'unit' | 'building' | 'resource' | 'object';

export type EntityState =
  | 'idle'
  | 'moving'
  | 'attacking'
  | 'gathering'
  | 'returning'
  | 'building'
  | 'repairing'
  | 'healing'
  | 'converting'
  | 'trading'
  | 'loading'
  | 'unloading'
  | 'carried'
  | 'fleeing'
  | 'foundation'
  | 'producing'
  | 'dying'
  | 'dead';

export interface MoveOrder {
  type: 'move';
  target: Vec2;
  groupTarget?: Vec2;
}

export interface AttackOrder {
  type: 'attack';
  targetId: EntityId;
}

export interface AttackMoveOrder {
  type: 'attackMove';
  target: Vec2;
}

export interface GatherOrder {
  type: 'gather';
  targetId: EntityId;
}

export interface DropOffOrder {
  type: 'dropOff';
  targetId: EntityId | null;
}

export interface BuildOrder {
  type: 'build';
  targetId: EntityId;
}

export interface RepairOrder {
  type: 'repair';
  targetId: EntityId;
}

export interface LoadOrder {
  type: 'load';
  targetId: EntityId;
}

export interface UnloadOrder {
  type: 'unload';
  target: Vec2;
}

export interface HealOrder {
  type: 'heal';
  targetId: EntityId;
}

export interface ConvertOrder {
  type: 'convert';
  targetId: EntityId;
}

export interface TradeOrder {
  type: 'trade';
  targetId: EntityId;
  good: TradeGood;
}

export interface FollowOrder {
  type: 'follow';
  targetId: EntityId;
}

export interface AttackGroundOrder {
  type: 'attackGround';
  target: Vec2;
}

export type Order =
  | MoveOrder
  | AttackOrder
  | AttackMoveOrder
  | GatherOrder
  | DropOffOrder
  | BuildOrder
  | RepairOrder
  | LoadOrder
  | UnloadOrder
  | HealOrder
  | ConvertOrder
  | TradeOrder
  | FollowOrder
  | AttackGroundOrder;

export type OrderType = Order['type'];

export type TradeGood = 'food' | 'wood' | 'stone';

export interface Carry {
  kind: GatherKind;
  resource: ResourceKind;
  amount: number;
}

export interface QueueItem {
  unit: string;
  progress: number;
  paid: Cost;
}

export interface ResearchSlot {
  technology: string;
  progress: number;
  paid: Cost;
}

export interface RallyPoint {
  position: Vec2;
  targetId: EntityId | null;
}

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  type: string;
  owner: PlayerId;
  position: Vec2;
  facing: number;
  hp: number;
  orders: Order[];
  state: EntityState;
  standGround: boolean;
  target: EntityId | null;
  attackCooldown: number;
  path: Vec2[] | null;
  anchor: Vec2 | null;
  carry: Carry | null;
  faith: number | null;
  conversionProgress: number;
  cargo: EntityId[];
  carriedBy: EntityId | null;
  buildProgress: number | null;
  paid: Cost | null;
  queue: QueueItem[];
  rallyPoint: RallyPoint | null;
  research: ResearchSlot | null;
  amount: number | null;
  workers: EntityId[];
  heldBy: EntityId | null;
  statsOwner: PlayerId | null;
  frozenStats: JsonValue;
  lastAttackedTick: number;
  lastAttackerId: EntityId | null;
  scratch: Record<string, JsonValue>;
}

export interface Projectile {
  id: number;
  owner: PlayerId;
  sourceId: EntityId;
  sourceType: string;
  targetId: EntityId | null;
  origin: Vec2;
  destination: Vec2;
  launchTick: number;
  arriveTick: number;
  damage: number;
  ranged: boolean;
  blastRadius: number;
  friendlyFire: boolean;
}

export type VictoryTimerKind = 'ruins' | 'artifacts' | 'wonder';

export interface VictoryTimer {
  kind: VictoryTimerKind;
  playerId: PlayerId;
  entityId: EntityId | null;
  startTick: number;
  endTick: number;
}

export type GameOverReason = 'conquest' | 'ruins' | 'artifacts' | 'wonder' | 'human_defeated';

export interface GameOutcome {
  winners: PlayerId[];
  reason: GameOverReason;
  tick: number;
}

export interface GameState {
  tick: number;
  seed: number;
  rngState: number;
  settings: Settings;
  map: GameMap;
  players: Player[];
  entities: Record<string, Entity>;
  projectiles: Projectile[];
  victoryTimers: VictoryTimer[];
  nextEntityId: number;
  nextProjectileId: number;
  paused: boolean;
  outcome: GameOutcome | null;
}

export interface EntitySpec {
  kind: EntityKind;
  type: string;
  owner: PlayerId;
  position: Vec2;
  amount?: number;
  buildProgress?: number;
  hp?: number;
}

export type StartMode = 'standard' | 'nomad' | 'post_iron';

export const START_MODES: readonly StartMode[] = ['standard', 'nomad', 'post_iron'];

export const DEFAULT_RESOURCE_LEVEL = 'default';
