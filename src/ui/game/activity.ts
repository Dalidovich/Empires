import type { GameData, GatherKind } from '../../data/types';
import type { EntityView, PlayerView } from '../../sim/snapshot';
import type { GatherOrder } from '../../sim/types';

export type Activity =
  | 'idle'
  | 'move'
  | 'attack'
  | 'attack_move'
  | 'attack_ground'
  | 'hunt'
  | 'gather'
  | 'gather_forage'
  | 'gather_farm'
  | 'gather_wood'
  | 'gather_stone'
  | 'gather_gold'
  | 'gather_fish'
  | 'return'
  | 'build'
  | 'repair'
  | 'load'
  | 'unload'
  | 'heal'
  | 'convert'
  | 'trade'
  | 'follow'
  | 'flee';

const GATHER_ACTIVITY: Record<GatherKind, Activity> = {
  forage: 'gather_forage',
  farm: 'gather_farm',
  wood: 'gather_wood',
  stone: 'gather_stone',
  gold: 'gather_gold',
  hunt: 'hunt',
  shore_fish: 'gather_fish',
  boat_fish: 'gather_fish',
  trade: 'trade',
};

function gatherKindOf(
  entity: EntityView,
  order: GatherOrder,
  view: PlayerView,
  data: GameData,
): GatherKind | null {
  const target = view.entities.find((candidate) => candidate.id === order.targetId);
  if (target) {
    if (target.kind === 'unit' && data.units[target.type]?.animal) {
      return 'hunt';
    }
    if (target.kind === 'resource') {
      return data.resourceSources[target.type]?.gatherKind ?? null;
    }
    if (target.kind === 'building') {
      return 'farm';
    }
  }
  return entity.own?.carry?.kind ?? null;
}

function gatherActivity(
  entity: EntityView,
  order: GatherOrder,
  view: PlayerView,
  data: GameData,
): Activity {
  const kind = gatherKindOf(entity, order, view, data);
  return kind === null ? 'gather' : (GATHER_ACTIVITY[kind] ?? 'gather');
}

function unorderedActivity(entity: EntityView): Activity {
  switch (entity.state) {
    case 'attacking':
      return 'attack';
    case 'fleeing':
      return 'flee';
    case 'healing':
      return 'heal';
    case 'converting':
      return 'convert';
    case 'moving':
      return 'move';
    default:
      return 'idle';
  }
}

export function activityOf(entity: EntityView, view: PlayerView, data: GameData): Activity | null {
  const own = entity.own;
  if (entity.kind !== 'unit' || !own) {
    return null;
  }
  const order = own.orders[0];
  if (!order) {
    return unorderedActivity(entity);
  }
  switch (order.type) {
    case 'move':
      return 'move';
    case 'attack': {
      const next = own.orders[1];
      return next && next.type === 'gather' && next.targetId === order.targetId ? 'hunt' : 'attack';
    }
    case 'attackMove':
      return 'attack_move';
    case 'attackGround':
      return 'attack_ground';
    case 'gather':
      return gatherActivity(entity, order, view, data);
    case 'dropOff':
      return 'return';
    case 'build':
      return 'build';
    case 'repair':
      return 'repair';
    case 'load':
      return 'load';
    case 'unload':
      return 'unload';
    case 'heal':
      return 'heal';
    case 'convert':
      return 'convert';
    case 'trade':
      return 'trade';
    case 'follow':
      return 'follow';
    default:
      return unorderedActivity(entity);
  }
}
