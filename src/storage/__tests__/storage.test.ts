import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { gzipSync, strToU8 } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '../../sim/types';
import type { AppSettings, NewGameSetup, SaveInput, SaveRecord, SaveStore } from '../api';
import {
  AUTOSAVE_ID,
  DEFAULT_APP_SETTINGS,
  FORMAT_VERSION,
  GAME_VERSION,
  SETTINGS_KEY,
} from '../api';
import { createSaveStore, createSettingsStore } from '../index';

function input(name: string, state: JsonValue = { tick: 1, entities: [1, 2, 3] }): SaveInput {
  return {
    name,
    summary: { mapType: 'inland', mapSize: 'tiny', civilization: 'greek', gameTicks: 1200 },
    state,
  };
}

function syntheticState(units: number): JsonValue {
  const entities: JsonValue[] = [];
  for (let id = 1; id <= units; id++) {
    entities.push({
      id,
      type: id % 3 === 0 ? 'villager' : 'clubman',
      owner: id % 8,
      position: { x: (id * 37) % 200 + 0.5, y: (id * 91) % 200 + 0.25 },
      hp: 40 + (id % 60),
      orders: [
        { type: 'move', target: { x: id % 200, y: (id * 7) % 200 }, queued: false },
        { type: 'gather', targetId: id + 5000, carried: id % 10 },
      ],
      path: Array.from({ length: 24 }, (_, step) => ({ x: (id + step) % 200, y: (id * 3 + step) % 200 })),
      cooldown: id % 17,
      stance: 'aggressive',
    });
  }
  const tiles = 200 * 200;
  return {
    tick: 54321,
    rngState: 123456789,
    entities,
    terrain: Array.from({ length: tiles }, (_, index) => (index * 7) % 6),
    occupancy: Array.from({ length: tiles }, (_, index) => (index % 25 === 0 ? index : 0)),
    fog: Array.from({ length: 8 }, (_, player) =>
      Array.from({ length: tiles }, (_, index) => (index + player) % 3),
    ),
  };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value;
}

