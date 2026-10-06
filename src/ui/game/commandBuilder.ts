import type { GameData, UnitClass, UnitDef } from '../../data/types';
import type { Command } from '../../sim/commands';
import type { EntityView, PlayerView } from '../../sim/snapshot';
import type { EntityId, TileCoord, TradeGood, Vec2 } from '../../sim/types';
import { GAIA_PLAYER_ID } from '../../sim/types';
import { isCompleted } from './availability';

export interface CommandContext {
  view: PlayerView;
  data: GameData;
}

type Intent =
  | 'move'
  | 'attack'
  | 'gather'
  | 'build'
  | 'repair'
  | 'load'
  | 'heal'
  | 'convert'
  | 'trade';

const INTENT_ORDER: readonly Intent[] = [
  'attack',
  'gather',
  'build',
  'repair',
  'load',
  'heal',
  'convert',
  'trade',
  'move',
];

function unitHas(def: UnitDef | undefined, tag: UnitClass): boolean {
  return def !== undefined && def.class.includes(tag);
}

function isDamaged(entity: EntityView): boolean {
  return entity.hp < entity.maxHp;
}

function ownTargetIntent(ctx: CommandContext, def: UnitDef, target: EntityView): Intent {
  const villager = unitHas(def, 'villager');
  if (target.kind === 'building') {
    if (!villager) {
      return 'move';
    }
    if (!isCompleted(target)) {
      return 'build';
    }
    if (ctx.data.buildings[target.type]?.class.includes('farm')) {
      return 'gather';
    }
    return isDamaged(target) ? 'repair' : 'move';
  }
  const targetDef = ctx.data.units[target.type];
  if (unitHas(targetDef, 'transport_ship') && def.domain === 'land') {
    return 'load';
  }
  if (villager && unitHas(targetDef, 'ship') && isDamaged(target)) {
    return 'repair';
  }
  if (
    unitHas(def, 'priest') &&
    isDamaged(target) &&
    !unitHas(targetDef, 'ship') &&
    !unitHas(targetDef, 'machine')
  ) {
    return 'heal';
  }
  return 'move';
}

function foreignTargetIntent(ctx: CommandContext, def: UnitDef, target: EntityView): Intent {
  const ally = ctx.view.self.diplomacy[target.owner] === 'ally';
  if (
    unitHas(def, 'trade_ship') &&
    target.kind === 'building' &&
    ctx.data.buildings[target.type]?.class.includes('dock')
  ) {
    return 'trade';
  }
  if (unitHas(def, 'priest')) {
    if (!ally) {
      return 'convert';
    }
    return target.kind === 'unit' && isDamaged(target) ? 'heal' : 'move';
  }
  if (ally) {
    return 'move';
  }
  return def.attack > 0 ? 'attack' : 'move';
}

function unitIntent(ctx: CommandContext, unit: EntityView, target: EntityView | null): Intent {
  const def = ctx.data.units[unit.type];
  if (!def || target === null || target.id === unit.id) {
    return 'move';
  }
  if (target.kind === 'object') {
    return 'move';
  }
  if (target.kind === 'resource') {
    const source = ctx.data.resourceSources[target.type];
    if (!source) {
      return 'move';
    }
    if (unitHas(def, 'villager') && source.gatherKind !== 'boat_fish') {
      return 'gather';
    }
    return unitHas(def, 'fishing_ship') && source.domain === 'water' ? 'gather' : 'move';
  }
  if (target.owner === ctx.view.playerId) {
    return ownTargetIntent(ctx, def, target);
  }
  if (target.owner === GAIA_PLAYER_ID) {
    if (unitHas(def, 'villager') && unitHas(ctx.data.units[target.type], 'animal')) {
      return 'gather';
    }
    return def.attack > 0 && target.kind === 'unit' ? 'attack' : 'move';
  }
  return foreignTargetIntent(ctx, def, target);
}

function intentCommand(
  ctx: CommandContext,
  intent: Intent,
  entityIds: EntityId[],
  target: EntityView | null,
  world: Vec2,
  queued: boolean,
  tradeGood: TradeGood,
): Command {
  const playerId = ctx.view.playerId;
  if (intent === 'move' || target === null) {
    return { type: 'move', playerId, entityIds, target: world, queued };
  }
  const targetId = target.id;
  switch (intent) {
    case 'attack':
      return { type: 'attack', playerId, entityIds, targetId, queued };
    case 'gather':
      return { type: 'gather', playerId, entityIds, targetId, queued };
    case 'build':
      return { type: 'build', playerId, entityIds, targetId, queued };
    case 'repair':
      return { type: 'repair', playerId, entityIds, targetId, queued };
    case 'load':
      return { type: 'load', playerId, entityIds, transportId: targetId, queued };
    case 'heal':
      return { type: 'heal', playerId, entityIds, targetId, queued };
    case 'convert':
      return { type: 'convert', playerId, entityIds, targetId, queued };
    case 'trade':
      return { type: 'trade', playerId, entityIds, dockId: targetId, good: tradeGood, queued };
  }
}

export function ownUnitIds(view: PlayerView, selection: readonly EntityView[]): EntityId[] {
  return selection
    .filter((entity) => entity.owner === view.playerId && entity.kind === 'unit')
    .map((entity) => entity.id);
}

export function ownBuildingIds(view: PlayerView, selection: readonly EntityView[]): EntityId[] {
  return selection
    .filter((entity) => entity.owner === view.playerId && entity.kind === 'building')
    .map((entity) => entity.id);
}

