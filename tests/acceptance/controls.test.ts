import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/sim/commands';
import { distance } from '../../src/sim/core/geometry';
import { step } from '../../src/sim/engine';
import type { SimEvent, SimEventOf } from '../../src/sim/events';
import { buildPlayerView } from '../../src/sim/snapshot';
import type { Entity, GameState, Vec2 } from '../../src/sim/types';
import { addBuilding, addUnit, context, data, emptyState } from '../../src/sim/__tests__/fixtures';
import { boxSelect, sameTypeSelect } from '../../src/ui/game/selection';
import {
  attackMoveCommands,
  contextCommands,
  rallyCommands,
} from '../../src/ui/game/commandBuilder';

function play(
  state: GameState,
  limit: number,
  done: () => boolean,
  commands: readonly Command[] = [],
): SimEvent[] {
  const ctx = context();
  const events: SimEvent[] = [];
  for (let tick = 0; tick < limit && !done(); tick++) {
    events.push(...step(state, tick === 0 ? commands : [], ctx));
  }
  return events;
}

function trained(events: readonly SimEvent[]): SimEventOf<'unitTrained'>[] {
  return events.filter((event): event is SimEventOf<'unitTrained'> => event.type === 'unitTrained');
}

function settlement(): { state: GameState; center: Entity; barracks: Entity } {
  const state = emptyState(48);
  const center = addBuilding(state, 'town_center', 0, 4, 4);
  const barracks = addBuilding(state, 'barracks', 0, 12, 4);
  for (let index = 0; index < 4; index++) {
    addBuilding(state, 'house', 0, 4 + index * 3, 12);
  }
  state.players[0].resources = { food: 1000, wood: 1000, stone: 1000, gold: 1000 };
  state.players[0].explored.fill(1);
  return { state, center, barracks };
}

describe('criterion 7: production queue (FR-UI-4)', () => {
  it('queues several units, cancels any item with a full refund and trains the rest in order', () => {
    const { state, center, barracks } = settlement();
    const ctx = context();
    step(
      state,
      [
        { type: 'train', playerId: 0, buildingId: center.id, unit: 'villager', count: 3 },
        { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 2 },
      ],
      ctx,
    );
    const villagerCost = data.units.villager.cost.food ?? 0;
    const clubmanCost = data.units.clubman.cost.food ?? 0;
    expect(center.queue.map((item) => item.unit)).toEqual(['villager', 'villager', 'villager']);
    expect(barracks.queue).toHaveLength(2);
    expect(state.players[0].resources.food).toBe(1000 - 3 * villagerCost - 2 * clubmanCost);
    expect(buildPlayerView(state, 0, data).entities.find((entity) => entity.id === center.id)?.own?.queue).toHaveLength(3);

    step(state, [{ type: 'cancelQueueItem', playerId: 0, buildingId: center.id, index: 1 }], ctx);
    expect(center.queue).toHaveLength(2);
    expect(state.players[0].resources.food).toBe(1000 - 2 * villagerCost - 2 * clubmanCost);

    step(state, [{ type: 'cancelQueueItem', playerId: 0, buildingId: barracks.id, index: 0 }], ctx);
    expect(barracks.queue).toHaveLength(1);
    expect(state.players[0].resources.food).toBe(1000 - 2 * villagerCost - clubmanCost);

    const events = play(state, 2000, () => center.queue.length === 0 && barracks.queue.length === 0);
    expect(trained(events).map((event) => event.unitType).sort()).toEqual(['clubman', 'villager', 'villager']);
    expect(state.players[0].stats.unitsTrained).toBe(3);
    expect(state.players[0].population).toBe(3);
  });
});

describe('criterion 7: rally points (FR-UI-5)', () => {
  it('sends a trained unit to the rally point', () => {
    const { state, barracks } = settlement();
    const rally = { x: 30.5, y: 20.5 };
    const view = buildPlayerView(state, 0, data);
    const building = view.entities.filter((entity) => entity.id === barracks.id);
    const commands = rallyCommands(view, building, null, rally);
    expect(commands).toHaveLength(1);
    const events = play(state, 1200, () => state.players[0].stats.unitsTrained === 1, [
      ...commands,
      { type: 'train', playerId: 0, buildingId: barracks.id, unit: 'clubman', count: 1 },
    ]);
    const unit = state.entities[trained(events)[0].entityId];
    expect(barracks.rallyPoint?.position).toEqual(rally);
    play(state, 1200, () => unit.orders.length === 0);
    expect(distance(unit.position, rally)).toBeLessThan(1.5);
  });
});

