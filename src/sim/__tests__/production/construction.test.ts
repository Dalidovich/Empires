import { describe, expect, it } from 'vitest';
import { availableActions } from '../../effects';
import { builderSpeed, canPlace, wallLine } from '../../systems/construction';
import { TERRAIN } from '../../types';
import { addBuilding, addTree, addUnit, context, data, paint, run, runUntil } from '../fixtures';
import { eventsOf, ownedOf, rejections, seconds, send, world } from './fixtures';

function site() {
  const state = world();
  addBuilding(state, 'town_center', 0, 2, 2);
  return { state, ctx: context() };
}

function buildHouse(builders: number): number {
  const { state, ctx } = site();
  const spots = [
    { x: 9.5, y: 10.5 },
    { x: 9.5, y: 11.5 },
    { x: 12.5, y: 10.5 },
  ];
  const ids = spots.slice(0, builders).map((spot) => addUnit(state, 'villager', 0, spot.x, spot.y).id);
  send(state, ctx, {
    type: 'placeBuilding',
    playerId: 0,
    entityIds: ids,
    building: 'house',
    tile: { x: 10, y: 10 },
    queued: false,
  });
  const house = ownedOf(state, 0, 'house')[0];
  return runUntil(state, ctx, seconds(60), () => house.buildProgress === 1);
}

describe('placement', () => {
  it('rejects placement on cliffs', () => {
    const { state } = site();
    paint(state, 11, 11, 11, 11, TERRAIN.cliff);
    expect(canPlace(state, 0, 'house', { x: 10, y: 10 }, data)).toBe(false);
    expect(canPlace(state, 0, 'house', { x: 13, y: 10 }, data)).toBe(true);
  });

  it('needs free, passable and explored tiles', () => {
    const { state } = site();
    expect(canPlace(state, 0, 'house', { x: 10, y: 10 }, data)).toBe(true);
    expect(canPlace(state, 0, 'house', { x: 3, y: 3 }, data)).toBe(false);
    expect(canPlace(state, 0, 'house', { x: 29, y: 29 }, data)).toBe(false);
    addTree(state, 11, 11);
    expect(canPlace(state, 0, 'house', { x: 10, y: 10 }, data)).toBe(false);
    state.players[0].explored[15 * state.map.size + 15] = 0;
    expect(canPlace(state, 0, 'house', { x: 14, y: 14 }, data)).toBe(false);
    paint(state, 20, 20, 21, 21, TERRAIN.shallows);
    expect(canPlace(state, 0, 'house', { x: 20, y: 20 }, data)).toBe(false);
    expect(canPlace(state, 0, 'dragon_lair', { x: 10, y: 14 }, data)).toBe(false);
  });

  it('puts the dock on the shore only', () => {
    const { state } = site();
    paint(state, 0, 20, 29, 20, TERRAIN.shore);
    paint(state, 0, 21, 29, 29, TERRAIN.deepWater);
    expect(canPlace(state, 0, 'dock', { x: 10, y: 10 }, data)).toBe(false);
    expect(canPlace(state, 0, 'dock', { x: 10, y: 18 }, data)).toBe(true);
    expect(canPlace(state, 0, 'dock', { x: 10, y: 20 }, data)).toBe(true);
    expect(canPlace(state, 0, 'dock', { x: 10, y: 24 }, data)).toBe(false);
  });
});