describe('save store', () => {
  let clock: number;
  let store: SaveStore;

  beforeEach(() => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    clock = 1000;
    store = createSaveStore({ now: () => clock++ });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves, lists, loads, renames and deletes named slots', async () => {
    const first = unwrap(await store.save(input('first')));
    const second = unwrap(await store.save(input('second', { tick: 2 })));
    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      name: 'first',
      createdAt: 1000,
      formatVersion: FORMAT_VERSION,
      gameVersion: GAME_VERSION,
    });

    const listed = unwrap(await store.list());
    expect(listed.map((meta) => meta.name)).toEqual(['second', 'first']);
    expect(listed.every((meta) => !('state' in meta))).toBe(true);

    const loaded = unwrap(await store.load(first.id));
    expect(loaded).toEqual({ ...first, state: input('first').state });

    const renamed = unwrap(await store.rename(first.id, 'renamed'));
    expect(renamed).toEqual({ ...first, name: 'renamed' });
    expect(unwrap(await store.load(first.id)).state).toEqual(input('first').state);

    const overwritten = unwrap(await store.overwrite(second.id, input('second again', { tick: 9 })));
    expect(overwritten.id).toBe(second.id);
    expect(overwritten.createdAt).toBeGreaterThan(second.createdAt);
    expect(unwrap(await store.load(second.id)).state).toEqual({ tick: 9 });

    expect(await store.delete(first.id)).toEqual({ ok: true, value: undefined });
    expect(await store.load(first.id)).toEqual({ ok: false, error: 'not_found' });
    expect(unwrap(await store.list()).map((meta) => meta.id)).toEqual([second.id]);
  });

  it('reports missing slots', async () => {
    expect(await store.load('nope')).toEqual({ ok: false, error: 'not_found' });
    expect(await store.rename('nope', 'name')).toEqual({ ok: false, error: 'not_found' });
    expect(await store.overwrite('nope', input('name'))).toEqual({ ok: false, error: 'not_found' });
    expect(await store.loadAuto()).toEqual({ ok: false, error: 'not_found' });
    expect(unwrap(await store.list())).toEqual([]);
  });

  it('keeps saves across store instances', async () => {
    const saved = unwrap(await store.save(input('persistent')));
    const reopened = createSaveStore();
    expect(unwrap(await reopened.load(saved.id)).name).toBe('persistent');
  });

  it('overwrites the autosave slot and hides it from the list', async () => {
    unwrap(await store.saveAuto(input('auto', { tick: 1 })));
    const latest = unwrap(await store.saveAuto(input('auto', { tick: 2 })));
    expect(latest.id).toBe(AUTOSAVE_ID);
    expect(unwrap(await store.loadAuto()).state).toEqual({ tick: 2 });
    expect(unwrap(await store.list())).toEqual([]);
  });

  it('round-trips a save through an exported file', async () => {
    const saved = unwrap(await store.save(input('exported', syntheticState(20))));
    const record = unwrap(await store.load(saved.id));
    const file = unwrap(await store.exportToFile(record));
    expect(file.size).toBeLessThan(JSON.stringify(record).length);
    expect(unwrap(await store.importFromFile(file))).toEqual(record);
  });

  it('rejects corrupt files', async () => {
    const record = unwrap(await store.load(unwrap(await store.save(input('source'))).id));
    const pack = (value: unknown): Blob => new Blob([gzipSync(strToU8(JSON.stringify(value)))]);
    const { state: _state, ...withoutState } = record;
    const files = [
      new Blob(['not a save file']),
      new Blob([]),
      new Blob([JSON.stringify(record)]),
      new Blob([gzipSync(strToU8('{"broken'))]),
      pack(null),
      pack([record]),
      pack(withoutState),
      pack({ ...record, name: 5 }),
      pack({ ...record, formatVersion: 'one' }),
      pack({ ...record, summary: { ...record.summary, mapSize: 'gigantic' } }),
      pack({ ...record, extra: true }),
    ];
    for (const file of files) {
      expect(await store.importFromFile(file)).toEqual({ ok: false, error: 'corrupt' });
    }
    const truncated = unwrap(await store.exportToFile(record));
    expect(await store.importFromFile(truncated.slice(0, truncated.size - 12))).toEqual({
      ok: false,
      error: 'corrupt',
    });
  });

  it('rejects files and slots of another format version', async () => {
    const record = unwrap(await store.load(unwrap(await store.save(input('old'))).id));
    const outdated: SaveRecord = { ...record, formatVersion: FORMAT_VERSION + 1 };
    const file = unwrap(await store.exportToFile(outdated));
    expect(await store.importFromFile(file)).toEqual({ ok: false, error: 'version_mismatch' });

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('game-clone');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('saves', 'readwrite');
      transaction.objectStore('saves').put({ ...record, state: undefined, formatVersion: 99 });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    expect(await store.load(record.id)).toEqual({ ok: false, error: 'version_mismatch' });
  });

  it('reports an unavailable database while export and import keep working', async () => {
    const record = unwrap(await store.load(unwrap(await store.save(input('kept'))).id));
    vi.stubGlobal('indexedDB', undefined);
    const offline = createSaveStore();
    const unavailable = { ok: false, error: 'unavailable' };
    expect(await offline.list()).toEqual(unavailable);
    expect(await offline.save(input('lost'))).toEqual(unavailable);
    expect(await offline.saveAuto(input('lost'))).toEqual(unavailable);
    expect(await offline.load(record.id)).toEqual(unavailable);
    expect(await offline.loadAuto()).toEqual(unavailable);
    expect(await offline.rename(record.id, 'name')).toEqual(unavailable);
    expect(await offline.delete(record.id)).toEqual(unavailable);
    const file = unwrap(await offline.exportToFile(record));
    expect(unwrap(await offline.importFromFile(file))).toEqual(record);
  });

  it('reports a failing open request as unavailable and recovers afterwards', async () => {
    const factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
    const open = vi.spyOn(factory, 'open').mockImplementationOnce(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const flaky = createSaveStore();
    expect(await flaky.list()).toEqual({ ok: false, error: 'unavailable' });
    expect(unwrap(await flaky.save(input('after retry'))).name).toBe('after retry');
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('reports an exceeded quota and leaves existing saves intact', async () => {
    const kept = unwrap(await store.save(input('kept', { tick: 7 })));
    unwrap(await store.saveAuto(input('auto', { tick: 8 })));
    const original = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      calls += 1;
      if (calls % 2 === 0) {
        throw new DOMException('full', 'QuotaExceededError');
      }
      return original.apply(this, args);
    });
    const quota = { ok: false, error: 'quota_exceeded' };
    expect(await store.save(input('too big'))).toEqual(quota);
    expect(await store.overwrite(kept.id, input('replaced', { tick: 70 }))).toEqual(quota);
    expect(await store.saveAuto(input('auto', { tick: 80 }))).toEqual(quota);
    vi.restoreAllMocks();

    expect(unwrap(await store.list())).toEqual([kept]);
    expect(unwrap(await store.load(kept.id))).toEqual({ ...kept, state: { tick: 7 } });
    expect(unwrap(await store.loadAuto()).state).toEqual({ tick: 8 });
    expect(unwrap(await store.save(input('fits'))).name).toBe('fits');
  });

  it('saves and loads a state with 1600 units within three seconds', async () => {
    const state = syntheticState(1600);
    const started = performance.now();
    const saved = unwrap(await store.save(input('large', state)));
    const loaded = unwrap(await store.load(saved.id));
    const file = unwrap(await store.exportToFile(loaded));
    const imported = unwrap(await store.importFromFile(file));
    const elapsed = performance.now() - started;
    expect(imported.state).toEqual(state);
    expect(elapsed).toBeLessThan(3000);
  });
});

