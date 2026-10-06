import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import type { EntityView, PlayerView } from '../../sim/snapshot';
import type { Order } from '../../sim/types';
import { activityOf } from '../game/activity';
import { data } from './fixtures';

function entity(id: number, kind: EntityView['kind'], type: string, orders: Order[] | null): EntityView {
  return {
    id,
    kind,
    type,
    owner: 0,
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
    own:
      orders === null
        ? null
        : {
            orders,
            standGround: false,
            carry: null,
            faith: null,
            cargo: [],
            queue: [],
            rallyPoint: null,
            research: null,
          },
  };
}

function viewOf(entities: EntityView[]): PlayerView {
  return { entities } as PlayerView;
}

describe('unit activity', () => {
  const tree = entity(10, 'resource', 'tree', null);
  const gold = entity(11, 'resource', 'gold_mine', null);
  const gazelle = entity(12, 'unit', 'gazelle', null);
  const view = viewOf([tree, gold, gazelle]);
  const villager = (orders: Order[]): EntityView => entity(1, 'unit', 'villager', orders);

  it('reports idle without orders', () => {
    expect(activityOf(villager([]), view, data)).toBe('idle');
  });

  it('names the gathered resource', () => {
    expect(activityOf(villager([{ type: 'gather', targetId: tree.id }]), view, data)).toBe('gather_wood');
    expect(activityOf(villager([{ type: 'gather', targetId: gold.id }]), view, data)).toBe('gather_gold');
  });

  it('distinguishes hunting from attacking', () => {
    expect(activityOf(villager([{ type: 'gather', targetId: gazelle.id }]), view, data)).toBe('hunt');
    expect(
      activityOf(
        villager([
          { type: 'attack', targetId: gazelle.id },
          { type: 'gather', targetId: gazelle.id },
        ]),
        view,
        data,
      ),
    ).toBe('hunt');
    expect(activityOf(villager([{ type: 'attack', targetId: 99 }]), view, data)).toBe('attack');
  });

  it('falls back to the carried resource when the source is out of sight', () => {
    const unit = villager([{ type: 'gather', targetId: 99 }]);
    expect(activityOf(unit, view, data)).toBe('gather');
    if (unit.own) {
      unit.own.carry = { kind: 'stone', resource: 'stone', amount: 3 };
    }
    expect(activityOf(unit, view, data)).toBe('gather_stone');
  });

  it('reports an attack started without an order', () => {
    const unit = villager([]);
    unit.state = 'attacking';
    expect(activityOf(unit, view, data)).toBe('attack');
  });

  it('hides the activity of foreign units and non-units', () => {
    expect(activityOf(entity(2, 'unit', 'villager', null), view, data)).toBeNull();
    expect(activityOf(entity(3, 'building', 'town_center', []), view, data)).toBeNull();
  });

  it('has a label for every activity it can report', () => {
    const orders: Order[] = [
      { type: 'move', target: { x: 0, y: 0 } },
      { type: 'attackMove', target: { x: 0, y: 0 } },
      { type: 'dropOff', targetId: null },
      { type: 'build', targetId: 5 },
      { type: 'repair', targetId: 5 },
      { type: 'load', targetId: 5 },
      { type: 'unload', target: { x: 0, y: 0 } },
      { type: 'heal', targetId: 5 },
      { type: 'convert', targetId: 5 },
      { type: 'follow', targetId: 5 },
    ];
    const labels: Record<string, string> = en;
    for (const order of orders) {
      const activity = activityOf(villager([order]), view, data);
      expect(labels[`ui.activity.${activity}`]).toBeTruthy();
    }
  });
});