export function contextCommands(
  ctx: CommandContext,
  selection: readonly EntityView[],
  target: EntityView | null,
  world: Vec2,
  queued: boolean,
  tradeGood: TradeGood,
): Command[] {
  const playerId = ctx.view.playerId;
  const units = selection.filter((entity) => entity.owner === playerId && entity.kind === 'unit');
  if (units.length === 0) {
    return rallyCommands(ctx.view, selection, target, world);
  }
  const byIntent = new Map<Intent, EntityId[]>();
  for (const unit of units) {
    const intent = unitIntent(ctx, unit, target);
    const ids = byIntent.get(intent) ?? [];
    ids.push(unit.id);
    byIntent.set(intent, ids);
  }
  const commands: Command[] = [];
  for (const intent of INTENT_ORDER) {
    const ids = byIntent.get(intent);
    if (ids) {
      commands.push(intentCommand(ctx, intent, ids, target, world, queued, tradeGood));
    }
  }
  return commands;
}

export function rallyCommands(
  view: PlayerView,
  selection: readonly EntityView[],
  target: EntityView | null,
  world: Vec2,
): Command[] {
  const buildingIds = ownBuildingIds(view, selection);
  if (buildingIds.length === 0) {
    return [];
  }
  return [
    {
      type: 'setRallyPoint',
      playerId: view.playerId,
      buildingIds,
      position: world,
      targetId: target?.id ?? null,
    },
  ];
}

export function attackMoveCommands(
  view: PlayerView,
  selection: readonly EntityView[],
  world: Vec2,
  queued: boolean,
): Command[] {
  const entityIds = ownUnitIds(view, selection);
  if (entityIds.length === 0) {
    return [];
  }
  return [{ type: 'attackMove', playerId: view.playerId, entityIds, target: world, queued }];
}

export function attackGroundCommands(
  ctx: CommandContext,
  selection: readonly EntityView[],
  world: Vec2,
  queued: boolean,
): Command[] {
  const entityIds = selection
    .filter(
      (entity) =>
        entity.owner === ctx.view.playerId &&
        entity.kind === 'unit' &&
        (ctx.data.units[entity.type]?.blastRadius ?? 0) > 0,
    )
    .map((entity) => entity.id);
  if (entityIds.length === 0) {
    return [];
  }
  return [{ type: 'attackGround', playerId: ctx.view.playerId, entityIds, target: world, queued }];
}

export function repairCommands(
  ctx: CommandContext,
  selection: readonly EntityView[],
  target: EntityView | null,
  queued: boolean,
): Command[] {
  if (target === null || target.owner !== ctx.view.playerId) {
    return [];
  }
  const entityIds = selection
    .filter(
      (entity) =>
        entity.owner === ctx.view.playerId && unitHas(ctx.data.units[entity.type], 'villager'),
    )
    .map((entity) => entity.id);
  if (entityIds.length === 0) {
    return [];
  }
  const playerId = ctx.view.playerId;
  if (target.kind === 'building' && !isCompleted(target)) {
    return [{ type: 'build', playerId, entityIds, targetId: target.id, queued }];
  }
  return [{ type: 'repair', playerId, entityIds, targetId: target.id, queued }];
}

export function unloadCommands(
  ctx: CommandContext,
  selection: readonly EntityView[],
  world: Vec2,
  queued: boolean,
): Command[] {
  const entityIds = selection
    .filter(
      (entity) =>
        entity.owner === ctx.view.playerId &&
        unitHas(ctx.data.units[entity.type], 'transport_ship'),
    )
    .map((entity) => entity.id);
  if (entityIds.length === 0) {
    return [];
  }
  return [{ type: 'unload', playerId: ctx.view.playerId, entityIds, target: world, queued }];
}

export function stopCommands(view: PlayerView, selection: readonly EntityView[]): Command[] {
  const entityIds = ownUnitIds(view, selection);
  return entityIds.length === 0 ? [] : [{ type: 'stop', playerId: view.playerId, entityIds }];
}

export function standGroundCommands(
  view: PlayerView,
  selection: readonly EntityView[],
  enabled: boolean,
): Command[] {
  const entityIds = ownUnitIds(view, selection);
  return entityIds.length === 0
    ? []
    : [{ type: 'standGround', playerId: view.playerId, entityIds, enabled }];
}

export function deleteCommands(view: PlayerView, selection: readonly EntityView[]): Command[] {
  const entityIds = selection
    .filter((entity) => entity.owner === view.playerId)
    .map((entity) => entity.id);
  return entityIds.length === 0 ? [] : [{ type: 'delete', playerId: view.playerId, entityIds }];
}

export function builderIds(ctx: CommandContext, selection: readonly EntityView[]): EntityId[] {
  return selection
    .filter(
      (entity) =>
        entity.owner === ctx.view.playerId && unitHas(ctx.data.units[entity.type], 'villager'),
    )
    .map((entity) => entity.id);
}

export function placeBuildingCommands(
  ctx: CommandContext,
  selection: readonly EntityView[],
  building: string,
  tile: TileCoord,
  queued: boolean,
): Command[] {
  const entityIds = builderIds(ctx, selection);
  if (entityIds.length === 0) {
    return [];
  }
  return [{ type: 'placeBuilding', playerId: ctx.view.playerId, entityIds, building, tile, queued }];
}

export function placeWallCommands(
  ctx: CommandContext,
  selection: readonly EntityView[],
  building: string,
  from: TileCoord,
  to: TileCoord,
  queued: boolean,
): Command[] {
  const entityIds = builderIds(ctx, selection);
  if (entityIds.length === 0) {
    return [];
  }
  return [
    { type: 'placeWall', playerId: ctx.view.playerId, entityIds, building, from, to, queued },
  ];
}
