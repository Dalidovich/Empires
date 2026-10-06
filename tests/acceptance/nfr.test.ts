import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../../src/data';
import { spawnEntity } from '../../src/sim/core/entities';
import { isPassable } from '../../src/sim/core/navgrid';
import type * as SessionModule from '../../src/sim/core/session';
import type { Session } from '../../src/sim/core/session';
import {
  advanceSession,
  createSession,
  queueCommands,
  saveSession,
  startSession,
} from '../../src/sim/core/session';
import type {
  MainToWorkerMessage,
  SerializedGame,
  WorkerToMainMessage,
} from '../../src/sim/protocol';
import { deserialize } from '../../src/sim/serialize';
import { consoleLogger } from '../../src/sim/system';
import type { JsonValue, PlayerSetup, Settings } from '../../src/sim/types';
import { createSaveStore } from '../../src/storage';
import { writeResult } from './support/results';

const data = loadGameData();

const LONG_TEST_MS = 240000;

const DUEL: Settings = {
  mapType: 'inland',
  mapSize: 'tiny',
  victoryMode: 'conquest',
  populationLimit: 50,
  startingAge: 'stone',
  revealMap: false,
  lockTeams: true,
  speed: 'normal',
};

const DUELISTS: PlayerSetup[] = [
  { id: 0, kind: 'ai', civilization: 'assyrian', team: null, color: 1, difficulty: 'hard' },
  { id: 1, kind: 'ai', civilization: 'greek', team: null, color: 2, difficulty: 'hard' },
];

interface WorkerHarness {
  send(message: MainToWorkerMessage): void;
  fire(elapsedMs: number): boolean;
  messages: WorkerToMainMessage[];
}

async function bootWorker(): Promise<WorkerHarness> {
  vi.resetModules();
  let clock = 0;
  let pending: (() => void) | null = null;
  const messages: WorkerToMainMessage[] = [];
  const scope = {
    onmessage: null as ((event: { data: MainToWorkerMessage }) => void) | null,
    postMessage: (message: WorkerToMainMessage) => {
      messages.push(JSON.parse(JSON.stringify(message)) as WorkerToMainMessage);
    },
  };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('performance', { now: () => clock });
  vi.stubGlobal('setTimeout', (callback: () => void) => {
    pending = callback;
    return 1;
  });
  vi.stubGlobal('clearTimeout', () => {
    pending = null;
  });
  await import('../../src/sim/worker');
  return {
    messages,
    send: (message) => scope.onmessage?.({ data: message }),
    fire: (elapsedMs) => {
      const callback = pending;
      if (!callback) {
        return false;
      }
      clock += elapsedMs;
      pending = null;
      callback();
      return true;
    },
  };
}

function ticksSeen(messages: readonly WorkerToMainMessage[]): number {
  let tick = 0;
  for (const message of messages) {
    if (message.type === 'snapshot') {
      tick = message.view.tick;
    }
  }
  return tick;
}

function record(messages: readonly WorkerToMainMessage[], untilTick: number): {
  events: string;
  views: Map<number, string>;
} {
  const events: unknown[] = [];
  const views = new Map<number, string>();
  for (const message of messages) {
    if (message.type === 'events' && message.tick <= untilTick) {
      events.push([message.tick, message.events]);
    } else if (message.type === 'snapshot' && message.view.tick <= untilTick) {
      views.set(message.view.tick, JSON.stringify(message.view));
    }
  }
  return { events: JSON.stringify(events), views };
}

async function playWorker(cadence: (step: number) => number, untilTick: number): Promise<WorkerToMainMessage[]> {
  const worker = await bootWorker();
  worker.send({ type: 'init', settings: DUEL, players: DUELISTS, seed: 9, viewerId: 0 });
  for (let step = 0; ticksSeen(worker.messages) < untilTick + 5; step++) {
    if (!worker.fire(cadence(step))) {
      throw new Error('worker stopped');
    }
  }
  worker.send({ type: 'stop' });
  return worker.messages;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../../src/sim/core/session');
  vi.resetModules();
});

