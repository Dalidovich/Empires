import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../../src/data';
import type { Session } from '../../src/sim/core/session';
import {
  advanceSession,
  createSession,
  queueCommands,
  saveSession,
  startSession,
} from '../../src/sim/core/session';
import type { SerializedGame } from '../../src/sim/protocol';
import { deserialize } from '../../src/sim/serialize';
import type { JsonValue, PlayerSetup, Settings } from '../../src/sim/types';
import type { SaveInput, SaveRecord, SaveStore } from '../../src/storage/api';
import { FORMAT_VERSION } from '../../src/storage/api';
import { compressJson } from '../../src/storage/files';
import { createSaveStore } from '../../src/storage';

const data = loadGameData();

const LONG_TEST_MS = 180000;

const SETTINGS: Settings = {
  mapType: 'coastal',
  mapSize: 'tiny',
  victoryMode: 'standard',
  populationLimit: 75,
  startingAge: 'stone',
  revealMap: false,
  lockTeams: false,
  speed: 'normal',
};

const PLAYERS: PlayerSetup[] = [
  { id: 0, kind: 'human', civilization: 'egyptian', team: null, color: 0x2f6fde, difficulty: null },
  { id: 1, kind: 'ai', civilization: 'greek', team: null, color: 0xd9412f, difficulty: 'hard' },
  { id: 2, kind: 'ai', civilization: 'shang', team: null, color: 0xe8c63a, difficulty: 'hardest' },
];

function advance(session: Session, ticks: number): void {
  for (let tick = 0; tick < ticks && session.state.outcome === null; tick++) {
    advanceSession(session);
  }
}

function snapshot(session: Session): string {
  return JSON.stringify(saveSession(session));
}

function playedSession(): Session {
  const session = startSession(SETTINGS, PLAYERS, 21, data, () => {});
  const villagers = Object.values(session.state.entities).filter(
    (entity) => entity.owner === 0 && entity.type === 'villager',
  );
  const tree = Object.values(session.state.entities).find((entity) => entity.type === 'tree');
  const center = Object.values(session.state.entities).find(
    (entity) => entity.owner === 0 && entity.type === 'town_center',
  );
  queueCommands(session, [
    {
      type: 'gather',
      playerId: 0,
      entityIds: villagers.map((villager) => villager.id),
      targetId: tree?.id ?? 0,
      queued: false,
    },
    { type: 'train', playerId: 0, buildingId: center?.id ?? 0, unit: 'villager', count: 2 },
  ]);
  advance(session, 7000);
  return session;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

function saveInput(game: SerializedGame): SaveInput {
  return {
    name: 'acceptance',
    summary: {
      mapType: game.state.settings.mapType,
      mapSize: game.state.settings.mapSize,
      civilization: game.state.players[0].civilization,
      gameTicks: game.state.tick,
    },
    state: game as unknown as JsonValue,
  };
}

function gameOf(record: SaveRecord): SerializedGame {
  return deserialize(record.state as unknown as SerializedGame);
}

describe('criterion 8: save, load, continue', { timeout: LONG_TEST_MS }, () => {
  let store: SaveStore;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    store = createSaveStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('restores a state identical to the saved one and continues identically', () => {
    const original = playedSession();
    expect(original.state.tick).toBe(7000);
    const saved = snapshot(original);
    const restored = createSession(deserialize(JSON.parse(saved) as SerializedGame), data, () => {});
    expect(snapshot(restored)).toBe(saved);

    advance(original, 4000);
    advance(restored, 4000);
    expect(restored.state.tick).toBe(original.state.tick);
    expect(snapshot(restored)).toBe(snapshot(original));
  });

  it('keeps the state through an IndexedDB slot', async () => {
    const original = playedSession();
    const saved = saveSession(original);
    const meta = unwrap(await store.save(saveInput(saved)));
    expect(meta.formatVersion).toBe(FORMAT_VERSION);
    expect(meta.summary.gameTicks).toBe(7000);
    const record = unwrap(await store.load(meta.id));
    expect(JSON.stringify(record.state)).toBe(JSON.stringify(saved));

    const restored = createSession(gameOf(record), data, () => {});
    advance(original, 3000);
    advance(restored, 3000);
    expect(snapshot(restored)).toBe(snapshot(original));
  });

  it('keeps the state through export to a file and import from it', async () => {
    const original = playedSession();
    const saved = saveSession(original);
    const meta = unwrap(await store.save(saveInput(saved)));
    const record = unwrap(await store.load(meta.id));
    const file = unwrap(await store.exportToFile(record));
    expect(file.size).toBeGreaterThan(0);
    expect(file.size).toBeLessThan(JSON.stringify(record).length);

    const imported = unwrap(await store.importFromFile(file));
    expect(imported).toEqual(record);
    expect(JSON.stringify(imported.state)).toBe(JSON.stringify(saved));

    const restored = createSession(gameOf(imported), data, () => {});
    advance(original, 3000);
    advance(restored, 3000);
    expect(snapshot(restored)).toBe(snapshot(original));
  });

  it('rejects incompatible and damaged files without throwing', async () => {
    const saved = saveSession(startSession(SETTINGS, PLAYERS, 21, data, () => {}));
    const meta = unwrap(await store.save(saveInput(saved)));
    const record = unwrap(await store.load(meta.id));
    const newer = new Blob([compressJson({ ...record, formatVersion: FORMAT_VERSION + 1 })]);
    expect(await store.importFromFile(newer)).toEqual({ ok: false, error: 'version_mismatch' });
    expect(await store.importFromFile(new Blob(['not a save']))).toEqual({ ok: false, error: 'corrupt' });
    expect(() => deserialize({ state: { tick: 1 } } as unknown as SerializedGame)).toThrow();
    expect(unwrap(await store.list())).toHaveLength(1);
  });
});
