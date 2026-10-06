import { describe, expect, it } from 'vitest';
import type { Command } from '../../sim/commands';
import type { EntityView, PlayerView } from '../../sim/snapshot';
import { GAIA_PLAYER_ID } from '../../sim/types';
import {
  buildableBuildings,
  researchableTechs,
  trainableUnits,
  unitCost,
} from '../game/availability';
import {
  attackGroundCommands,
  attackMoveCommands,
  contextCommands,
  deleteCommands,
  placeBuildingCommands,
  placeWallCommands,
  repairCommands,
  standGroundCommands,
  stopCommands,
  unloadCommands,
} from '../game/commandBuilder';
import type { PanelState } from '../game/commandPanel';
import { PANEL_SLOTS, buildPanel } from '../game/commandPanel';
import { Occupancy, canPlace, footprintTile, lineTiles } from '../game/placement';
import { addEntity, data, makeView, ownOf } from './fixtures';

const WORLD = { x: 20.5, y: 21.5 };

const PANEL: PanelState = {
  page: 'root',
  pageIndex: 0,
  tradeGood: 'wood',
  cursor: null,
  placing: null,
};

function context(
  view: PlayerView,
  selection: EntityView[],
  target: EntityView | null,
  queued = false,
): Command[] {
  return contextCommands({ view, data }, selection, target, WORLD, queued, 'stone');
}

function types(commands: Command[]): string[] {
  return commands.map((command) => command.type);
}

describe('context command', () => {
  it('moves own units to empty ground and queues with Shift', () => {
    const view = makeView();
    const villagers = ownOf(view, 'villager');
    expect(context(view, villagers, null)).toEqual([
      {
        type: 'move',
        playerId: 0,
        entityIds: villagers.map((unit) => unit.id),
        target: WORLD,
        queued: false,
      },
    ]);
    expect(context(view, villagers, null, true)[0]).toMatchObject({ queued: true });
  });

  it('sends nothing for foreign or empty selections', () => {
    const view = makeView();
    const foreign = addEntity(view, { kind: 'unit', type: 'clubman', owner: 1 });
    expect(context(view, [], null)).toEqual([]);
    expect(context(view, [foreign], null)).toEqual([]);
  });

  it('gathers with villagers and moves the rest', () => {
    const view = makeView();
    const villager = ownOf(view, 'villager')[0];
    const soldier = addEntity(view, { kind: 'unit', type: 'clubman', owner: 0 });
    const tree = addEntity(view, { kind: 'resource', type: 'tree', owner: GAIA_PLAYER_ID, amount: 40 });
    const commands = context(view, [villager, soldier], tree);
    expect(commands).toEqual([
      { type: 'gather', playerId: 0, entityIds: [villager.id], targetId: tree.id, queued: false },
      { type: 'move', playerId: 0, entityIds: [soldier.id], target: WORLD, queued: false },
    ]);
  });

  it('fishes deep water with boats only', () => {
    const view = makeView();
    const villager = ownOf(view, 'villager')[0];
    const boat = addEntity(view, { kind: 'unit', type: 'fishing_boat', owner: 0 });
    const fish = addEntity(view, { kind: 'resource', type: 'deep_fish', owner: GAIA_PLAYER_ID });
    expect(types(context(view, [villager], fish))).toEqual(['move']);
    expect(types(context(view, [boat], fish))).toEqual(['gather']);
  });

  it('attacks enemies, converts with priests and respects allies', () => {
    const view = makeView();
    const soldier = addEntity(view, { kind: 'unit', type: 'clubman', owner: 0 });
    const priest = addEntity(view, { kind: 'unit', type: 'priest', owner: 0 });
    const enemy = addEntity(view, { kind: 'unit', type: 'clubman', owner: 1, hp: 5 });
    expect(context(view, [soldier, priest], enemy)).toEqual([
      { type: 'attack', playerId: 0, entityIds: [soldier.id], targetId: enemy.id, queued: false },
      { type: 'convert', playerId: 0, entityIds: [priest.id], targetId: enemy.id, queued: false },
    ]);
    view.self.diplomacy[1] = 'ally';
    expect(types(context(view, [soldier, priest], enemy))).toEqual(['heal', 'move']);
  });

  it('builds foundations, repairs damage and works farms', () => {
    const view = makeView();
    const villager = ownOf(view, 'villager')[0];
    const foundation = addEntity(view, { kind: 'building', type: 'house', owner: 0, buildProgress: 0.2 });
    const damaged = addEntity(view, { kind: 'building', type: 'house', owner: 0, hp: 20 });
    const intact = addEntity(view, { kind: 'building', type: 'house', owner: 0 });
    const farm = addEntity(view, { kind: 'building', type: 'farm', owner: 0 });
    expect(types(context(view, [villager], foundation))).toEqual(['build']);
    expect(types(context(view, [villager], damaged))).toEqual(['repair']);
    expect(types(context(view, [villager], intact))).toEqual(['move']);
    expect(types(context(view, [villager], farm))).toEqual(['gather']);
  });

  it('loads land units into own transports and trades with foreign docks', () => {
    const view = makeView();
    const villager = ownOf(view, 'villager')[0];
    const transport = addEntity(view, { kind: 'unit', type: 'light_transport', owner: 0 });
    const trader = addEntity(view, { kind: 'unit', type: 'trade_boat', owner: 0 });
    const dock = addEntity(view, { kind: 'building', type: 'dock', owner: 1 });
    expect(context(view, [villager], transport)).toEqual([
      { type: 'load', playerId: 0, entityIds: [villager.id], transportId: transport.id, queued: false },
    ]);
    expect(context(view, [trader], dock)).toEqual([
      {
        type: 'trade',
        playerId: 0,
        entityIds: [trader.id],
        dockId: dock.id,
        good: 'stone',
        queued: false,
      },
    ]);
  });

  it('hunts animals with villagers', () => {
    const view = makeView();
    const villager = ownOf(view, 'villager')[0];
    const gazelle = addEntity(view, { kind: 'unit', type: 'gazelle', owner: GAIA_PLAYER_ID });
    expect(types(context(view, [villager], gazelle))).toEqual(['gather']);
  });

  it('sets the rally point of selected buildings, with the target under the cursor', () => {
    const view = makeView();
    const center = ownOf(view, 'town_center')[0];
    const tree = addEntity(view, { kind: 'resource', type: 'tree', owner: GAIA_PLAYER_ID });
    expect(context(view, [center], tree)).toEqual([
      {
        type: 'setRallyPoint',
        playerId: 0,
        buildingIds: [center.id],
        position: WORLD,
        targetId: tree.id,
      },
    ]);
  });
});