describe('NFR-2: fixed simulation step', { timeout: LONG_TEST_MS }, () => {
  it('runs 20 ticks per second at speed 1.0 and scales with the speed setting', async () => {
    expect(data.game.tickRate).toBe(20);
    const worker = await bootWorker();
    worker.send({ type: 'init', settings: { ...DUEL, speed: 'slow' }, players: DUELISTS, seed: 9, viewerId: 0 });
    for (let step = 0; step < 100; step++) {
      worker.fire(50);
    }
    expect(ticksSeen(worker.messages)).toBe(100);
    worker.send({ type: 'commands', commands: [{ type: 'setSpeed', playerId: 0, speed: 'fast' }] });
    for (let step = 0; step < 100; step++) {
      worker.fire(50);
    }
    const afterFast = ticksSeen(worker.messages);
    expect(afterFast).toBeGreaterThanOrEqual(298);
    expect(afterFast).toBeLessThanOrEqual(300);
    worker.send({ type: 'stop' });
  });

  it('gives the same results whatever the host timing is', async () => {
    const untilTick = 2500;
    const steady = record(await playWorker(() => 33.4, untilTick), untilTick);
    const jittery = record(
      await playWorker((step) => (step % 17 === 0 ? 2400 : step % 5 === 0 ? 140 : 9), untilTick),
      untilTick,
    );
    expect(jittery.events).toBe(steady.events);
    expect(steady.events.length).toBeGreaterThan(1000);
    let compared = 0;
    for (const [tick, view] of jittery.views) {
      const reference = steady.views.get(tick);
      if (reference !== undefined) {
        expect(view).toBe(reference);
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(50);
  });
});

function crowdedSession(units: number): Session {
  const settings: Settings = { ...DUEL, mapType: 'inland', mapSize: 'huge', populationLimit: 200 };
  const players: PlayerSetup[] = [];
  const civilizations = Object.keys(data.civilizations);
  for (let id = 0; id < 8; id++) {
    players.push({
      id,
      kind: 'ai',
      civilization: civilizations[id],
      team: null,
      color: id,
      difficulty: 'moderate',
    });
  }
  const session = startSession(settings, players, 3, data, () => {});
  const { state } = session;
  const size = state.map.size;
  const types = ['axeman', 'bowman', 'villager', 'scout'];
  let spawned = Object.values(state.entities).filter((entity) => entity.kind === 'unit' && entity.owner >= 0).length;
  for (let index = 0; spawned < units; index++) {
    const x = 3 + ((index * 7) % (size - 6));
    const y = 3 + ((index * 13 + Math.floor(index / size) * 5) % (size - 6));
    if (!isPassable(state, data, 'land', x, y)) {
      continue;
    }
    spawnEntity(
      state,
      { kind: 'unit', type: types[index % types.length], owner: index % 8, position: { x: x + 0.5, y: y + 0.5 } },
      data,
    );
    spawned += 1;
  }
  const commands = players.map((player) => ({
    type: 'attackMove' as const,
    playerId: player.id,
    entityIds: Object.values(state.entities)
      .filter((entity) => entity.kind === 'unit' && entity.owner === player.id)
      .map((entity) => entity.id),
    target: { x: size / 2, y: size / 2 },
    queued: false,
  }));
  queueCommands(session, commands);
  for (let tick = 0; tick < 60; tick++) {
    advanceSession(session);
  }
  return session;
}

describe('NFR-1: simulation load with 1600 units', { timeout: LONG_TEST_MS }, () => {
  it('records the tick cost against the tick interval of the fastest game speed', () => {
    const session = crowdedSession(1600);
    const ticks = 200;
    const durations: number[] = [];
    const cpuStarted = process.cpuUsage();
    for (let tick = 0; tick < ticks; tick++) {
      const started = performance.now();
      advanceSession(session);
      durations.push(performance.now() - started);
    }
    const cpu = process.cpuUsage(cpuStarted);
    const cpuAverage = (cpu.user + cpu.system) / 1000 / ticks;
    durations.sort((a, b) => a - b);
    const average = durations.reduce((sum, value) => sum + value, 0) / ticks;
    const rules = data.game;
    const budget = 1000 / (rules.tickRate * Math.max(...Object.values(rules.speedMultipliers)));
    writeResult('nfr1-sim', {
      units: 1600,
      mapTiles: session.state.map.size,
      ticks,
      cpuAverageMs: Number(cpuAverage.toFixed(2)),
      averageMs: Number(average.toFixed(2)),
      medianMs: Number(durations[ticks / 2].toFixed(2)),
      p95Ms: Number(durations[Math.floor(ticks * 0.95)].toFixed(2)),
      maxMs: Number(durations[ticks - 1].toFixed(2)),
      budgetMs: budget,
    });
    expect(budget).toBe(25);
    expect(average).toBeLessThan(budget * 10);
  });
});

describe('NFR-6: saving and loading 1600 units', { timeout: LONG_TEST_MS }, () => {
  it('each take less than 3 seconds on a 200×200 map', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const session = crowdedSession(1600);
    const units = Object.values(session.state.entities).filter(
      (entity) => entity.kind === 'unit' && entity.owner >= 0,
    ).length;
    expect(units).toBeGreaterThanOrEqual(1600);
    expect(session.state.map.size).toBe(200);
    const store = createSaveStore();

    const saveStarted = Date.now();
    const game = saveSession(session);
    const saved = await store.save({
      name: 'load test',
      summary: { mapType: 'inland', mapSize: 'huge', civilization: 'assyrian', gameTicks: game.state.tick },
      state: game as unknown as JsonValue,
    });
    const saveMs = Date.now() - saveStarted;
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }

    const loadStarted = Date.now();
    const loaded = await store.load(saved.value.id);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    const restored = createSession(deserialize(loaded.value.state as unknown as SerializedGame), data, () => {});
    advanceSession(restored);
    const loadMs = Date.now() - loadStarted;

    writeResult('nfr6', { units, mapTiles: session.state.map.size, saveMs, loadMs });
    expect(saveMs).toBeLessThan(3000);
    expect(loadMs).toBeLessThan(3000);
    advanceSession(session);
    expect(JSON.stringify(saveSession(restored))).toBe(JSON.stringify(saveSession(session)));
  });
});

