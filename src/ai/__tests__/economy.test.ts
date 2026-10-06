import { describe, expect, it } from 'vitest';
import { canPlace } from '../../sim/systems/construction';
import { manageEconomy } from '../economy';
import { findDockSite, findLandSite } from '../placement';
import { paint } from '../../sim/__tests__/fixtures';
import { TERRAIN } from '../../sim/types';
import {
  addBase,
  addBuilding,
  addResource,
  addUnit,
  apply,
  commandsOf,
  createScene,
  data,
  rejections,
  reveal,
  stock,
  thinkOf,
} from './helpers';
import type { Scene } from './helpers';

function startingScene(): Scene {
  const scene = createScene();
  const { state } = scene;
  addBase(state, 0, 10, 10);
  for (let i = 0; i < 3; i++) {
    addUnit(state, 'villager', 0, 11.5 + i, 14.5);
  }
  for (let i = 0; i < 4; i++) {
    addResource(state, 'berry_bush', 16 + (i % 2), 11 + Math.floor(i / 2));
  }
  for (let i = 0; i < 6; i++) {
    addResource(state, 'tree', 5, 8 + i);
  }
  stock(state, 0, { food: 200, wood: 200 });
  state.players[0].housing = 4;
  state.players[0].population = 3;
  return scene;
}

describe('ai economy', () => {
  it('trains villagers, builds a house and sends idle villagers to gather', () => {
    const scene = startingScene();
    const think = thinkOf(scene);
    manageEconomy(think);

    const train = commandsOf(think.commands, 'train');
    expect(train).toHaveLength(1);
    expect(train[0].unit).toBe('villager');

    const houses = commandsOf(think.commands, 'placeBuilding');
    expect(houses.map((command) => command.building)).toEqual(['house']);

    const gather = commandsOf(think.commands, 'gather');
    expect(gather).toHaveLength(2);
    const targets = gather.map((command) => scene.state.entities[command.targetId].type);
    expect(targets).toContain('berry_bush');
    expect(rejections(apply(scene, think.commands))).toEqual([]);
  });

  it('keeps the food for the next age when natural food is running out', () => {
    const scene = startingScene();
    for (let i = 0; i < 4; i++) {
      addUnit(scene.state, 'villager', 0, 11.5 + i, 16.5);
    }
    for (const entity of Object.values(scene.state.entities)) {
      if (entity.type === 'berry_bush') {
        entity.amount = 40;
      }
    }
    scene.state.players[0].housing = 20;
    scene.state.players[0].population = 7;
    const think = thinkOf(scene);
    manageEconomy(think);
    expect(commandsOf(think.commands, 'train')).toEqual([]);
  });

  it('places a farm for a food villager once farms are available', () => {
    const scene = createScene();
    const { state } = scene;
    state.players[0].age = 'tool';
    addBase(state, 0, 10, 10);
    addBuilding(state, 'granary', 0, 15, 10);
    addBuilding(state, 'market', 0, 5, 10);
    addUnit(state, 'villager', 0, 12.5, 14.5);
    addResource(state, 'tree', 12, 17);
    stock(state, 0, { food: 0, wood: 300 });
    const think = thinkOf(scene);
    manageEconomy(think);
    const placed = commandsOf(think.commands, 'placeBuilding');
    expect(placed.map((command) => command.building)).toContain('farm');
    expect(rejections(apply(scene, think.commands))).toEqual([]);
  });

  it('falls back to wood when no food source is reachable', () => {
    const scene = createScene();
    const { state } = scene;
    addBase(state, 0, 10, 10);
    addUnit(state, 'villager', 0, 12.5, 14.5);
    addUnit(state, 'villager', 0, 13.5, 14.5);
    for (let i = 0; i < 6; i++) {
      addResource(state, 'tree', 12 + i, 17);
    }
    reveal(state, 0);
    stock(state, 0, { food: 0, wood: 0 });
    const think = thinkOf(scene);
    manageEconomy(think);
    const gather = commandsOf(think.commands, 'gather');
    expect(gather.length).toBeGreaterThan(0);
    for (const command of gather) {
      expect(state.entities[command.targetId].type).toBe('tree');
    }
  });

  it('builds a drop-off building next to a distant resource cluster', () => {
    const scene = createScene();
    const { state } = scene;
    addBase(state, 0, 10, 10);
    const villagers = [0, 1, 2].map((i) => addUnit(state, 'villager', 0, 11.5 + i, 14.5));
    const trees = [0, 1, 2, 3, 4, 5].map((i) => addResource(state, 'tree', 23 + (i % 3), 20 + Math.floor(i / 3)));
    addUnit(state, 'villager', 0, 22.5, 18.5);
    stock(state, 0, { food: 0, wood: 200 });
    apply(scene, [
      {
        type: 'gather',
        playerId: 0,
        entityIds: villagers.map((villager) => villager.id),
        targetId: trees[0].id,
        queued: false,
      },
    ]);
    state.players[0].housing = 50;
    reveal(state, 0);
    const think = thinkOf(scene);
    manageEconomy(think);
    const placed = commandsOf(think.commands, 'placeBuilding').filter(
      (command) => command.building === 'storage_pit',
    );
    expect(placed).toHaveLength(1);
    expect(Math.hypot(placed[0].tile.x - 23, placed[0].tile.y - 20)).toBeLessThan(9);
    expect(rejections(apply(scene, think.commands))).toEqual([]);
  });

  it('finds land sites the simulation accepts', () => {
    const scene = startingScene();
    const think = thinkOf(scene);
    for (const building of ['house', 'barracks', 'granary']) {
      const site = findLandSite(think, building, {
        anchor: think.home,
        minRadius: 3,
        maxRadius: 14,
        gap: 1,
        maxSolidRing: 4,
      });
      expect(site).not.toBeNull();
      if (site) {
        expect(canPlace(scene.state, 0, building, site, data)).toBe(true);
      }
    }
  });

  it('finds a dock site on the shore that the simulation accepts', () => {
    const scene = createScene();
    const { state } = scene;
    state.settings.mapType = 'coastal';
    paint(state, 20, 0, 63, 63, TERRAIN.deepWater);
    paint(state, 19, 0, 19, 63, TERRAIN.shore);
    addBase(state, 0, 10, 10);
    addUnit(state, 'villager', 0, 17.5, 11.5);
    reveal(state, 0);
    const think = thinkOf(scene);
    const site = findDockSite(think, 'dock');
    expect(site).not.toBeNull();
    if (site) {
      expect(canPlace(state, 0, 'dock', site, data)).toBe(true);
    }
  });
});