describe('explicit commands', () => {
  it('builds attack-move, stop, stand ground and delete', () => {
    const view = makeView();
    const villagers = ownOf(view, 'villager');
    const ids = villagers.map((unit) => unit.id);
    expect(attackMoveCommands(view, villagers, WORLD, true)).toEqual([
      { type: 'attackMove', playerId: 0, entityIds: ids, target: WORLD, queued: true },
    ]);
    expect(stopCommands(view, villagers)).toEqual([{ type: 'stop', playerId: 0, entityIds: ids }]);
    expect(standGroundCommands(view, villagers, true)).toEqual([
      { type: 'standGround', playerId: 0, entityIds: ids, enabled: true },
    ]);
    expect(deleteCommands(view, villagers)).toEqual([{ type: 'delete', playerId: 0, entityIds: ids }]);
    expect(attackMoveCommands(view, [], WORLD, false)).toEqual([]);
  });

  it('builds attack-ground commands for siege units only', () => {
    const view = makeView();
    const villager = ownOf(view, 'villager')[0];
    const thrower = addEntity(view, { kind: 'unit', type: 'stone_thrower', owner: 0 });
    const foreign = addEntity(view, { kind: 'unit', type: 'stone_thrower', owner: 1 });
    const ctx = { view, data };
    expect(attackGroundCommands(ctx, [villager, thrower, foreign], WORLD, true)).toEqual([
      { type: 'attackGround', playerId: 0, entityIds: [thrower.id], target: WORLD, queued: true },
    ]);
    expect(attackGroundCommands(ctx, [villager], WORLD, false)).toEqual([]);
  });

  it('builds repair, unload and placement commands for the right units', () => {
    const view = makeView();
    const villager = ownOf(view, 'villager')[0];
    const soldier = addEntity(view, { kind: 'unit', type: 'clubman', owner: 0 });
    const transport = addEntity(view, { kind: 'unit', type: 'light_transport', owner: 0 });
    const house = addEntity(view, { kind: 'building', type: 'house', owner: 0, hp: 10 });
    const ctx = { view, data };
    expect(repairCommands(ctx, [villager, soldier], house, false)).toEqual([
      { type: 'repair', playerId: 0, entityIds: [villager.id], targetId: house.id, queued: false },
    ]);
    expect(repairCommands(ctx, [soldier], house, false)).toEqual([]);
    expect(unloadCommands(ctx, [transport, soldier], WORLD, false)).toEqual([
      { type: 'unload', playerId: 0, entityIds: [transport.id], target: WORLD, queued: false },
    ]);
    expect(placeBuildingCommands(ctx, [villager, soldier], 'house', { x: 3, y: 4 }, true)).toEqual([
      {
        type: 'placeBuilding',
        playerId: 0,
        entityIds: [villager.id],
        building: 'house',
        tile: { x: 3, y: 4 },
        queued: true,
      },
    ]);
    expect(
      placeWallCommands(ctx, [villager], 'small_wall', { x: 1, y: 1 }, { x: 5, y: 1 }, false),
    ).toEqual([
      {
        type: 'placeWall',
        playerId: 0,
        entityIds: [villager.id],
        building: 'small_wall',
        from: { x: 1, y: 1 },
        to: { x: 5, y: 1 },
        queued: false,
      },
    ]);
    expect(placeBuildingCommands(ctx, [soldier], 'house', { x: 3, y: 4 }, false)).toEqual([]);
  });
});

