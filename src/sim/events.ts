import type { AgeId, GatherKind, ResourceKind } from '../data/types';
import type { CommandType } from './commands';
import type {
  EntityId,
  EntityKind,
  GameOverReason,
  PlayerId,
  PlayerStats,
  Stance,
  Vec2,
  VictoryTimerKind,
} from './types';

export interface AttackHitEvent {
  type: 'attackHit';
  attackerId: EntityId;
  attackerType: string;
  targetId: EntityId;
  position: Vec2;
}

export interface ProjectileLaunchedEvent {
  type: 'projectileLaunched';
  sourceId: EntityId;
  sourceType: string;
  position: Vec2;
}

export interface EntityDiedEvent {
  type: 'entityDied';
  entityId: EntityId;
  entityKind: EntityKind;
  entityType: string;
  owner: PlayerId;
  killerOwner: PlayerId | null;
  position: Vec2;
}

export interface GatherStrikeEvent {
  type: 'gatherStrike';
  entityId: EntityId;
  gatherKind: GatherKind;
  position: Vec2;
}

export interface ConstructionStrikeEvent {
  type: 'constructionStrike';
  entityId: EntityId;
  buildingId: EntityId;
  position: Vec2;
}

export interface BuildingPlacedEvent {
  type: 'buildingPlaced';
  playerId: PlayerId;
  buildingId: EntityId;
  buildingType: string;
  position: Vec2;
}

export interface BuildingCompletedEvent {
  type: 'buildingCompleted';
  playerId: PlayerId;
  buildingId: EntityId;
  buildingType: string;
  position: Vec2;
}

export interface UnitTrainedEvent {
  type: 'unitTrained';
  playerId: PlayerId;
  entityId: EntityId;
  unitType: string;
  position: Vec2;
}

export interface ResearchCompletedEvent {
  type: 'researchCompleted';
  playerId: PlayerId;
  technology: string;
  position: Vec2;
}

export interface AgeAdvancedEvent {
  type: 'ageAdvanced';
  playerId: PlayerId;
  age: AgeId;
}

export interface UnderAttackEvent {
  type: 'underAttack';
  playerId: PlayerId;
  attackerOwner: PlayerId;
  position: Vec2;
}

export interface UnitConvertedEvent {
  type: 'unitConverted';
  entityId: EntityId;
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  position: Vec2;
}

export interface HousingShortEvent {
  type: 'housingShort';
  playerId: PlayerId;
}

export interface PopulationLimitEvent {
  type: 'populationLimit';
  playerId: PlayerId;
}

export interface InsufficientResourcesEvent {
  type: 'insufficientResources';
  playerId: PlayerId;
  resource: ResourceKind;
}

export type CommandRejectReason =
  | 'invalid'
  | 'not_owner'
  | 'resources'
  | 'age'
  | 'prerequisite'
  | 'housing'
  | 'population_limit'
  | 'placement'
  | 'teams_locked'
  | 'busy'
  | 'unavailable';

export interface CommandRejectedEvent {
  type: 'commandRejected';
  playerId: PlayerId;
  command: CommandType;
  reason: CommandRejectReason;
}

export interface TributeEvent {
  type: 'tribute';
  fromPlayerId: PlayerId;
  toPlayerId: PlayerId;
  resource: ResourceKind;
  amount: number;
}

export interface StanceChangedEvent {
  type: 'stanceChanged';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
  stance: Stance;
}

export interface TradeCompletedEvent {
  type: 'tradeCompleted';
  playerId: PlayerId;
  entityId: EntityId;
  gold: number;
  position: Vec2;
}

export interface RelicCapturedEvent {
  type: 'relicCaptured';
  entityId: EntityId;
  entityType: string;
  playerId: PlayerId;
  position: Vec2;
}

export interface VictoryTimerStartedEvent {
  type: 'victoryTimerStarted';
  kind: VictoryTimerKind;
  playerId: PlayerId;
  endTick: number;
}

export interface VictoryTimerResetEvent {
  type: 'victoryTimerReset';
  kind: VictoryTimerKind;
  playerId: PlayerId;
}

export interface PlayerDefeatedEvent {
  type: 'playerDefeated';
  playerId: PlayerId;
  resigned: boolean;
}

export interface GameOverPlayerSummary {
  playerId: PlayerId;
  winner: boolean;
  score: number;
  stats: PlayerStats;
}

export interface GameOverEvent {
  type: 'gameOver';
  winners: PlayerId[];
  reason: GameOverReason;
  players: GameOverPlayerSummary[];
}

export type SimEvent =
  | AttackHitEvent
  | ProjectileLaunchedEvent
  | EntityDiedEvent
  | GatherStrikeEvent
  | ConstructionStrikeEvent
  | BuildingPlacedEvent
  | BuildingCompletedEvent
  | UnitTrainedEvent
  | ResearchCompletedEvent
  | AgeAdvancedEvent
  | UnderAttackEvent
  | UnitConvertedEvent
  | HousingShortEvent
  | PopulationLimitEvent
  | InsufficientResourcesEvent
  | CommandRejectedEvent
  | TributeEvent
  | StanceChangedEvent
  | TradeCompletedEvent
  | RelicCapturedEvent
  | VictoryTimerStartedEvent
  | VictoryTimerResetEvent
  | PlayerDefeatedEvent
  | GameOverEvent;

export type SimEventType = SimEvent['type'];

export type SimEventOf<T extends SimEventType> = Extract<SimEvent, { type: T }>;