describe('criterion 7: attack-move (FR-UI-6)', () => {
  it('fights the enemies met on the way and then reaches the point', () => {
    const state = emptyState(48);
    const group: Entity[] = [];
    for (let index = 0; index < 6; index++) {
      group.push(addUnit(state, 'axeman', 0, 5.5 + (index % 3), 20.5 + Math.floor(index / 3)));
    }
    const sentries = [
      addUnit(state, 'clubman', 1, 18.5, 20.5),
      addUnit(state, 'clubman', 1, 18.5, 21.5),
    ];
    sentries.forEach((sentry) => {
      sentry.standGround = true;
    });
    const target: Vec2 = { x: 34.5, y: 21 };
    const view = buildPlayerView(state, 0, data);
    const selection = view.entities.filter((entity) => entity.owner === 0);
    const commands = attackMoveCommands(view, selection, target, false);
    expect(commands.map((command) => command.type)).toEqual(['attackMove']);
    const events = play(
      state,
      4000,
      () => state.tick > 1 && group.every((unit) => !state.entities[unit.id] || unit.orders.length === 0),
      commands,
    );
    const dead = events
      .filter((event): event is SimEventOf<'entityDied'> => event.type === 'entityDied')
      .map((event) => event.entityId);
    expect(dead).toEqual(expect.arrayContaining(sentries.map((sentry) => sentry.id)));
    const survivors = group.filter((unit) => state.entities[unit.id]);
    expect(survivors.length).toBeGreaterThan(0);
    for (const unit of survivors) {
      expect(distance(unit.position, target)).toBeLessThan(4);
    }
  });

  it('differs from a plain move, which walks past without engaging', () => {
    const state = emptyState(48);
    const walker = addUnit(state, 'axeman', 0, 5.5, 20.5);
    const bystander = addUnit(state, 'villager', 1, 18.5, 22.5);
    const target = { x: 34.5, y: 20.5 };
    play(state, 4000, () => state.tick > 1 && walker.orders.length === 0, [
      { type: 'move', playerId: 0, entityIds: [walker.id], target, queued: false },
    ]);
    expect(distance(walker.position, target)).toBeLessThan(1.5);
    expect(bystander.hp).toBe(data.units.villager.hp);
  });
});

describe('criterion 7: selection of more than 25 units (FR-UI-1)', () => {
  it('selects and commands 60 units at once', () => {
    const state = emptyState(64);
    const units: Entity[] = [];
    for (let index = 0; index < 60; index++) {
      units.push(addUnit(state, 'axeman', 0, 6.5 + (index % 10), 6.5 + Math.floor(index / 10)));
    }
    const view = buildPlayerView(state, 0, data);
    const byId = new Map(view.entities.map((entity) => [entity.id, entity]));
    const selectionContext = { playerId: 0, entity: (id: number) => byId.get(id) };
    const ids = units.map((unit) => unit.id);
    const boxed = boxSelect([], ids, false, selectionContext);
    expect(boxed).toHaveLength(60);
    expect(sameTypeSelect([], ids[0], ids, false, selectionContext)).toHaveLength(60);

    const target = { x: 44.5, y: 44.5 };
    const selection = boxed.flatMap((id) => byId.get(id) ?? []);
    const commands = contextCommands({ view, data }, selection, null, target, false, 'wood');
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: 'move', entityIds: ids });
    play(state, 3000, () => state.tick > 1 && units.every((unit) => unit.orders.length === 0), commands);
    for (const unit of units) {
      expect(unit.orders).toEqual([]);
      expect(distance(unit.position, target)).toBeLessThan(8);
    }
    const tiles = new Set(units.map((unit) => `${Math.floor(unit.position.x)}:${Math.floor(unit.position.y)}`));
    expect(tiles.size).toBeGreaterThan(40);
  });
});

describe('criterion 7: order queue (FR-UI-8)', () => {
  it('executes Shift-queued orders one after another', () => {
    const state = emptyState(48);
    const unit = addUnit(state, 'scout', 0, 5.5, 5.5);
    const waypoints: Vec2[] = [
      { x: 20.5, y: 5.5 },
      { x: 20.5, y: 20.5 },
      { x: 5.5, y: 20.5 },
    ];
    const view = buildPlayerView(state, 0, data);
    const selection = view.entities.filter((entity) => entity.id === unit.id);
    const commands = waypoints.flatMap((point, index) =>
      contextCommands({ view, data }, selection, null, point, index > 0, 'wood'),
    );
    expect(commands.map((command) => 'queued' in command && command.queued)).toEqual([false, true, true]);
    const ctx = context();
    step(state, commands, ctx);
    expect(unit.orders).toHaveLength(3);
    const reached: number[] = [];
    for (let tick = 0; tick < 3000 && unit.orders.length > 0; tick++) {
      step(state, [], ctx);
      const next = waypoints[reached.length];
      if (next && distance(unit.position, next) < 1) {
        reached.push(state.tick);
      }
    }
    expect(reached).toHaveLength(3);
    expect(reached[0]).toBeLessThan(reached[1]);
    expect(reached[1]).toBeLessThan(reached[2]);
    expect(distance(unit.position, waypoints[2])).toBeLessThan(1);
  });

  it('replaces the queue with an order given without Shift', () => {
    const state = emptyState(48);
    const unit = addUnit(state, 'scout', 0, 5.5, 5.5);
    const ctx = context();
    step(
      state,
      [
        { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 30.5, y: 5.5 }, queued: false },
        { type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 30.5, y: 30.5 }, queued: true },
      ],
      ctx,
    );
    expect(unit.orders).toHaveLength(2);
    step(state, [{ type: 'move', playerId: 0, entityIds: [unit.id], target: { x: 8.5, y: 8.5 }, queued: false }], ctx);
    expect(unit.orders).toHaveLength(1);
  });
});
