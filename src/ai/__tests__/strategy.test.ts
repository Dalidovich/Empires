import { describe, expect, it } from 'vitest';
import { manageEconomy } from '../economy';
import { manageMilitary } from '../military';
import { manageRelics } from '../relics';
import { chooseRoster } from '../roster';
import { manageStrategy, planAgeAdvance } from '../strategy';
import { spawnEntity } from '../../sim/core/entities';
import { GAIA_PLAYER_ID } from '../../sim/types';
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

function settled(villagers: number): Scene {
  const scene = createScene();
  const { state } = scene;
  addBase(state, 0, 10, 10);
  for (let i = 0; i < villagers; i++) {
    addUnit(state, 'villager', 0, 8.5 + i, 14.5);
  }
  for (let i = 0; i < 6; i++) {
    addResource(state, 'tree', 4, 6 + i);
  }
  reveal(state, 0);
  return scene;
}

describe('ai strategy', () => {
  it('researches the next age as soon as it is available and affordable', () => {
    const scene = settled(3);
    addBuilding(scene.state, 'granary', 0, 15, 10);
    addBuilding(scene.state, 'storage_pit', 0, 15, 15);
    stock(scene.state, 0, { food: 500 });
    const think = thinkOf(scene);
    planAgeAdvance(think);
    const research = commandsOf(think.commands, 'research');
    expect(research.map((command) => command.technology)).toEqual(['tool_age']);
    expect(think.holdTownCenter).toBe(true);
    expect(rejections(apply(scene, think.commands))).toEqual([]);
    expect(Object.values(scene.state.entities).some((entity) => entity.research?.technology === 'tool_age')).toBe(true);
  });

  it('does not queue villagers while the town center is needed for the age advance', () => {
    const scene = settled(3);
    addBuilding(scene.state, 'granary', 0, 15, 10);
    addBuilding(scene.state, 'storage_pit', 0, 15, 15);
    stock(scene.state, 0, { food: 560 });
    const think = thinkOf(scene);
    planAgeAdvance(think);
    manageEconomy(think);
    expect(commandsOf(think.commands, 'train')).toEqual([]);
  });

  it('builds the buildings that qualify for the next age', () => {
    const scene = settled(4);
    stock(scene.state, 0, { food: 100, wood: 400 });
    const think = thinkOf(scene);
    manageStrategy(think, chooseRoster(think.know));
    const placed = commandsOf(think.commands, 'placeBuilding').map((command) => command.building);
    expect(placed.length).toBeGreaterThan(0);
    const qualifying = data.game.ages[1].qualifyingBuildings;
    expect(qualifying).toContain(placed[0]);
    expect(rejections(apply(scene, think.commands))).toEqual([]);
  });

  it('saves resources for the age advance once the economy is in place', () => {
    const scene = settled(9);
    addBuilding(scene.state, 'granary', 0, 15, 10);
    addBuilding(scene.state, 'storage_pit', 0, 15, 15);
    addBuilding(scene.state, 'barracks', 0, 15, 5);
    stock(scene.state, 0, { food: 300, wood: 0 });
    const think = thinkOf(scene);
    const roster = chooseRoster(think.know);
    manageStrategy(think, roster);
    manageMilitary(think, roster);
    expect(think.budget.food).toBeLessThan(0);
    expect(commandsOf(think.commands, 'train')).toEqual([]);
  });

  it('researches economy technologies with spare resources', () => {
    const scene = settled(4);
    const { state } = scene;
    state.players[0].age = 'tool';
    addBuilding(state, 'granary', 0, 15, 10);
    const market = addBuilding(state, 'market', 0, 15, 15);
    stock(state, 0, { food: 400, wood: 400 });
    const think = thinkOf(scene);
    manageStrategy(think, chooseRoster(think.know));
    const research = commandsOf(think.commands, 'research').filter(
      (command) => command.buildingId === market.id,
    );
    expect(research).toHaveLength(1);
    expect(data.technologies[research[0].technology].building).toBe('market');
    expect(rejections(apply(scene, think.commands))).toEqual([]);
  });

  it('never researches technologies disabled for the civilization', () => {
    for (const civilization of ['persian', 'egyptian', 'sumerian']) {
      const scene = settled(4);
      const { state } = scene;
      state.players[0].civilization = civilization;
      state.players[0].age = 'iron';
      for (const [index, building] of ['granary', 'market', 'storage_pit', 'barracks'].entries()) {
        addBuilding(state, building, 0, 15 + index * 5, 10);
      }
      stock(state, 0, { food: 5000, wood: 5000, gold: 5000, stone: 5000 });
      const think = thinkOf(scene);
      manageStrategy(think, chooseRoster(think.know));
      const disabled = data.civilizations[civilization].disabledTechs;
      for (const command of commandsOf(think.commands, 'research')) {
        expect(disabled).not.toContain(command.technology);
      }
      expect(rejections(apply(scene, think.commands))).toEqual([]);
    }
  });

  it('builds a wonder in the standard victory mode when it can afford one', () => {
    const scene = settled(8);
    const { state } = scene;
    state.settings.victoryMode = 'standard';
    state.players[0].age = 'iron';
    stock(state, 0, { food: 2000, wood: 2000, gold: 2000, stone: 2000 });
    const think = thinkOf(scene);
    manageStrategy(think, chooseRoster(think.know));
    const placed = commandsOf(think.commands, 'placeBuilding').map((command) => command.building);
    expect(placed).toContain('wonder');

    state.settings.victoryMode = 'conquest';
    const conquest = thinkOf(scene);
    manageStrategy(conquest, chooseRoster(conquest.know));
    const other = commandsOf(conquest.commands, 'placeBuilding').map((command) => command.building);
    expect(other).not.toContain('wonder');
  });

  it('sends a unit to collect a free artifact in the standard victory mode', () => {
    const scene = settled(3);
    const { state } = scene;
    state.settings.victoryMode = 'standard';
    const soldiers = [0, 1, 2].map((i) => addUnit(state, 'clubman', 0, 12.5 + i, 16.5));
    const artifact = spawnEntity(
      state,
      { kind: 'object', type: 'artifact', owner: GAIA_PLAYER_ID, position: { x: 17.5, y: 13.5 } },
      data,
    );
    const think = thinkOf(scene);
    manageRelics(think);
    const moves = commandsOf(think.commands, 'move');
    expect(moves).toHaveLength(1);
    expect(soldiers.map((soldier) => soldier.id)).toContain(moves[0].entityIds[0]);
    expect(moves[0].target).toEqual(artifact.position);
    expect(scene.ai.collector.unitId).toBe(moves[0].entityIds[0]);
  });
});
