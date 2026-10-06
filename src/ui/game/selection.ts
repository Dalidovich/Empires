import type { EntityView } from '../../sim/snapshot';
import type { EntityId, PlayerId } from '../../sim/types';

export interface SelectionContext {
  playerId: PlayerId;
  entity(id: EntityId): EntityView | undefined;
}

export type SelectionKind = 'none' | 'ownUnits' | 'ownBuildings' | 'other';

function isOwn(ctx: SelectionContext, id: EntityId, kind: EntityView['kind']): boolean {
  const entity = ctx.entity(id);
  return entity !== undefined && entity.owner === ctx.playerId && entity.kind === kind;
}

export function selectionKind(ids: readonly EntityId[], ctx: SelectionContext): SelectionKind {
  if (ids.length === 0) {
    return 'none';
  }
  if (ids.every((id) => isOwn(ctx, id, 'unit'))) {
    return 'ownUnits';
  }
  if (ids.every((id) => isOwn(ctx, id, 'building'))) {
    return 'ownBuildings';
  }
  return 'other';
}

function union(current: readonly EntityId[], added: readonly EntityId[]): EntityId[] {
  const result = [...current];
  const seen = new Set(current);
  for (const id of added) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

function compatible(
  current: readonly EntityId[],
  added: readonly EntityId[],
  ctx: SelectionContext,
): boolean {
  if (current.length === 0 || added.length === 0) {
    return false;
  }
  const currentKind = selectionKind(current, ctx);
  const addedKind = selectionKind(added, ctx);
  if (currentKind === 'ownUnits' && addedKind === 'ownUnits') {
    return true;
  }
  if (currentKind === 'ownBuildings' && addedKind === 'ownBuildings') {
    const type = ctx.entity(current[0])?.type;
    return added.every((id) => ctx.entity(id)?.type === type);
  }
  return false;
}

export function clickSelect(
  current: readonly EntityId[],
  picked: EntityId | null,
  additive: boolean,
  ctx: SelectionContext,
): EntityId[] {
  if (picked === null || ctx.entity(picked) === undefined) {
    return additive ? [...current] : [];
  }
  if (!additive) {
    return [picked];
  }
  if (current.includes(picked)) {
    return current.filter((id) => id !== picked);
  }
  return compatible(current, [picked], ctx) ? union(current, [picked]) : [picked];
}

export function boxSelect(
  current: readonly EntityId[],
  candidates: readonly EntityId[],
  additive: boolean,
  ctx: SelectionContext,
): EntityId[] {
  const known = candidates.filter((id) => ctx.entity(id) !== undefined);
  let picked = known.filter((id) => isOwn(ctx, id, 'unit'));
  if (picked.length === 0) {
    picked = known.filter((id) => isOwn(ctx, id, 'building')).slice(0, 1);
  }
  if (picked.length === 0) {
    picked = known.slice(0, 1);
  }
  if (picked.length === 0) {
    return additive ? [...current] : [];
  }
  return additive && compatible(current, picked, ctx) ? union(current, picked) : picked;
}

export function sameTypeSelect(
  current: readonly EntityId[],
  picked: EntityId,
  candidates: readonly EntityId[],
  additive: boolean,
  ctx: SelectionContext,
): EntityId[] {
  const origin = ctx.entity(picked);
  if (origin === undefined) {
    return additive ? [...current] : [];
  }
  if (origin.owner !== ctx.playerId) {
    return [picked];
  }
  const matches = candidates.filter((id) => {
    const entity = ctx.entity(id);
    return (
      entity !== undefined &&
      entity.owner === ctx.playerId &&
      entity.kind === origin.kind &&
      entity.type === origin.type
    );
  });
  const group = union([picked], matches);
  return additive && compatible(current, group, ctx) ? union(current, group) : group;
}

export function pruneSelection(current: readonly EntityId[], ctx: SelectionContext): EntityId[] {
  return current.filter((id) => ctx.entity(id) !== undefined);
}

export function sameIds(a: readonly EntityId[], b: readonly EntityId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