describe('availability', () => {
  it('derives building availability from data and the view', () => {
    const view = makeView();
    view.self.resources = { food: 1000, wood: 1000, stone: 1000, gold: 1000 };
    const offers = new Map(buildableBuildings(view, data).map((offer) => [offer.id, offer]));
    expect(offers.get('house')?.availability.reason).toBeNull();
    expect(offers.get('market')?.availability.reason).toBe('age');
    expect(offers.get('small_wall')?.availability.reason).toBe('age');
    expect(offers.has('medium_wall')).toBe(false);
    expect(offers.get('town_center')?.availability.reason).toBe('prerequisite');
    expect(offers.get('house')?.requires).toEqual([]);
    expect(offers.get('market')?.requires).toEqual([
      { kind: 'age', age: 'tool' },
      { kind: 'building', id: 'granary' },
    ]);
    expect(offers.get('small_wall')?.requires).toEqual([
      { kind: 'age', age: 'tool' },
      { kind: 'technology', id: 'small_wall' },
    ]);
    expect(offers.get('town_center')?.requires).toEqual([
      { kind: 'building', id: 'government_center' },
    ]);
    view.self.resources.wood = 10;
    const poor = buildableBuildings(view, data).find((offer) => offer.id === 'house');
    expect(poor?.availability).toEqual({ reason: 'resources', blocked: true, resource: 'wood' });
  });

  it('replaces units and walls of an upgraded line', () => {
    const view = makeView();
    view.self.age = 'iron';
    view.self.resources = { food: 5000, wood: 5000, stone: 5000, gold: 5000 };
    const ids = (): string[] => trainableUnits('barracks', view, data).map((offer) => offer.id);
    expect(ids()).toEqual(['clubman', 'short_swordsman']);
    view.self.researched = ['battle_axe', 'short_sword', 'broad_sword', 'small_wall', 'medium_wall'];
    expect(ids()).toEqual(['axeman', 'broad_swordsman']);
    const walls = buildableBuildings(view, data)
      .map((offer) => offer.id)
      .filter((id) => data.buildings[id].class.includes('wall'));
    expect(walls).toEqual(['medium_wall']);
  });

  it('reports housing without blocking and applies civilization discounts', () => {
    const view = makeView();
    view.self.resources.food = 500;
    view.self.population = view.self.housing;
    const villager = trainableUnits('town_center', view, data).find((offer) => offer.id === 'villager');
    expect(villager?.availability).toEqual({ reason: 'housing', blocked: false, resource: null });
    view.players[0].civilization = 'shang';
    expect(unitCost(view, data, data.units.villager)).toEqual({ food: 35 });
  });

  it('hides researched, disabled and running technologies', () => {
    const view = makeView();
    view.self.resources.food = 5000;
    const center = ownOf(view, 'town_center')[0];
    const offers = researchableTechs(center, view, data);
    expect(offers.map((offer) => offer.id)).toEqual(['tool_age', 'bronze_age', 'iron_age']);
    expect(offers[0].availability.reason).toBe('prerequisite');
    expect(offers[1].availability.reason).toBe('age');
    expect(offers[0].requires).toEqual([
      {
        kind: 'age_buildings',
        count: 2,
        buildings: ['barracks', 'granary', 'storage_pit', 'dock'],
      },
    ]);
    expect(offers[1].requires).toEqual([
      { kind: 'age', age: 'tool' },
      { kind: 'technology', id: 'tool_age' },
      { kind: 'age_buildings', count: 2, buildings: ['archery_range', 'stable', 'market'] },
    ]);
    addEntity(view, { kind: 'building', type: 'barracks', owner: 0 });
    addEntity(view, { kind: 'building', type: 'granary', owner: 0 });
    expect(researchableTechs(center, view, data)[0].availability.reason).toBeNull();
    view.self.researched = ['tool_age'];
    expect(researchableTechs(center, view, data).map((offer) => offer.id)).toEqual([
      'bronze_age',
      'iron_age',
    ]);
    const pit = addEntity(view, { kind: 'building', type: 'storage_pit', owner: 0 });
    const pitTechs = researchableTechs(pit, view, data).map((offer) => offer.id);
    expect(pitTechs).toContain('toolworking');
    expect(pitTechs).not.toContain('bronze_shield');
  });
});

