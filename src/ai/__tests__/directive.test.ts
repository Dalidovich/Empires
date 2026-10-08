import { describe, expect, it } from 'vitest';
import { refreshFog } from '../../sim/__tests__/fixtures';
import { buildPlayerView } from '../../sim/snapshot';
import type { Entity } from '../../sim/types';
import { observeTribute } from '../diplomacy';
import { createAi } from '../index';
import { launchSize, manageMilitary } from '../military';
import { chooseRoster } from '../roster';
import { addBase, addUnit, commandsOf, createScene, data, stock, thinkOf } from './helpers';
import type { Scene } from './helpers';

function battlefield(): Scene {
  const scene = createScene(64, 3);
  const { state } = scene;
  state.settings.sandbox = true;
  state.settings.lockTeams = false;
  addBase(state, 0, 10, 10);
  addBase(state, 1, 50, 50);
  addBase(state, 2, 50, 10);
  state.players[0].age = 'iron';
  scene.ai.ageSeen = 3;
  scene.ai.attackAgeTick = 0;
  state.tick = 20000;
  scene.ai.contactTick = state.tick;
  return scene;
}

function squad(scene: Scene, count: number): Entity[] {
  const units: Entity[] = [];
  for (let i = 0; i < count; i++) {
    units.push(addUnit(scene.state, 'axeman', 0, 12.5 + (i % 6), 16.5 + Math.floor(i / 6)));
  }
  return units;
}

describe('ai directive', () => {
  it('passive: never launches and recalls a running attack', () => {
    const scene = battlefield();
    const army = squad(scene, launchSize(thinkOf(scene)));
    scene.state.players[0].aiDirective = { mode: 'passive', victimId: null };
    const held = thinkOf(scene);
    manageMilitary(held, chooseRoster(held.know));
    expect(scene.ai.army.mode).toBe('home');

    scene.ai.army.mode = 'attack';
    scene.ai.army.members = army.map((unit) => unit.id);
    scene.ai.army.launchSize = army.length;
    const recalled = thinkOf(scene);
    manageMilitary(recalled, chooseRoster(recalled.know));
    expect(scene.ai.army.mode).toBe('home');
    const orders = commandsOf(recalled.commands, 'attackMove');
    expect(orders).toHaveLength(1);
    expect(orders[0].entityIds.slice().sort()).toEqual(army.map((unit) => unit.id).sort());
    expect(Math.hypot(orders[0].target.x - 11.5, orders[0].target.y - 11.5)).toBeLessThan(12);

    delete scene.state.players[0].aiDirective;
    scene.ai.army.nextAttackTick = 0;
    scene.ai.army.waves = 0;
    const free = thinkOf(scene);
    manageMilitary(free, chooseRoster(free.know));
    expect(scene.ai.army.mode).toBe('attack');
  });

  it('attack: launches at once toward the chosen victim, even an unseen one', () => {
    const scene = battlefield();
    const army = squad(scene, 2);
    scene.state.players[0].aiDirective = { mode: 'attack', victimId: 2 };
    const think = thinkOf(scene);
    expect(think.enemyBuildings).toEqual([]);
    manageMilitary(think, chooseRoster(think.know));
    expect(scene.ai.army.mode).toBe('attack');
    const orders = commandsOf(think.commands, 'attackMove');
    expect(orders).toHaveLength(1);
    expect(orders[0].entityIds.slice().sort()).toEqual(army.map((unit) => unit.id).sort());
    expect(Math.hypot(orders[0].target.x - 51.5, orders[0].target.y - 11.5)).toBeLessThan(1);
  });

  it('attack: prefers the victim over a nearer enemy and stops when the victim is defeated', () => {
    const scene = battlefield();
    squad(scene, 2);
    addUnit(scene.state, 'villager', 0, 48.5, 49.5);
    addUnit(scene.state, 'villager', 0, 48.5, 11.5);
    scene.state.players[0].aiDirective = { mode: 'attack', victimId: 1 };
    const think = thinkOf(scene);
    expect(think.enemyBuildings).toHaveLength(2);
    manageMilitary(think, chooseRoster(think.know));
    const [order] = commandsOf(think.commands, 'attackMove');
    expect(Math.hypot(order.target.x - 51.5, order.target.y - 51.5)).toBeLessThan(1);

    const idle = battlefield();
    squad(idle, 2);
    idle.state.players[0].aiDirective = { mode: 'attack', victimId: 1 };
    idle.state.players[1].defeated = true;
    const after = thinkOf(idle);
    manageMilitary(after, chooseRoster(after.know));
    expect(idle.ai.army.mode).toBe('home');
  });

  it('off and frozen: the controller gives no orders', () => {
    const scene = battlefield();
    squad(scene, 4);
    stock(scene.state, 0, { food: 2000, wood: 2000 });
    refreshFog(scene.state);
    const level = data.aiLevels.moderate;
    const orders = (): number => {
      const ai = createAi(0, 'moderate', data);
      let count = 0;
      for (let tick = 0; tick < level.decisionIntervalTicks * 2; tick++) {
        scene.state.tick = 20000 + tick;
        count += ai.think(buildPlayerView(scene.state, 0, data), scene.state.tick).length;
      }
      return count;
    };
    expect(orders()).toBeGreaterThan(0);
    scene.state.players[0].aiDirective = { mode: 'off', victimId: null };
    expect(orders()).toBe(0);
    scene.state.players[0].aiDirective = { mode: 'frozen', victimId: null };
    expect(orders()).toBe(0);
  });

  it('does not take a sandbox grant for tribute', () => {
    const scene = battlefield();
    scene.state.players[1].kind = 'human';
    refreshFog(scene.state);
    observeTribute(buildPlayerView(scene.state, 0, data), scene.ai);
    stock(scene.state, 0, { food: 5000 });
    scene.state.tick += 1;
    scene.state.players[0].sandboxGrantTick = scene.state.tick;
    observeTribute(buildPlayerView(scene.state, 0, data), scene.ai);
    expect(scene.ai.tributeCredit).toEqual({});

    stock(scene.state, 0, { food: 9000 });
    scene.state.tick += 1;
    observeTribute(buildPlayerView(scene.state, 0, data), scene.ai);
    expect(scene.ai.tributeCredit[1]).toBeGreaterThan(0);
  });
});
