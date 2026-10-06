import { describe, expect, it } from 'vitest';
import {
  applyDamage,
  isFootprintFree,
  killEntity,
  removeEntity,
  spawnEntity,
} from '../core/entities';
import { distanceToEntity, elevationAt, entityDistance, inRange } from '../core/geometry';
import { entitiesInRadius, nearestEntity, setEntityPosition } from '../core/spatial';
import { GAIA_PLAYER_ID, TILE_FREE } from '../types';
import { addBuilding, addTree, addUnit, context, data, emptyState, run } from './fixtures';

describe('core helpers', () => {
  it('finds entities by radius in id order and follows position changes', () => {
    const state = emptyState(64);
    const a = addUnit(state, 'villager', 0, 10.5, 10.5);
    const b = addUnit(state, 'villager', 1, 12.5, 10.5);
    const c = addUnit(state, 'villager', 1, 30.5, 30.5);
    expect(entitiesInRadius(state, { x: 11, y: 10.5 }, 3).map((e) => e.id)).toEqual([a.id, b.id]);
    expect(
      entitiesInRadius(state, { x: 11, y: 10.5 }, 3, (e) => e.owner === 1).map((e) => e.id),
    ).toEqual([b.id]);
    setEntityPosition(state, c, 11.5, 11.5);
    expect(entitiesInRadius(state, { x: 11, y: 10.5 }, 3).map((e) => e.id)).toEqual([
      a.id,
      b.id,
      c.id,
    ]);
    removeEntity(state, b.id, data);
    expect(entitiesInRadius(state, { x: 11, y: 10.5 }, 3).map((e) => e.id)).toEqual([a.id, c.id]);
  });

  it('finds the nearest entity by predicate and breaks ties by id', () => {
    const state = emptyState(64);
    addUnit(state, 'villager', 0, 20.5, 20.5);
    const left = addTree(state, 17, 20);
    const right = addTree(state, 23, 20);
    const distant = addTree(state, 50, 50);
    const isTree = (entity: { type: string }): boolean => entity.type === 'tree';
    expect(nearestEntity(state, { x: 20.5, y: 20.5 }, 10, isTree)?.id).toBe(left.id);
    expect(nearestEntity(state, { x: 22, y: 20.5 }, 10, isTree)?.id).toBe(right.id);
    expect(nearestEntity(state, { x: 40, y: 40 }, 60, isTree)?.id).toBe(distant.id);
    expect(nearestEntity(state, { x: 40, y: 40 }, 5, isTree)).toBeNull();
  });

  it('measures distance to footprints and unit bodies', () => {
    const state = emptyState(32);
    const center = addBuilding(state, 'town_center', 0, 10, 10);
    const villager = addUnit(state, 'villager', 0, 9.5, 11.5);
    const other = addUnit(state, 'villager', 1, 5.5, 11.5);
    expect(distanceToEntity({ x: 8, y: 11.5 }, center, data)).toBeCloseTo(2);
    expect(distanceToEntity({ x: 11, y: 11 }, center, data)).toBe(0);
    expect(inRange(villager, center, 0, data)).toBe(true);
    expect(inRange(other, center, 0, data)).toBe(false);
    expect(inRange(other, center, 4, data)).toBe(true);
    expect(entityDistance(villager, other, data)).toBeCloseTo(4 - 0.6);
    state.map.elevation[11 * 32 + 9] = 3;
    expect(elevationAt(state.map, villager.position)).toBe(3);
  });

  it('occupies and releases building footprints', () => {
    const state = emptyState(32);
    expect(isFootprintFree(state.map, { x: 10, y: 10 }, 2)).toBe(true);
    const house = addBuilding(state, 'house', 0, 10, 10);
    expect(isFootprintFree(state.map, { x: 11, y: 11 }, 2)).toBe(false);
    expect(isFootprintFree(state.map, { x: 31, y: 31 }, 2)).toBe(false);
    const ctx = context();
    killEntity(state, house.id, ctx, 1);
    expect(state.map.occupancy.every((value) => value === TILE_FREE)).toBe(true);
    expect(state.players[0].stats.buildingsLost).toBe(1);
    expect(state.players[1].stats.buildingsRazed).toBe(1);
  });

  it('applies damage, records the attacker and kills at zero hit points', () => {
    const state = emptyState(32);
    const ctx = context();
    const attacker = addUnit(state, 'clubman', 1, 10.5, 10.5);
    const victim = addUnit(state, 'villager', 0, 11.5, 10.5);
    run(state, ctx, 3);
    expect(applyDamage(state, victim, 10, ctx, attacker.id, attacker.owner)).toBe(false);
    expect(victim.hp).toBe(15);
    expect(victim.lastAttackedTick).toBe(3);
    expect(victim.lastAttackerId).toBe(attacker.id);
    expect(applyDamage(state, victim, 0, ctx, attacker.id, attacker.owner)).toBe(false);
    expect(applyDamage(state, victim, 100, ctx, attacker.id, attacker.owner)).toBe(true);
    expect(state.entities[victim.id]).toBeUndefined();
    expect(ctx.events).toEqual([
      {
        type: 'entityDied',
        entityId: victim.id,
        entityKind: 'unit',
        entityType: 'villager',
        owner: 0,
        killerOwner: 1,
        position: { x: 11.5, y: 10.5 },
      },
    ]);
    expect(state.players[0].stats.unitsLost).toBe(1);
    expect(state.players[1].stats.unitsKilled).toBe(1);
    expect(applyDamage(state, victim, 5, ctx)).toBe(false);
  });

  it('turns a killed animal into a carcass with its food', () => {
    const state = emptyState(32);
    const ctx = context();
    const gazelle = addUnit(state, 'gazelle', GAIA_PLAYER_ID, 10.5, 10.5);
    killEntity(state, gazelle.id, ctx, 0);
    const remains = Object.values(state.entities);
    expect(remains).toHaveLength(1);
    expect(remains[0].kind).toBe('resource');
    expect(remains[0].type).toBe('gazelle_carcass');
    expect(remains[0].amount).toBe(data.units.gazelle.animal?.food);
    expect(remains[0].position).toEqual({ x: 10.5, y: 10.5 });
    expect(state.players[0].stats.unitsKilled).toBe(0);
    expect(entitiesInRadius(state, { x: 10.5, y: 10.5 }, 1).map((e) => e.id)).toEqual([
      remains[0].id,
    ]);
  });

  it('releases objects held by a removed unit', () => {
    const state = emptyState(32);
    const carrier = addUnit(state, 'villager', 0, 10.5, 10.5);
    const artifact = spawnEntity(
      state,
      { kind: 'object', type: 'artifact', owner: 0, position: { x: 10.5, y: 11.5 } },
      data,
    );
    artifact.heldBy = carrier.id;
    removeEntity(state, carrier.id, data);
    expect(artifact.heldBy).toBeNull();
  });
});
