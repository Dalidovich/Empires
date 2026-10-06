import { describe, expect, it } from 'vitest';
import { buildPlayerView } from '../../sim/snapshot';
import { manageDiplomacy, observeTribute } from '../diplomacy';
import { manageMilitary } from '../military';
import { chooseRoster } from '../roster';
import {
  addBase,
  addUnit,
  apply,
  commandsOf,
  createScene,
  data,
  rejections,
  stock,
  thinkOf,
} from './helpers';
import type { Scene } from './helpers';

function table(lockTeams: boolean): Scene {
  const scene = createScene(64, 3);
  const { state } = scene;
  state.settings.lockTeams = lockTeams;
  state.players[1].kind = 'human';
  state.players[1].difficulty = null;
  addBase(state, 0, 10, 10);
  addBase(state, 1, 50, 50);
  addBase(state, 2, 50, 10);
  return scene;
}

describe('ai diplomacy', () => {
  it('turns hostile toward a player that attacks it', () => {
    const scene = table(false);
    const { state } = scene;
    state.players[0].diplomacy[1] = 'neutral';
    const villager = addUnit(state, 'villager', 0, 12.5, 15.5);
    const raider = addUnit(state, 'clubman', 1, 13.5, 15.5);
    raider.state = 'attacking';
    raider.target = villager.id;
    const think = thinkOf(scene);
    manageDiplomacy(think);
    expect(commandsOf(think.commands, 'setStance')).toEqual([
      { type: 'setStance', playerId: 0, targetPlayerId: 1, stance: 'enemy' },
    ]);
    expect(rejections(apply(scene, think.commands))).toEqual([]);
    expect(state.players[0].diplomacy[1]).toBe('enemy');
    expect(scene.ai.grudgeTick[1]).toBeDefined();
  });

  it('ignores units that merely stand nearby', () => {
    const scene = table(false);
    scene.state.players[0].diplomacy[1] = 'neutral';
    addUnit(scene.state, 'villager', 0, 12.5, 15.5);
    addUnit(scene.state, 'clubman', 1, 13.5, 15.5);
    const think = thinkOf(scene);
    manageDiplomacy(think);
    expect(think.commands).toEqual([]);
  });

  it('warms up to a player that pays tribute', () => {
    const scene = table(false);
    const { state } = scene;
    stock(state, 0, { food: 100 });
    observeTribute(buildPlayerView(state, 0, data), scene.ai);
    stock(state, 0, { food: 110 });
    observeTribute(buildPlayerView(state, 0, data), scene.ai);
    expect(scene.ai.tributeCredit[1] ?? 0).toBe(0);

    stock(state, 0, { food: 610 });
    observeTribute(buildPlayerView(state, 0, data), scene.ai);
    expect(scene.ai.tributeCredit[1]).toBe(500);
    expect(scene.ai.tributeCredit[2]).toBeUndefined();

    const think = thinkOf(scene);
    manageDiplomacy(think);
    expect(commandsOf(think.commands, 'setStance')).toEqual([
      { type: 'setStance', playerId: 0, targetPlayerId: 1, stance: 'neutral' },
    ]);
    expect(rejections(apply(scene, think.commands))).toEqual([]);
    expect(state.players[0].diplomacy[1]).toBe('neutral');
    expect(state.players[0].diplomacy[2]).toBe('enemy');
  });

  it('keeps a grudge against a recent attacker despite tribute', () => {
    const scene = table(false);
    scene.ai.grudgeTick[1] = scene.state.tick;
    scene.ai.tributeCredit[1] = 5000;
    const think = thinkOf(scene);
    manageDiplomacy(think);
    expect(think.commands).toEqual([]);
  });

  it('does nothing when teams are locked', () => {
    const scene = table(true);
    const { state } = scene;
    const villager = addUnit(state, 'villager', 0, 12.5, 15.5);
    const raider = addUnit(state, 'clubman', 1, 13.5, 15.5);
    raider.state = 'attacking';
    raider.target = villager.id;
    stock(state, 0, { food: 100 });
    observeTribute(buildPlayerView(state, 0, data), scene.ai);
    stock(state, 0, { food: 2000 });
    observeTribute(buildPlayerView(state, 0, data), scene.ai);
    const think = thinkOf(scene);
    manageDiplomacy(think);
    expect(think.commands).toEqual([]);
    expect(scene.ai.tributeCredit).toEqual({});
  });

  it('does not order attacks on players it is not hostile to', () => {
    const scene = table(false);
    const { state } = scene;
    state.players[0].diplomacy[1] = 'neutral';
    state.players[0].diplomacy[2] = 'ally';
    state.players[0].age = 'iron';
    scene.ai.ageSeen = 3;
    scene.ai.attackAgeTick = 0;
    state.tick = 20000;
    scene.ai.contactTick = state.tick;
    for (let i = 0; i < 24; i++) {
      addUnit(state, 'axeman', 0, 12.5 + (i % 6), 16.5 + Math.floor(i / 6));
    }
    addUnit(state, 'villager', 0, 49.5, 48.5);
    addUnit(state, 'villager', 0, 49.5, 8.5);
    const think = thinkOf(scene);
    expect(think.enemyBuildings).toEqual([]);
    manageMilitary(think, chooseRoster(think.know));
    expect(commandsOf(think.commands, 'attack')).toEqual([]);
    for (const order of commandsOf(think.commands, 'attackMove')) {
      expect(Math.hypot(order.target.x - 51.5, order.target.y - 51.5)).toBeGreaterThan(4);
      expect(Math.hypot(order.target.x - 51.5, order.target.y - 11.5)).toBeGreaterThan(4);
    }
  });
});
