import { describe, expect, it } from 'vitest';
import { paint, run, context } from '../../sim/__tests__/fixtures';
import { TERRAIN } from '../../sim/types';
import type { Entity } from '../../sim/types';
import { manageMilitary, launchSize } from '../military';
import { manageNavy } from '../naval';
import { chooseRoster } from '../roster';
import { unitTrainable } from '../knowledge';
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

function battlefield(): Scene {
  const scene = createScene();
  const { state } = scene;
  addBase(state, 0, 10, 10);
  addBase(state, 1, 50, 50);
  state.players[0].age = 'iron';
  scene.ai.ageSeen = 3;
  scene.ai.attackAgeTick = 0;
  state.tick = 20000;
  scene.ai.contactTick = state.tick;
  return scene;
}

function squad(scene: Scene, type: string, count: number, x: number, y: number): Entity[] {
  const units: Entity[] = [];
  for (let i = 0; i < count; i++) {
    units.push(addUnit(scene.state, type, 0, x + (i % 6), y + Math.floor(i / 6)));
  }
  return units;
}

describe('ai military', () => {
  it('trains units the civilization can field', () => {
    for (const civilization of ['greek', 'egyptian', 'assyrian', 'yamato']) {
      const scene = createScene();
      const { state } = scene;
      state.players[0].civilization = civilization;
      state.players[0].age = 'bronze';
      addBase(state, 0, 10, 10);
      const barracks = addBuilding(state, 'barracks', 0, 16, 10);
      const stable = addBuilding(state, 'stable', 0, 16, 16);
      stock(state, 0, { food: 2000, wood: 2000, gold: 2000 });
      const think = thinkOf(scene);
      manageMilitary(think, chooseRoster(think.know));
      const trained = commandsOf(think.commands, 'train');
      expect(trained.map((command) => command.buildingId).sort()).toEqual(
        [barracks.id, stable.id].sort(),
      );
      for (const command of trained) {
        expect(unitTrainable(think.know, command.unit)).toBe(true);
        expect(data.civilizations[civilization].disabledUnits).not.toContain(command.unit);
      }
      expect(rejections(apply(scene, think.commands))).toEqual([]);
    }
  });

  it('launches an attack on a known enemy building once the army is large enough', () => {
    const scene = battlefield();
    addUnit(scene.state, 'villager', 0, 49.5, 48.5);
    const first = thinkOf(scene);
    const needed = launchSize(first);
    const army = squad(scene, 'axeman', needed, 12.5, 16.5);
    const think = thinkOf(scene);
    manageMilitary(think, chooseRoster(think.know));
    expect(scene.ai.army.mode).toBe('attack');
    const orders = commandsOf(think.commands, 'attackMove');
    expect(orders).toHaveLength(1);
    expect(orders[0].entityIds.slice().sort()).toEqual(army.map((unit) => unit.id).sort());
    expect(Math.hypot(orders[0].target.x - 51.5, orders[0].target.y - 51.5)).toBeLessThan(1);
    expect(rejections(apply(scene, think.commands))).toEqual([]);
  });

  it('stays home while the army is too small or the age is too early', () => {
    const scene = battlefield();
    squad(scene, 'axeman', 3, 12.5, 16.5);
    const small = thinkOf(scene);
    manageMilitary(small, chooseRoster(small.know));
    expect(scene.ai.army.mode).toBe('home');

    const early = battlefield();
    early.state.players[0].age = 'tool';
    early.ai.ageSeen = 1;
    early.ai.ageTick = early.state.tick;
    squad(early, 'axeman', 24, 12.5, 16.5);
    const think = thinkOf(early);
    manageMilitary(think, chooseRoster(think.know));
    expect(early.ai.army.mode).toBe('home');
  });

  it('sends the reserve against enemies near the base', () => {
    const scene = battlefield();
    const guards = squad(scene, 'clubman', 3, 8.5, 15.5);
    const raider = addUnit(scene.state, 'clubman', 1, 15.5, 17.5);
    const think = thinkOf(scene);
    manageMilitary(think, chooseRoster(think.know));
    const orders = commandsOf(think.commands, 'attackMove');
    expect(orders).toHaveLength(1);
    expect(orders[0].entityIds.slice().sort()).toEqual(guards.map((unit) => unit.id).sort());
    expect(orders[0].target).toEqual(raider.position);
  });

  it('stands down when the attack force is nearly destroyed', () => {
    const scene = battlefield();
    const survivors = squad(scene, 'axeman', 2, 40.5, 40.5);
    scene.ai.army.mode = 'attack';
    scene.ai.army.members = survivors.map((unit) => unit.id);
    scene.ai.army.launchSize = 20;
    const think = thinkOf(scene);
    manageMilitary(think, chooseRoster(think.know));
    expect(scene.ai.army.mode).toBe('home');
    expect(scene.ai.army.nextAttackTick).toBeGreaterThan(scene.state.tick);
    expect(scene.ai.army.waves).toBe(1);
  });

  it('heals wounded units and converts enemies with priests', () => {
    const scene = battlefield();
    const priest = addUnit(scene.state, 'priest', 0, 12.5, 16.5);
    const wounded = addUnit(scene.state, 'clubman', 0, 13.5, 16.5);
    wounded.hp = 10;
    const healing = thinkOf(scene);
    manageMilitary(healing, chooseRoster(healing.know));
    const heal = commandsOf(healing.commands, 'heal');
    expect(heal).toEqual([
      { type: 'heal', playerId: 0, entityIds: [priest.id], targetId: wounded.id, queued: false },
    ]);
    expect(rejections(apply(scene, heal))).toEqual([]);

    const other = battlefield();
    const preacher = addUnit(other.state, 'priest', 0, 12.5, 16.5);
    const enemy = addUnit(other.state, 'cavalry', 1, 18.5, 16.5);
    const converting = thinkOf(other);
    manageMilitary(converting, chooseRoster(converting.know));
    const convert = commandsOf(converting.commands, 'convert');
    expect(convert).toEqual([
      { type: 'convert', playerId: 0, entityIds: [preacher.id], targetId: enemy.id, queued: false },
    ]);
    expect(rejections(apply(other, convert))).toEqual([]);
  });

  it('focuses ranged fire on the weakest enemy when micro quality allows', () => {
    const scene = battlefield();
    scene.state.players[0].difficulty = 'hardest';
    const archers = squad(scene, 'bowman', 3, 30.5, 30.5);
    scene.ai.army.mode = 'attack';
    scene.ai.army.members = archers.map((unit) => unit.id);
    scene.ai.army.launchSize = 3;
    addUnit(scene.state, 'clubman', 1, 33.5, 32.5);
    const weak = addUnit(scene.state, 'clubman', 1, 33.5, 31.5);
    weak.hp = 5;
    const think = thinkOf(scene);
    manageMilitary(think, chooseRoster(think.know));
    const attacks = commandsOf(think.commands, 'attack');
    expect(attacks).toHaveLength(1);
    expect(attacks[0].targetId).toBe(weak.id);
    expect(attacks[0].entityIds.slice().sort()).toEqual(archers.map((unit) => unit.id).sort());
  });
});

