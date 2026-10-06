import type { GameData, MapObjectDef, MapObjectKind } from '../../data/types';
import { getEntity } from '../core/entities';
import { entityDistance } from '../core/geometry';
import { approach, isMoving, stopMoving } from '../core/movement';
import { entitiesInRadius } from '../core/spatial';
import type { StepContext, System } from '../system';
import type { Entity, GameState, PlayerId } from '../types';
import { GAIA_PLAYER_ID } from '../types';
import { isAlly, isEnemy } from './diplomacy';

const FOLLOW_RANGE = 1;
const SEARCH_MARGIN = 2;

interface Visitor {
  unit: Entity;
  gap: number;
}

export function relicsOfKind(state: GameState, data: GameData, kind: MapObjectKind): Entity[] {
  const found: Entity[] = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'object' && data.mapObjects[entity.type]?.kind === kind) {
      found.push(entity);
    }
  }
  return found;
}

function halt(relic: Entity): void {
  if (isMoving(relic)) {
    stopMoving(relic);
  }
  relic.state = 'idle';
}

export function releaseRelics(state: GameState, playerId: PlayerId): void {
  for (const entity of Object.values(state.entities)) {
    if (entity.kind === 'object' && entity.owner === playerId) {
      entity.owner = GAIA_PLAYER_ID;
      entity.heldBy = null;
      halt(entity);
    }
  }
}

function visitorsOf(state: GameState, relic: Entity, def: MapObjectDef, data: GameData): Visitor[] {
  const reach = def.captureRadius + def.size + SEARCH_MARGIN;
  const units = entitiesInRadius(state, relic.position, reach, (entity) => {
    const owner = state.players[entity.owner];
    return entity.kind === 'unit' && entity.hp > 0 && owner !== undefined && !owner.defeated;
  });
  const visitors: Visitor[] = [];
  for (const unit of units) {
    const gap = entityDistance(unit, relic, data);
    if (gap <= def.captureRadius) {
      visitors.push({ unit, gap });
    }
  }
  return visitors.sort((a, b) => a.gap - b.gap || a.unit.id - b.unit.id);
}

function capture(relic: Entity, unit: Entity, ctx: StepContext): void {
  relic.owner = unit.owner;
  ctx.events.push({
    type: 'relicCaptured',
    entityId: relic.id,
    entityType: relic.type,
    playerId: unit.owner,
    position: { x: relic.position.x, y: relic.position.y },
  });
}

function updateRuin(state: GameState, ruin: Entity, def: MapObjectDef, ctx: StepContext): void {
  const visitors = visitorsOf(state, ruin, def, ctx.data);
  if (visitors.some((visitor) => visitor.unit.owner === ruin.owner)) {
    return;
  }
  const taker = visitors.find((visitor) => !isAlly(state, visitor.unit.owner, ruin.owner));
  if (taker) {
    capture(ruin, taker.unit, ctx);
  }
}

function holderOf(state: GameState, artifact: Entity): Entity | null {
  const holder = getEntity(state, artifact.heldBy);
  if (
    !holder ||
    holder.kind !== 'unit' ||
    holder.owner !== artifact.owner ||
    holder.carriedBy !== null
  ) {
    return null;
  }
  return holder;
}

function updateArtifact(
  state: GameState,
  artifact: Entity,
  def: MapObjectDef,
  ctx: StepContext,
): void {
  const visitors = visitorsOf(state, artifact, def, ctx.data);
  let holder = holderOf(state, artifact);
  const guard = visitors.find((visitor) => visitor.unit.owner === artifact.owner);
  if (guard) {
    holder = holder ?? guard.unit;
  } else {
    const taker = visitors.find(
      (visitor) =>
        artifact.owner === GAIA_PLAYER_ID || isEnemy(state, visitor.unit.owner, artifact.owner),
    );
    if (taker) {
      capture(artifact, taker.unit, ctx);
      holder = taker.unit;
    }
  }
  if (!holder) {
    artifact.heldBy = null;
    halt(artifact);
    return;
  }
  artifact.heldBy = holder.id;
  approach(state, artifact, holder, FOLLOW_RANGE, ctx.data);
  artifact.state = isMoving(artifact) ? 'moving' : 'idle';
}

function update(state: GameState, ctx: StepContext): void {
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== 'object') {
      continue;
    }
    const def = ctx.data.mapObjects[entity.type];
    if (!def) {
      continue;
    }
    if (def.kind === 'ruin') {
      updateRuin(state, entity, def, ctx);
    } else if (def.kind === 'artifact') {
      updateArtifact(state, entity, def, ctx);
    }
  }
}

export const relicsSystem: System = {
  id: 'relics',
  update,
};