describe('settings store', () => {
  const setup: NewGameSetup = {
    settings: {
      mapType: 'coastal',
      mapSize: 'medium',
      victoryMode: 'standard',
      populationLimit: 50,
      startingAge: 'tool',
      revealMap: false,
      lockTeams: true,
      speed: 'fast',
    },
    seed: 42,
    players: [
      { id: 0, kind: 'human', civilization: 'greek', team: null, color: 0, difficulty: null },
      { id: 1, kind: 'ai', civilization: 'assyrian', team: 2, color: 1, difficulty: 'hard' },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('keeps the match options of a remembered setup', () => {
    const lastGameSetup: NewGameSetup = {
      ...setup,
      settings: { ...setup.settings, resourceLevel: 'high', startMode: 'nomad', fullTechTree: true },
    };
    createSettingsStore().save({ ...DEFAULT_APP_SETTINGS, lastGameSetup });
    expect(createSettingsStore().load().lastGameSetup).toEqual(lastGameSetup);
  });

  it('loads a remembered setup stored before the match options existed', () => {
    createSettingsStore().save({ ...DEFAULT_APP_SETTINGS, lastGameSetup: setup });
    const loaded = createSettingsStore().load().lastGameSetup;
    expect(loaded).toEqual(setup);
    expect(loaded?.settings.startMode).toBeUndefined();
  });

  it('drops an invalid match option without losing the remembered setup', () => {
    const stored = {
      ...DEFAULT_APP_SETTINGS,
      lastGameSetup: {
        ...setup,
        settings: { ...setup.settings, resourceLevel: 5, startMode: 'regicide', fullTechTree: 'yes' },
      },
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored));
    expect(createSettingsStore().load().lastGameSetup).toEqual(setup);
  });

  it('returns defaults when nothing is stored', () => {
    const loaded = createSettingsStore().load();
    expect(loaded).toEqual(DEFAULT_APP_SETTINGS);
    expect(loaded).not.toBe(DEFAULT_APP_SETTINGS);
  });

  it('persists settings under the settings key', () => {
    const settings: AppSettings = {
      language: 'ru',
      effectsVolume: 0.25,
      musicVolume: 0,
      muted: true,
      autosave: false,
      lastGameSetup: setup,
    };
    createSettingsStore().save(settings);
    expect(localStorage.getItem(SETTINGS_KEY)).not.toBeNull();
    expect(createSettingsStore().load()).toEqual(settings);
  });

  it('returns defaults for a corrupt value', () => {
    for (const raw of ['{not json', 'null', '[]', '"text"', '5']) {
      localStorage.setItem(SETTINGS_KEY, raw);
      expect(createSettingsStore().load()).toEqual(DEFAULT_APP_SETTINGS);
    }
  });

  it('replaces only the invalid fields with defaults', () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        language: 'ru',
        effectsVolume: 7,
        muted: 'yes',
        autosave: false,
        lastGameSetup: { ...setup, seed: 'abc' },
        unknown: 1,
      }),
    );
    expect(createSettingsStore().load()).toEqual({
      ...DEFAULT_APP_SETTINGS,
      language: 'ru',
      autosave: false,
    });
  });

  it('survives an unavailable localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const store = createSettingsStore();
    expect(store.load()).toEqual(DEFAULT_APP_SETTINGS);
    expect(() => store.save(DEFAULT_APP_SETTINGS)).not.toThrow();
  });
});
