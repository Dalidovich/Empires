import { describe, expect, it } from 'vitest';
import type { Command } from '../commands';
import {
  advanceSession,
  createSession,
  queueCommands,
  saveSession,
  sessionView,
  startSession,
} from '../core/session';
import { step } from '../engine';
import { deserialize, serialize } from '../serialize';
import type { GameState, PlayerSetup } from '../types';
import { TERRAIN } from '../types';
import { addTree, addUnit, baseSettings, context, data, emptyState, paint, run } from './fixtures';

function busyState(): { state: GameState; commands: Command[] } {
  const state = emptyState(64);
  paint(state, 40, 0, 47, 63, TERRAIN.deepWater);
  for (let y = 0; y < 64; y++) {
    if (y % 9 !== 4) {
      addTree(state, 20, y);
    }
  }
  const walkers: number[] = [];
  for (let i = 0; i < 60; i++) {
    walkers.push(addUnit(state, 'villager', 0, 3.5 + (i % 6), 10.5 + Math.floor(i / 6)).id);
  }
  const riders: number[] = [];
  for (let i = 0; i < 3; i++) {
    riders.push(addUnit(state, 'villager', 1, 37.5, 30.5 + i).id);
  }
  const ship = addUnit(state, 'light_transport', 1, 42.5, 31.5);
  const commands: Command[] = [
    { type: 'move', playerId: 0, entityIds: walkers, target: { x: 33.5, y: 40.5 }, queued: false },
    { type: 'move', playerId: 0, entityIds: walkers, target: { x: 5.5, y: 50.5 }, queued: true },
    { type: 'load', playerId: 1, entityIds: riders, transportId: ship.id, queued: false },
    { type: 'unload', playerId: 1, entityIds: [ship.id], target: { x: 55.5, y: 12.5 }, queued: true },
  ];
  return { state, commands };
}

describe('serialization', () => {
  it('rejects malformed saves', () => {
    const state = emptyState(8);
    const game = serialize(state);
    expect(() => deserialize({ ...game, state: null as unknown as GameState })).toThrow();
    const broken = structuredClone(game);
    broken.state.map.terrain.pop();
    expect(() => deserialize(broken)).toThrow();
  });

  it('continues tick-for-tick identically from a loaded state', () => {
    const { state, commands } = busyState();
    const ctx = context();
    run(state, ctx, 150, commands);
    const loaded = deserialize(serialize(state)).state;
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(state));

    const loadedCtx = context();
    for (let i = 0; i < 400; i++) {
      step(state, [], ctx);
      step(loaded, [], loadedCtx);
      if (i % 50 === 0) {
        expect(JSON.stringify(loaded)).toBe(JSON.stringify(state));
      }
    }
    expect(JSON.stringify(serialize(loaded))).toBe(JSON.stringify(serialize(state)));
    expect(Object.values(state.entities).some((entity) => entity.orders.length === 0)).toBe(true);
  });

  it('gives identical states for identical command streams', () => {
    const play = (): string => {
      const { state, commands } = busyState();
      run(state, context(), 300, commands);
      return JSON.stringify(state);
    };
    expect(play()).toBe(play());
  });

  it('survives JSON as a transport format', () => {
    const { state, commands } = busyState();
    const ctx = context();
    run(state, ctx, 80, commands);
    const loaded = JSON.parse(JSON.stringify(serialize(state))).state as GameState;
    run(state, ctx, 120);
    run(loaded, context(), 120);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(state));
  });
});

describe('session host', () => {
  const players: PlayerSetup[] = [
    { id: 0, kind: 'human', civilization: 'assyrian', team: null, color: 1, difficulty: null },
    { id: 1, kind: 'ai', civilization: 'greek', team: null, color: 2, difficulty: 'hard' },
  ];

  it('advances ticks, applies queued commands and honours pause', () => {
    const session = startSession(baseSettings, players, 5, data, () => {});
    expect(session.ais.map((ai) => ai.playerId)).toEqual([1]);
    expect(advanceSession(session)).toEqual([]);
    expect(session.state.tick).toBe(1);

    queueCommands(session, [{ type: 'pause', playerId: 0, paused: true }]);
    expect(advanceSession(session)).toEqual([]);
    expect(session.state.paused).toBe(true);
    expect(advanceSession(session)).toBeNull();
    expect(session.state.tick).toBe(1);

    queueCommands(session, [{ type: 'pause', playerId: 0, paused: false }]);
    advanceSession(session);
    expect(session.state.tick).toBe(2);
    expect(sessionView(session, 0).tick).toBe(2);
  });

  it('saves and resumes with identical results', () => {
    const session = startSession(baseSettings, players, 5, data, () => {});
    const villagers = Object.values(session.state.entities)
      .filter((entity) => entity.owner === 0 && entity.kind === 'unit')
      .map((entity) => entity.id);
    queueCommands(session, [
      { type: 'move', playerId: 0, entityIds: villagers, target: { x: 20.5, y: 20.5 }, queued: false },
    ]);
    for (let i = 0; i < 40; i++) {
      advanceSession(session);
    }
    const resumed = createSession(deserialize(saveSession(session)), data, () => {});
    expect(resumed.ais).toHaveLength(1);
    for (let i = 0; i < 200; i++) {
      advanceSession(session);
      advanceSession(resumed);
    }
    expect(JSON.stringify(saveSession(resumed))).toBe(JSON.stringify(saveSession(session)));
  });

  it('propagates simulation exceptions to the host', () => {
    const session = startSession(baseSettings, players, 5, data, () => {});
    session.ais.push({
      playerId: 1,
      think: () => {
        throw new Error('ai failure');
      },
      serialize: () => null,
    });
    expect(() => advanceSession(session)).toThrow('ai failure');
  });
});
