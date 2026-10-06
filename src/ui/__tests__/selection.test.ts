import { describe, expect, it } from 'vitest';
import type { EntityView } from '../../sim/snapshot';
import { ControlGroups, DOUBLE_PRESS_MS } from '../game/controlGroups';
import type { SelectionContext } from '../game/selection';
import {
  boxSelect,
  clickSelect,
  pruneSelection,
  sameTypeSelect,
  selectionKind,
} from '../game/selection';

function entity(id: number, kind: EntityView['kind'], type: string, owner: number): EntityView {
  return {
    id,
    kind,
    type,
    owner,
    position: { x: 0, y: 0 },
    facing: 0,
    hp: 10,
    maxHp: 10,
    state: 'idle',
    target: null,
    buildProgress: null,
    amount: null,
    heldBy: null,
    remembered: false,
    own: null,
  };
}

const entities = new Map<number, EntityView>(
  [
    entity(1, 'unit', 'villager', 0),
    entity(2, 'unit', 'villager', 0),
    entity(3, 'unit', 'clubman', 0),
    entity(4, 'building', 'house', 0),
    entity(5, 'building', 'house', 0),
    entity(6, 'building', 'barracks', 0),
    entity(7, 'unit', 'clubman', 1),
    entity(8, 'resource', 'tree', -1),
  ].map((item) => [item.id, item]),
);

const ctx: SelectionContext = { playerId: 0, entity: (id) => entities.get(id) };

describe('click selection', () => {
  it('selects one entity and clears on empty ground', () => {
    expect(clickSelect([], 1, false, ctx)).toEqual([1]);
    expect(clickSelect([1, 2], 3, false, ctx)).toEqual([3]);
    expect(clickSelect([1, 2], null, false, ctx)).toEqual([]);
    expect(clickSelect([], 7, false, ctx)).toEqual([7]);
  });

  it('adds and removes with Shift', () => {
    expect(clickSelect([1], 2, true, ctx)).toEqual([1, 2]);
    expect(clickSelect([1, 2], 1, true, ctx)).toEqual([2]);
    expect(clickSelect([1, 2], null, true, ctx)).toEqual([1, 2]);
  });

  it('does not mix own units with foreign entities or buildings', () => {
    expect(clickSelect([1], 7, true, ctx)).toEqual([7]);
    expect(clickSelect([1], 4, true, ctx)).toEqual([4]);
    expect(clickSelect([4], 5, true, ctx)).toEqual([4, 5]);
    expect(clickSelect([4], 6, true, ctx)).toEqual([6]);
  });
});

describe('box selection', () => {
  it('prefers own units and has no size limit', () => {
    expect(boxSelect([], [1, 2, 3, 4, 7, 8], false, ctx)).toEqual([1, 2, 3]);
    const many: number[] = [];
    const crowd = new Map(entities);
    for (let id = 100; id < 160; id++) {
      crowd.set(id, entity(id, 'unit', 'clubman', 0));
      many.push(id);
    }
    const big: SelectionContext = { playerId: 0, entity: (id) => crowd.get(id) };
    expect(boxSelect([], many, false, big)).toHaveLength(60);
  });

  it('falls back to one own building, then to one other entity', () => {
    expect(boxSelect([], [4, 5, 7], false, ctx)).toEqual([4]);
    expect(boxSelect([], [7, 8], false, ctx)).toEqual([7]);
  });

  it('extends with Shift and keeps the selection on an empty box', () => {
    expect(boxSelect([1], [2, 3], true, ctx)).toEqual([1, 2, 3]);
    expect(boxSelect([1], [], true, ctx)).toEqual([1]);
    expect(boxSelect([1], [], false, ctx)).toEqual([]);
  });
});

describe('double-click selection', () => {
  it('selects own entities of the same type among the visible ones', () => {
    expect(sameTypeSelect([], 1, [1, 2, 3, 7], false, ctx)).toEqual([1, 2]);
    expect(sameTypeSelect([3], 1, [1, 2, 3], true, ctx)).toEqual([3, 1, 2]);
    expect(sameTypeSelect([], 7, [3, 7], false, ctx)).toEqual([7]);
  });
});

describe('selection maintenance', () => {
  it('drops entities that disappeared and classifies the selection', () => {
    expect(pruneSelection([1, 99, 2], ctx)).toEqual([1, 2]);
    expect(selectionKind([], ctx)).toBe('none');
    expect(selectionKind([1, 3], ctx)).toBe('ownUnits');
    expect(selectionKind([4, 6], ctx)).toBe('ownBuildings');
    expect(selectionKind([1, 4], ctx)).toBe('other');
    expect(selectionKind([7], ctx)).toBe('other');
  });
});

describe('control groups', () => {
  it('assigns and recalls groups 1 to 9', () => {
    const groups = new ControlGroups();
    groups.assign(1, [1, 2, 2]);
    groups.assign(9, [3]);
    groups.assign(0, [1]);
    groups.assign(10, [1]);
    expect(groups.get(1)).toEqual([1, 2]);
    expect(groups.recall(9, 0)?.ids).toEqual([3]);
    expect(groups.recall(0, 0)).toBeNull();
    expect(groups.recall(10, 0)).toBeNull();
    expect(groups.recall(5, 0)).toBeNull();
  });

  it('centres the camera on a double press only', () => {
    const groups = new ControlGroups();
    groups.assign(2, [1]);
    groups.assign(3, [2]);
    expect(groups.recall(2, 1000)?.center).toBe(false);
    expect(groups.recall(2, 1000 + DOUBLE_PRESS_MS)?.center).toBe(true);
    expect(groups.recall(2, 1100 + DOUBLE_PRESS_MS)?.center).toBe(false);
    expect(groups.recall(3, 1150 + DOUBLE_PRESS_MS)?.center).toBe(false);
    expect(groups.recall(2, 5000)?.center).toBe(false);
    expect(groups.recall(2, 5001 + DOUBLE_PRESS_MS)?.center).toBe(false);
  });

  it('prunes dead entities and clears on empty assignment', () => {
    const groups = new ControlGroups();
    groups.assign(1, [1, 2]);
    groups.assign(2, [3]);
    groups.prune((id) => id !== 2 && id !== 3);
    expect(groups.get(1)).toEqual([1]);
    expect(groups.get(2)).toEqual([]);
    groups.assign(1, []);
    expect(groups.recall(1, 0)).toBeNull();
  });
});
