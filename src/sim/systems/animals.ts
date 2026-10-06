import type { AnimalDef, GameData } from '../../data/types';
import { removeEntity } from '../core/entities';
import { distance } from '../core/geometry';
import { isMoving, moveToward } from '../core/movement';
import { clearOrders, issueOrder } from '../core/orders';
import { nearestEntity } from '../core/spatial';
import { getUnitStats } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, GameState } from '../types';
import { GAIA_PLAYER_ID } from '../types';

const DECAY_KEY = 'decay';
const SCAN_INTERVAL = 5;
const FLEE_DISTANCE = 6;
const ATTACK_MEMORY_SECONDS = 10;

function decayCarcasses(state: GameState, ctx: StepContext): void {
  const perTick = ctx.data.resources.carcassDecayRate / ctx.data.game.tickRate;
  if (perTick <= 0) {
    return;
  }
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'resource' || ctx.data.resourceSources[entity.type]?.gatherKind !== 'hunt') {
      continue;
    }
    const stored = entity.scratch[DECAY_KEY];
    const progress = (typeof stored === 'number' ? stored : 0) + perTick;
    const lost = Math.floor(progress);
    entity.scratch[DECAY_KEY] = progress - lost;
    if (lost === 0) {
      continue;
    }
    entity.amount = (entity.amount ?? 0) - lost;
    if (entity.amount < 1) {
      removeEntity(state, entity.id, ctx.data);
    }
  }
}

function isVictim(entity: Entity, data: GameData): boolean {
  return (
    entity.kind === 'unit' &&
    entity.owner !== GAIA_PLAYER_ID &&
    entity.hp > 0 &&
    data.units[entity.type]?.domain === 'land'
  );
}

function recentAttacker(state: GameState, animal: Entity, data: GameData): Entity | null {
  if (animal.lastAttackerId === null || animal.lastAttackedTick < 0) {
    return null;
  }
  if (state.tick - animal.lastAttackedTick > ATTACK_MEMORY_SECONDS * data.game.tickRate) {
    return null;
  }
  const attacker = state.entities[animal.lastAttackerId];
  return attacker && attacker.carriedBy === null ? attacker : null;
}

function flee(state: GameState, animal: Entity, def: AnimalDef, data: GameData): void {
  const threat =
    recentAttacker(state, animal, data) ??
    nearestEntity(state, animal.position, def.aggroRadius, (entity) => isVictim(entity, data));
  if (!threat) {
    if (animal.state === 'fleeing' && !isMoving(animal)) {
      animal.state = 'idle';
    }
    return;
  }
  let dx = animal.position.x - threat.position.x;
  let dy = animal.position.y - threat.position.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length > 0) {
    dx /= length;
    dy /= length;
  } else {
    dx = 1;
    dy = 0;
  }
  const limit = state.map.size - 0.5;
  const goal = {
    x: Math.min(limit, Math.max(0.5, animal.position.x + dx * FLEE_DISTANCE)),
    y: Math.min(limit, Math.max(0.5, animal.position.y + dy * FLEE_DISTANCE)),
  };
  moveToward(state, animal, goal);
  animal.state = 'fleeing';
}

function hunt(
  state: GameState,
  animal: Entity,
  def: AnimalDef,
  data: GameData,
  retaliateOnly: boolean,
): void {
  const leash = getUnitStats(state, animal.owner, animal.type, data).lineOfSight + def.aggroRadius;
  const order = animal.orders[0];
  if (order && order.type === 'attack') {
    const target = state.entities[order.targetId];
    if (target && target.carriedBy === null && distance(animal.position, target.position) <= leash) {
      return;
    }
    clearOrders(animal);
  }
  const attacker = recentAttacker(state, animal, data);
  let victim: Entity | null = null;
  if (attacker && isVictim(attacker, data) && distance(animal.position, attacker.position) <= leash) {
    victim = attacker;
  } else if (!retaliateOnly) {
    victim = nearestEntity(state, animal.position, def.aggroRadius, (entity) =>
      isVictim(entity, data),
    );
  }
  if (victim) {
    issueOrder(animal, { type: 'attack', targetId: victim.id }, false);
  }
}

function update(state: GameState, ctx: StepContext): void {
  decayCarcasses(state, ctx);
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'unit' || entity.owner !== GAIA_PLAYER_ID) {
      continue;
    }
    if ((state.tick + entity.id) % SCAN_INTERVAL !== 0) {
      continue;
    }
    const def = ctx.data.units[entity.type]?.animal;
    if (!def) {
      continue;
    }
    switch (def.behavior) {
      case 'flee':
        flee(state, entity, def, ctx.data);
        break;
      case 'aggressive':
        hunt(state, entity, def, ctx.data, false);
        break;
      case 'retaliate':
        hunt(state, entity, def, ctx.data, true);
        break;
      default:
        break;
    }
  }
}

export const animalsSystem: System = {
  id: 'animals',
  update,
};