describe('NFR-7: simulation failures', () => {
  it('reports an exception inside a tick with its tick and stops the loop', async () => {
    vi.doMock('../../src/sim/core/session', async (original) => {
      const actual = await original<typeof SessionModule>();
      return {
        ...actual,
        advanceSession: (session: Session) => {
          if (session.state.tick === 7) {
            throw new Error('boom');
          }
          return actual.advanceSession(session);
        },
      };
    });
    const worker = await bootWorker();
    worker.send({ type: 'init', settings: DUEL, players: DUELISTS, seed: 9, viewerId: 0 });
    let fired = 0;
    while (worker.fire(40) && fired < 100) {
      fired += 1;
    }
    const errors = worker.messages.filter((message) => message.type === 'error');
    expect(errors).toEqual([{ type: 'error', code: 'simulation_error', tick: 7, message: 'boom' }]);
    expect(worker.fire(40)).toBe(false);
    const before = worker.messages.length;
    worker.send({ type: 'commands', commands: [{ type: 'pause', playerId: 0, paused: true }] });
    worker.send({ type: 'saveRequest', requestId: 1 });
    expect(worker.messages).toHaveLength(before);
  });

  it('reports a failed start and a malformed save instead of throwing', async () => {
    const worker = await bootWorker();
    expect(() =>
      worker.send({
        type: 'init',
        settings: DUEL,
        players: [{ ...DUELISTS[0], civilization: 'atlantean' }, DUELISTS[1]],
        seed: 1,
        viewerId: 0,
      }),
    ).not.toThrow();
    expect(worker.messages.at(-1)).toMatchObject({ type: 'error', code: 'simulation_error' });
    expect(() =>
      worker.send({ type: 'load', game: { state: { tick: 3 } } as unknown as SerializedGame, viewerId: 0 }),
    ).not.toThrow();
    expect(worker.messages.at(-1)).toMatchObject({ type: 'error', code: 'load_failed' });
    expect(() => worker.send({ type: 'bogus' } as unknown as MainToWorkerMessage)).not.toThrow();
    expect(worker.messages.at(-1)).toMatchObject({ type: 'error', code: 'invalid_message' });
  });
});

describe('NFR-8: log format', () => {
  it('prefixes browser console lines with the simulation tick', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger('warn', 120, 'path budget exhausted');
    consoleLogger('error', 345, 'boom');
    expect(warn).toHaveBeenCalledWith('[tick 120] path budget exhausted');
    expect(error).toHaveBeenCalledWith('[tick 345] boom');
    warn.mockRestore();
    error.mockRestore();
  });
});
