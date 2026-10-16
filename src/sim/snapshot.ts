import type {
  AgeId,
  AiDifficulty,
  GameData,
  GameSpeed,
  PlayerFlag,
  ResourceAmounts,
} from '../data/types';
import type {
  AiDirective,
  Carry,
  Entity,
  EntityId,
  EntityKind,
  EntityState,
  GameOutcome,
  GameState,
  Order,
  PlayerId,
  Player,
  PlayerKind,
  QueueItem,
  RallyPoint,
  RememberedEntity,
  ResearchSlot,
  Settings,
  Stance,
  Vec2,
  VictoryTimer,
} from './types';
import { isEntityExplored, isEntityVisible } from './core/visibility';
import { getBuildingStats, getUnitStats } from './stats';

export interface MapView {
  size: number;
  terrain: number[];
  elevation: number[];
}

export interface FogView {
  explored: number[];
  visible: number[];
}

export interface EntityOwnDetails {
  orders: Order[];
  standGround: boolean;
  carry: Carry | null;
  faith: number | null;
  cargo: EntityId[];
  queue: QueueItem[];
  rallyPoint: RallyPoint | null;
  research: ResearchSlot | null;
}

export interface EntityView {
  id: EntityId;
  kind: EntityKind;
  type: string;
  owner: PlayerId;
  position: Vec2;
  facing: number;
  hp: number;
  maxHp: number;
  state: EntityState;
  target: EntityId | null;
  buildProgress: number | null;
  amount: number | null;
  heldBy: EntityId | null;
  remembered: boolean;
  own: EntityOwnDetails | null;
}

export interface ProjectileView {
  id: number;
  owner: PlayerId;
  sourceType: string;
  origin: Vec2;
  destination: Vec2;
  launchTick: number;
  arriveTick: number;
}

export interface PlayerSelfView {
  resources: ResourceAmounts;
  age: AgeId;
  researched: string[];
  population: number;
  housing: number;
  populationLimit: number;
  diplomacy: Record<string, Stance>;
  flags: Partial<Record<PlayerFlag, boolean>>;
  directiveTarget?: Vec2;
  sandboxGrantTick?: number;
}

export interface PlayerPublicView {
  id: PlayerId;
  kind: PlayerKind;
  civilization: string;
  team: number | null;
  color: number;
  difficulty: AiDifficulty | null;
  age: AgeId;
  defeated: boolean;
  stanceTowardViewer: Stance | null;
  score: number;
  aiDirective?: AiDirective;
}

export interface PlayerView {
  tick: number;
  playerId: PlayerId;
  settings: Settings;
  speed: GameSpeed;
  paused: boolean;
  self: PlayerSelfView;
  players: PlayerPublicView[];
  map: MapView;
  fog: FogView;
  entities: EntityView[];
  projectiles: ProjectileView[];
  victoryTimers: VictoryTimer[];
  outcome: GameOutcome | null;
}

type HpCache = Map<string, number>;

function maxHpFor(
  state: GameState,
  kind: EntityKind,
  type: string,
  owner: PlayerId,
  fallback: number,
  data: GameData,
  cache: HpCache,
): number {
  if (kind !== 'unit' && kind !== 'building') {
    return fallback;
  }
  const key = `${kind}:${owner}:${type}`;
  let hp = cache.get(key);
  if (hp === undefined) {
    if (kind === 'unit') {
      hp = data.units[type] ? getUnitStats(state, owner, type, data).hp : fallback;
    } else {
      hp = data.buildings[type] ? getBuildingStats(state, owner, type, data).hp : fallback;
    }
    cache.set(key, hp);
  }
  return hp;
}

function ownDetails(entity: Entity): EntityOwnDetails {
  return {
    orders: entity.orders,
    standGround: entity.standGround,
    carry: entity.carry,
    faith: entity.faith,
    cargo: entity.cargo,
    queue: entity.queue,
    rallyPoint: entity.rallyPoint,
    research: entity.research,
  };
}

function viewEntity(
  state: GameState,
  entity: Entity,
  playerId: PlayerId,
  data: GameData,
  cache: HpCache,
): EntityView {
  return {
    id: entity.id,
    kind: entity.kind,
    type: entity.type,
    owner: entity.owner,
    position: entity.position,
    facing: entity.facing,
    hp: entity.hp,
    maxHp: maxHpFor(
      state,
      entity.kind,
      entity.type,
      entity.statsOwner ?? entity.owner,
      entity.hp,
      data,
      cache,
    ),
    state: entity.state,
    target: entity.target,
    buildProgress: entity.buildProgress,
    amount: entity.amount,
    heldBy: entity.heldBy,
    remembered: false,
    own: entity.owner === playerId ? ownDetails(entity) : null,
  };
}

