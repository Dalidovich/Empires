import type { GameSpeed, ResourceKind } from '../data/types';
import type {
  AiDirectiveMode,
  EntityId,
  PlayerId,
  Stance,
  TileCoord,
  TradeGood,
  Vec2,
} from './types';

export interface MoveCommand {
  type: 'move';
  playerId: PlayerId;
  entityIds: EntityId[];
  target: Vec2;
  queued: boolean;
}

export interface AttackCommand {
  type: 'attack';
  playerId: PlayerId;
  entityIds: EntityId[];
  targetId: EntityId;
  queued: boolean;
}

export interface AttackMoveCommand {
  type: 'attackMove';
  playerId: PlayerId;
  entityIds: EntityId[];
  target: Vec2;
  queued: boolean;
}

export interface StopCommand {
  type: 'stop';
  playerId: PlayerId;
  entityIds: EntityId[];
}

export interface StandGroundCommand {
  type: 'standGround';
  playerId: PlayerId;
  entityIds: EntityId[];
  enabled: boolean;
}

export interface GatherCommand {
  type: 'gather';
  playerId: PlayerId;
  entityIds: EntityId[];
  targetId: EntityId;
  queued: boolean;
}

export interface PlaceBuildingCommand {
  type: 'placeBuilding';
  playerId: PlayerId;
  entityIds: EntityId[];
  building: string;
  tile: TileCoord;
  queued: boolean;
}

export interface PlaceWallCommand {
  type: 'placeWall';
  playerId: PlayerId;
  entityIds: EntityId[];
  building: string;
  from: TileCoord;
  to: TileCoord;
  queued: boolean;
}

export interface BuildCommand {
  type: 'build';
  playerId: PlayerId;
  entityIds: EntityId[];
  targetId: EntityId;
  queued: boolean;
}

export interface RepairCommand {
  type: 'repair';
  playerId: PlayerId;
  entityIds: EntityId[];
  targetId: EntityId;
  queued: boolean;
}

export interface LoadCommand {
  type: 'load';
  playerId: PlayerId;
  entityIds: EntityId[];
  transportId: EntityId;
  queued: boolean;
}

export interface UnloadCommand {
  type: 'unload';
  playerId: PlayerId;
  entityIds: EntityId[];
  target: Vec2;
  queued: boolean;
}

export interface HealCommand {
  type: 'heal';
  playerId: PlayerId;
  entityIds: EntityId[];
  targetId: EntityId;
  queued: boolean;
}

export interface ConvertCommand {
  type: 'convert';
  playerId: PlayerId;
  entityIds: EntityId[];
  targetId: EntityId;
  queued: boolean;
}

export interface TradeCommand {
  type: 'trade';
  playerId: PlayerId;
  entityIds: EntityId[];
  dockId: EntityId;
  good: TradeGood;
  queued: boolean;
}

export interface TrainCommand {
  type: 'train';
  playerId: PlayerId;
  buildingId: EntityId;
  unit: string;
  count: number;
}

export interface CancelQueueItemCommand {
  type: 'cancelQueueItem';
  playerId: PlayerId;
  buildingId: EntityId;
  index: number;
}

export interface ResearchCommand {
  type: 'research';
  playerId: PlayerId;
  buildingId: EntityId;
  technology: string;
}

export interface CancelResearchCommand {
  type: 'cancelResearch';
  playerId: PlayerId;
  buildingId: EntityId;
}

export interface SetRallyPointCommand {
  type: 'setRallyPoint';
  playerId: PlayerId;
  buildingIds: EntityId[];
  position: Vec2;
  targetId: EntityId | null;
}

export interface DeleteCommand {
  type: 'delete';
  playerId: PlayerId;
  entityIds: EntityId[];
}

export interface SetStanceCommand {
  type: 'setStance';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
  stance: Stance;
}

export interface TributeCommand {
  type: 'tribute';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
  resource: ResourceKind;
  amount: number;
}

export interface ResignCommand {
  type: 'resign';
  playerId: PlayerId;
}

export interface SetSpeedCommand {
  type: 'setSpeed';
  playerId: PlayerId;
  speed: GameSpeed;
}

export interface PauseCommand {
  type: 'pause';
  playerId: PlayerId;
  paused: boolean;
}

export interface AttackGroundCommand {
  type: 'attackGround';
  playerId: PlayerId;
  entityIds: EntityId[];
  target: Vec2;
  queued: boolean;
}

export interface SandboxAiCommand {
  type: 'sandboxAi';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
  mode: AiDirectiveMode;
  victimId: PlayerId | null;
}

export interface SandboxResourcesCommand {
  type: 'sandboxResources';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
  amount: number;
}

export type Command =
  | MoveCommand
  | AttackCommand
  | AttackMoveCommand
  | StopCommand
  | StandGroundCommand
  | GatherCommand
  | PlaceBuildingCommand
  | PlaceWallCommand
  | BuildCommand
  | RepairCommand
  | LoadCommand
  | UnloadCommand
  | HealCommand
  | ConvertCommand
  | TradeCommand
  | TrainCommand
  | CancelQueueItemCommand
  | ResearchCommand
  | CancelResearchCommand
  | SetRallyPointCommand
  | DeleteCommand
  | SetStanceCommand
  | TributeCommand
  | ResignCommand
  | SetSpeedCommand
  | PauseCommand
  | AttackGroundCommand
  | SandboxAiCommand
  | SandboxResourcesCommand;

export type CommandType = Command['type'];

export type CommandOf<T extends CommandType> = Extract<Command, { type: T }>;