describe('command panel', () => {
  it('offers attack ground only when a siege unit is selected', () => {
    const view = makeView();
    const villager = ownOf(view, 'villager')[0];
    const thrower = addEntity(view, { kind: 'unit', type: 'stone_thrower', owner: 0 });
    const keys = (selection: EntityView[]): string[] =>
      buildPanel(selection, view, data, PANEL).map((button) => button.key);
    expect(keys([villager])).not.toContain('action:attack_ground');
    expect(keys([thrower])).toContain('action:attack_ground');
    expect(keys([villager, thrower])).toContain('action:attack_ground');
    const active = buildPanel([thrower], view, data, { ...PANEL, cursor: 'attackGround' });
    expect(active.find((button) => button.key === 'action:attack_ground')?.active).toBe(true);
  });

  it('offers villager actions and a paged build menu', () => {
    const view = makeView();
    const villagers = ownOf(view, 'villager');
    const root = buildPanel(villagers, view, data, PANEL);
    expect(root.map((button) => button.key)).toEqual([
      'action:build',
      'action:repair',
      'action:attack_move',
      'action:stop',
      'action:delete',
    ]);
    const build = buildPanel(villagers, view, data, { ...PANEL, page: 'build' });
    expect(build.every((button) => button.slot < PANEL_SLOTS)).toBe(true);
    expect(new Set(build.map((button) => button.slot)).size).toBe(build.length);
    expect(build.at(-1)?.key).toBe('action:back');
    expect(build.some((button) => button.key === 'building:house')).toBe(true);
    const all = new Set<string>();
    for (let page = 0; page < 3; page++) {
      for (const button of buildPanel(villagers, view, data, { ...PANEL, page: 'build', pageIndex: page })) {
        all.add(button.key);
      }
    }
    expect(all.has('building:wonder')).toBe(true);
  });

  it('offers units, technologies and the rally point for buildings', () => {
    const view = makeView();
    const center = ownOf(view, 'town_center')[0];
    const keys = buildPanel([center], view, data, PANEL).map((button) => button.key);
    expect(keys).toEqual([
      'unit:villager',
      'tech:tool_age',
      'tech:bronze_age',
      'tech:iron_age',
      'action:rally',
      'action:delete',
    ]);
    const foundation = addEntity(view, { kind: 'building', type: 'barracks', owner: 0, buildProgress: 0.5 });
    expect(buildPanel([foundation], view, data, PANEL).map((button) => button.key)).toEqual([
      'action:delete',
    ]);
  });

  it('shows nothing for foreign selections', () => {
    const view = makeView();
    const enemy = addEntity(view, { kind: 'unit', type: 'clubman', owner: 1 });
    expect(buildPanel([enemy], view, data, PANEL)).toEqual([]);
    expect(buildPanel([], view, data, PANEL)).toEqual([]);
  });
});

describe('placement', () => {
  it('anchors footprints under the cursor and walks wall lines', () => {
    expect(footprintTile({ x: 10.5, y: 10.5 }, 3)).toEqual({ x: 9, y: 9 });
    expect(footprintTile({ x: 10.2, y: 10.9 }, 2)).toEqual({ x: 9, y: 10 });
    expect(footprintTile({ x: 10.2, y: 10.9 }, 1)).toEqual({ x: 10, y: 10 });
    expect(lineTiles({ x: 1, y: 1 }, { x: 4, y: 1 })).toHaveLength(4);
    expect(lineTiles({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });

  it('rejects occupied, unexplored and out-of-map tiles', () => {
    const view = makeView();
    const occupancy = new Occupancy(data);
    const center = ownOf(view, 'town_center')[0];
    const origin = footprintTile(center.position, data.buildings.town_center.size);
    const occupied = occupancy.tilesOf(view);
    expect(canPlace(view, data, 'house', origin, occupied)).toBe(false);
    expect(canPlace(view, data, 'house', { x: -1, y: 0 }, occupied)).toBe(false);
    expect(canPlace(view, data, 'house', { x: view.map.size - 1, y: 0 }, occupied)).toBe(false);
    let free: { x: number; y: number } | null = null;
    for (let y = 0; y < view.map.size - 2 && free === null; y++) {
      for (let x = 0; x < view.map.size - 2 && free === null; x++) {
        if (canPlace(view, data, 'house', { x, y }, occupied)) {
          free = { x, y };
        }
      }
    }
    expect(free).not.toBeNull();
    if (free) {
      view.fog.explored[free.y * view.map.size + free.x] = 0;
      expect(canPlace(view, data, 'house', free, occupied)).toBe(false);
    }
  });
});