function viewRemembered(
  state: GameState,
  known: RememberedEntity,
  data: GameData,
  cache: HpCache,
): EntityView {
  return {
    id: known.id,
    kind: known.kind,
    type: known.type,
    owner: known.owner,
    position: known.position,
    facing: 0,
    hp: known.hp,
    maxHp: maxHpFor(state, known.kind, known.type, known.owner, known.hp, data, cache),
    state: known.buildProgress !== null && known.buildProgress < 1 ? 'foundation' : 'idle',
    target: null,
    buildProgress: known.buildProgress,
    amount: null,
    heldBy: null,
    remembered: true,
    own: null,
  };
}

function isStatic(entity: Entity, data: GameData): boolean {
  if (entity.kind === 'resource') {
    return true;
  }
  return entity.kind === 'object' && data.mapObjects[entity.type]?.kind === 'ruin';
}

function viewEntities(state: GameState, player: Player, data: GameData): EntityView[] {
  const cache: HpCache = new Map();
  const views: EntityView[] = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.carriedBy !== null) {
      continue;
    }
    const shown =
      entity.owner === player.id ||
      (isStatic(entity, data)
        ? isEntityExplored(state, player.id, entity, data)
        : isEntityVisible(state, player.id, entity, data));
    if (shown) {
      views.push(viewEntity(state, entity, player.id, data, cache));
    }
  }
  for (const known of Object.values(player.remembered)) {
    const entity = state.entities[known.id];
    if (entity && isEntityVisible(state, player.id, entity, data)) {
      continue;
    }
    views.push(viewRemembered(state, known, data, cache));
  }
  return views;
}

function viewProjectiles(state: GameState, player: Player): ProjectileView[] {
  const size = state.map.size;
  const seen = (point: Vec2): boolean => {
    const x = Math.floor(point.x);
    const y = Math.floor(point.y);
    return x >= 0 && y >= 0 && x < size && y < size && player.visible[y * size + x] > 0;
  };
  const views: ProjectileView[] = [];
  for (const projectile of state.projectiles) {
    if (
      projectile.owner !== player.id &&
      !seen(projectile.origin) &&
      !seen(projectile.destination)
    ) {
      continue;
    }
    views.push({
      id: projectile.id,
      owner: projectile.owner,
      sourceType: projectile.sourceType,
      origin: projectile.origin,
      destination: projectile.destination,
      launchTick: projectile.launchTick,
      arriveTick: projectile.arriveTick,
    });
  }
  return views;
}

function viewPlayers(state: GameState, playerId: PlayerId): PlayerPublicView[] {
  return state.players.map((other) => {
    const view: PlayerPublicView = {
      id: other.id,
      kind: other.kind,
      civilization: other.civilization,
      team: other.team,
      color: other.color,
      difficulty: other.difficulty,
      age: other.age,
      defeated: other.defeated,
      stanceTowardViewer: other.id === playerId ? null : (other.diplomacy[playerId] ?? null),
      score: other.stats.score ?? 0,
    };
    if (other.aiDirective) {
      view.aiDirective = other.aiDirective;
    }
    return view;
  });
}

function directiveTarget(state: GameState, player: Player): Vec2 | null {
  const directive = player.aiDirective;
  if (!directive || directive.mode !== 'attack' || directive.victimId === null) {
    return null;
  }
  let unit: Entity | null = null;
  for (const entity of Object.values(state.entities)) {
    if (entity.owner !== directive.victimId || entity.carriedBy !== null) {
      continue;
    }
    if (entity.kind === 'building') {
      return entity.position;
    }
    if (entity.kind === 'unit' && unit === null) {
      unit = entity;
    }
  }
  return unit ? unit.position : null;
}

function viewSelf(state: GameState, player: Player): PlayerSelfView {
  const self: PlayerSelfView = {
    resources: player.resources,
    age: player.age,
    researched: player.researched,
    population: player.population,
    housing: player.housing,
    populationLimit: state.settings.populationLimit,
    diplomacy: player.diplomacy,
    flags: player.modifiers.flags,
  };
  const target = directiveTarget(state, player);
  if (target) {
    self.directiveTarget = target;
  }
  if (player.sandboxGrantTick !== undefined) {
    self.sandboxGrantTick = player.sandboxGrantTick;
  }
  return self;
}

export function buildPlayerView(state: GameState, playerId: PlayerId, data: GameData): PlayerView {
  const player = state.players[playerId];
  if (!player) {
    throw new Error(`Unknown player: ${playerId}`);
  }
  return {
    tick: state.tick,
    playerId,
    settings: state.settings,
    speed: state.settings.speed,
    paused: state.paused,
    self: viewSelf(state, player),
    players: viewPlayers(state, playerId),
    map: {
      size: state.map.size,
      terrain: state.map.terrain,
      elevation: state.map.elevation,
    },
    fog: {
      explored: player.explored,
      visible: player.visible,
    },
    entities: viewEntities(state, player, data),
    projectiles: viewProjectiles(state, player),
    victoryTimers: state.victoryTimers,
    outcome: state.outcome,
  };
}