describe('ai navy', () => {
  it('trains a fishing boat at a dock when fish are known', () => {
    const scene = createScene();
    const { state } = scene;
    state.settings.mapType = 'coastal';
    paint(state, 20, 0, 63, 63, TERRAIN.deepWater);
    paint(state, 19, 0, 19, 63, TERRAIN.shore);
    addBase(state, 0, 8, 10);
    const dock = addBuilding(state, 'dock', 0, 18, 10);
    addResource(state, 'deep_fish', 23, 11);
    stock(state, 0, { wood: 200 });
    const think = thinkOf(scene);
    manageNavy(think);
    expect(commandsOf(think.commands, 'train')).toEqual([
      { type: 'train', playerId: 0, buildingId: dock.id, unit: 'fishing_boat', count: 1 },
    ]);
    expect(rejections(apply(scene, think.commands))).toEqual([]);
  });

  it('ferries the attack force to another island and lands it', () => {
    const scene = createScene();
    const { state } = scene;
    state.settings.mapType = 'small_islands';
    paint(state, 0, 0, 63, 63, TERRAIN.deepWater);
    paint(state, 4, 4, 18, 18, TERRAIN.grass);
    paint(state, 40, 40, 54, 54, TERRAIN.grass);
    addBase(state, 0, 8, 8);
    addBase(state, 1, 46, 46);
    const soldiers = [0, 1, 2, 3].map((i) => addUnit(state, 'clubman', 0, 16.5, 10.5 + i));
    addUnit(state, 'light_transport', 0, 20.5, 12.5);
    scene.ai.army.mode = 'attack';
    scene.ai.army.members = soldiers.map((unit) => unit.id);
    scene.ai.army.launchSize = soldiers.length;
    reveal(state, 0);
    const ctx = context();
    let loaded = false;
    let landed = false;
    for (let round = 0; round < 400 && !landed; round++) {
      const think = thinkOf(scene);
      manageMilitary(think, chooseRoster(think.know));
      manageNavy(think);
      loaded = loaded || commandsOf(think.commands, 'load').length > 0;
      expect(rejections(apply(scene, think.commands))).toEqual([]);
      run(state, ctx, 19);
      landed = soldiers.some(
        (unit) => state.entities[unit.id]?.carriedBy === null && unit.position.x >= 40,
      );
    }
    expect(loaded).toBe(true);
    expect(landed).toBe(true);
  });
});