describe('construction', () => {
  it('charges the cost when the foundation is placed and completes the building', () => {
    const { state, ctx } = site();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    const placed = send(state, ctx, {
      type: 'placeBuilding',
      playerId: 0,
      entityIds: [villager.id],
      building: 'house',
      tile: { x: 10, y: 10 },
      queued: false,
    });
    const house = ownedOf(state, 0, 'house')[0];
    expect(eventsOf(placed, 'buildingPlaced')[0].buildingId).toBe(house.id);
    expect(state.players[0].resources.wood).toBe(5000 - 30);
    expect(house.state).toBe('foundation');
    expect(house.buildProgress).toBeLessThan(1);
    expect(state.players[0].housing).toBe(4);

    const events = run(state, ctx, seconds(21));
    expect(house.buildProgress).toBe(1);
    expect(house.hp).toBe(75);
    expect(house.state).toBe('idle');
    expect(eventsOf(events, 'buildingCompleted')).toHaveLength(1);
    expect(eventsOf(events, 'constructionStrike').length).toBeGreaterThan(0);
    expect(state.players[0].stats.buildingsBuilt).toBe(1);
    expect(state.players[0].housing).toBe(8);
    expect(villager.orders).toHaveLength(0);
    expect(villager.state).toBe('idle');
  });

  it('builds faster with several builders', () => {
    const single = buildHouse(1);
    const triple = buildHouse(3);
    expect(single).toBeGreaterThanOrEqual(seconds(20) - 1);
    expect(single).toBeLessThan(seconds(21));
    expect(triple).toBeLessThan(seconds(20 / builderSpeed(3)) + 10);
    expect(triple).toBeGreaterThanOrEqual(seconds(20 / builderSpeed(3)) - 1);
  });

  it('refunds an unfinished building on cancel', () => {
    const { state, ctx } = site();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    send(state, ctx, {
      type: 'placeBuilding',
      playerId: 0,
      entityIds: [villager.id],
      building: 'house',
      tile: { x: 10, y: 10 },
      queued: false,
    });
    run(state, ctx, seconds(5));
    const house = ownedOf(state, 0, 'house')[0];
    const events = send(state, ctx, { type: 'delete', playerId: 0, entityIds: [house.id] });
    expect(state.players[0].resources.wood).toBe(5000);
    expect(state.entities[house.id]).toBeUndefined();
    expect(eventsOf(events, 'entityDied')).toHaveLength(1);
    expect(state.map.occupancy[10 * state.map.size + 10]).toBe(0);
    run(state, ctx, 2);
    expect(villager.orders).toHaveLength(0);
  });

  it('deletes own units and finished buildings without a refund', () => {
    const { state, ctx } = site();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    const enemy = addUnit(state, 'villager', 1, 12.5, 10.5);
    const house = addBuilding(state, 'house', 0, 14, 14);
    send(state, ctx, { type: 'delete', playerId: 0, entityIds: [villager.id, house.id, enemy.id] });
    expect(state.entities[villager.id]).toBeUndefined();
    expect(state.entities[house.id]).toBeUndefined();
    expect(state.entities[enemy.id]).toBeDefined();
    expect(state.players[0].resources.wood).toBe(5000);
    const events = send(state, ctx, { type: 'delete', playerId: 0, entityIds: [enemy.id] });
    expect(rejections(events)).toEqual(['not_owner']);
  });

  it('enforces age, building requirements, placement and resources', () => {
    const state = world();
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    const place = (building: string, x = 10, y = 10) =>
      rejections(
        send(state, ctx, {
          type: 'placeBuilding',
          playerId: 0,
          entityIds: [villager.id],
          building,
          tile: { x, y },
          queued: false,
        }),
      );
    expect(place('house')).toEqual(['prerequisite']);
    expect(place('town_center', 2, 2)).toEqual([]);
    ownedOf(state, 0, 'town_center')[0].buildProgress = 1;
    expect(place('town_center', 20, 20)).toEqual(['prerequisite']);
    expect(place('farm')).toEqual(['age']);
    expect(place('wonder')).toEqual(['age']);
    expect(place('small_wall')).toEqual(['age']);
    expect(place('house', 2, 2)).toEqual(['placement']);
    state.players[0].resources.wood = 29;
    expect(place('house')).toEqual(['resources']);
    state.players[0].resources.wood = 5000;
    state.players[0].age = 'iron';
    addBuilding(state, 'government_center', 0, 24, 2);
    expect(place('town_center', 20, 20)).toEqual([]);
    expect(place('small_wall', 15, 15)).toEqual(['prerequisite']);
    expect(place('wonder', 10, 22)).toEqual([]);
    expect(state.players[0].resources.gold).toBe(4000);
    expect(state.players[0].resources.stone).toBe(4000);
  });

  it('only lets villagers build', () => {
    const { state, ctx } = site();
    const clubman = addUnit(state, 'clubman', 0, 9.5, 10.5);
    const events = send(state, ctx, {
      type: 'placeBuilding',
      playerId: 0,
      entityIds: [clubman.id],
      building: 'house',
      tile: { x: 10, y: 10 },
      queued: false,
    });
    expect(rejections(events)).toEqual(['not_owner']);
  });

  it('moves units out of a new foundation', () => {
    const { state, ctx } = site();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    const bystander = addUnit(state, 'clubman', 0, 11, 11);
    send(state, ctx, {
      type: 'placeBuilding',
      playerId: 0,
      entityIds: [villager.id],
      building: 'house',
      tile: { x: 10, y: 10 },
      queued: false,
    });
    const tile = Math.floor(bystander.position.y) * state.map.size + Math.floor(bystander.position.x);
    expect(state.map.occupancy[tile]).toBe(0);
  });

  it('places walls along a dragged line', () => {
    const { state, ctx } = site();
    state.players[0].age = 'tool';
    state.players[0].researched.push('small_wall');
    const villager = addUnit(state, 'villager', 0, 9.5, 9.5);
    addTree(state, 12, 10);
    send(state, ctx, {
      type: 'placeWall',
      playerId: 0,
      entityIds: [villager.id],
      building: 'small_wall',
      from: { x: 10, y: 10 },
      to: { x: 14, y: 10 },
      queued: false,
    });
    const walls = ownedOf(state, 0, 'small_wall');
    expect(walls).toHaveLength(4);
    expect(state.players[0].resources.stone).toBe(5000 - 20);
    expect(villager.orders.filter((order) => order.type === 'build')).toHaveLength(4);
    runUntil(state, ctx, seconds(120), () => walls.every((wall) => wall.buildProgress === 1));
    expect(walls.every((wall) => wall.buildProgress === 1)).toBe(true);

    const house = send(state, ctx, {
      type: 'placeWall',
      playerId: 0,
      entityIds: [villager.id],
      building: 'house',
      from: { x: 10, y: 20 },
      to: { x: 14, y: 20 },
      queued: false,
    });
    expect(rejections(house)).toEqual(['invalid']);
  });

  it('draws connected wall lines in any direction', () => {
    expect(wallLine({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(4);
    expect(wallLine({ x: 3, y: 3 }, { x: 0, y: 0 })).toEqual([
      { x: 3, y: 3 },
      { x: 2, y: 2 },
      { x: 1, y: 1 },
      { x: 0, y: 0 },
    ]);
    const line = wallLine({ x: 0, y: 0 }, { x: 7, y: 3 });
    expect(line[0]).toEqual({ x: 0, y: 0 });
    expect(line[line.length - 1]).toEqual({ x: 7, y: 3 });
    for (let i = 1; i < line.length; i++) {
      expect(Math.abs(line[i].x - line[i - 1].x)).toBeLessThanOrEqual(1);
      expect(Math.abs(line[i].y - line[i - 1].y)).toBeLessThanOrEqual(1);
    }
  });

  it('repairs buildings for resources proportional to the restored hit points', () => {
    const { state, ctx } = site();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    const house = addBuilding(state, 'house', 0, 10, 10);
    house.hp = 25;
    send(state, ctx, {
      type: 'repair',
      playerId: 0,
      entityIds: [villager.id],
      targetId: house.id,
      queued: false,
    });
    run(state, ctx, 5);
    expect(villager.state).toBe('repairing');
    runUntil(state, ctx, seconds(30), () => house.hp === 75);
    expect(house.hp).toBe(75);
    const spent = 5000 - state.players[0].resources.wood;
    expect(spent).toBeGreaterThanOrEqual(9);
    expect(spent).toBeLessThanOrEqual(10);
    run(state, ctx, 2);
    expect(villager.orders).toHaveLength(0);

    const events = send(state, ctx, {
      type: 'repair',
      playerId: 0,
      entityIds: [villager.id],
      targetId: house.id,
      queued: false,
    });
    expect(rejections(events)).toEqual(['invalid']);
  });

  it('stops repairing when the resources run out', () => {
    const { state, ctx } = site();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    const house = addBuilding(state, 'house', 0, 10, 10);
    house.hp = 5;
    state.players[0].resources.wood = 3;
    const events = run(state, ctx, seconds(30), [
      { type: 'repair', playerId: 0, entityIds: [villager.id], targetId: house.id, queued: false },
    ]);
    expect(house.hp).toBeLessThan(75);
    expect(house.hp).toBeGreaterThan(5);
    expect(state.players[0].resources.wood).toBe(0);
    expect(eventsOf(events, 'insufficientResources').length).toBeGreaterThan(0);
    expect(villager.orders).toHaveLength(0);
  });

  it('repairs ships', () => {
    const { state, ctx } = site();
    paint(state, 0, 20, 29, 29, TERRAIN.deepWater);
    const villager = addUnit(state, 'villager', 0, 10.5, 19.5);
    const boat = addUnit(state, 'fishing_boat', 0, 10.5, 20.4);
    boat.hp = 10;
    send(state, ctx, {
      type: 'repair',
      playerId: 0,
      entityIds: [villager.id],
      targetId: boat.id,
      queued: false,
    });
    runUntil(state, ctx, seconds(30), () => boat.hp === 45);
    expect(boat.hp).toBe(45);
    expect(state.players[0].resources.wood).toBeLessThan(5000);
  });
});

describe('available actions', () => {
  it('lists buildings for a villager with reason codes', () => {
    const state = world();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    const reasons = () =>
      Object.fromEntries(
        availableActions(state, 0, villager, data).map((action) => [action.id, action.reason]),
      );
    expect(reasons().house).toBe('prerequisite');
    expect(reasons().town_center).toBeNull();
    addBuilding(state, 'town_center', 0, 2, 2);
    expect(reasons().house).toBeNull();
    expect(reasons().town_center).toBe('prerequisite');
    expect(reasons().farm).toBe('age');
    expect(reasons().small_wall).toBe('age');
    expect('medium_wall' in reasons()).toBe(false);
    state.players[0].resources.wood = 0;
    expect(reasons().house).toBe('resources');
    expect(availableActions(state, 1, villager, data)).toEqual([]);
  });

  it('lists units and technologies for a building', () => {
    const state = world();
    addBuilding(state, 'town_center', 0, 2, 2);
    const barracks = addBuilding(state, 'barracks', 0, 8, 2);
    const actions = () => availableActions(state, 0, barracks, data);
    const find = (id: string) => actions().find((action) => action.id === id);
    state.players[0].housing = 4;
    expect(find('clubman')).toMatchObject({ kind: 'train', enabled: true, reason: null, cost: { food: 50 } });
    expect(find('axeman')).toBeUndefined();
    expect(find('battle_axe')).toMatchObject({ kind: 'research', enabled: false, reason: 'age' });
    expect(find('short_swordsman')).toMatchObject({ enabled: false, reason: 'age' });
    expect(find('broad_sword')).toBeUndefined();

    state.players[0].population = 4;
    state.players[0].housing = 4;
    expect(find('clubman')).toMatchObject({ enabled: true, reason: 'housing' });

    state.players[0].housing = 8;
    state.players[0].age = 'tool';
    state.players[0].researched.push('battle_axe');
    expect(find('clubman')).toBeUndefined();
    expect(find('axeman')).toMatchObject({ enabled: true, reason: null });
    expect(find('battle_axe')).toBeUndefined();
  });
});
