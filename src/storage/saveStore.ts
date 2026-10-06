import type { DBSchema, IDBPDatabase, IDBPTransaction } from 'idb';
import { openDB } from 'idb';
import type { SaveInput, SaveMeta, SaveRecord, SaveStore, StorageResult } from './api';
import { AUTOSAVE_ID, DATABASE_NAME, FORMAT_VERSION, GAME_VERSION, SAVES_STORE } from './api';
import { compressJson, decompressJson, exportSaveFile, importSaveFile } from './files';
import { fail, ok, toErrorCode, toMeta } from './result';

export const SAVE_STATES_STORE = 'save_states';

const DATABASE_VERSION = 1;

const STORES = [SAVES_STORE, SAVE_STATES_STORE] as const;

interface StoredState {
  id: string;
  data: Uint8Array;
}

interface SaveDatabase extends DBSchema {
  [SAVES_STORE]: { key: string; value: SaveMeta };
  [SAVE_STATES_STORE]: { key: string; value: StoredState };
}

type Database = IDBPDatabase<SaveDatabase>;

type Transaction<Mode extends IDBTransactionMode> = IDBPTransaction<SaveDatabase, typeof STORES, Mode>;

export interface SaveStoreOptions {
  now?: () => number;
}

function openDatabase(): Promise<Database> {
  if (typeof indexedDB === 'undefined' || indexedDB === null) {
    return Promise.reject(new Error('indexedDB is missing'));
  }
  return openDB<SaveDatabase>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(database) {
      for (const name of STORES) {
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: 'id' });
        }
      }
    },
  });
}

async function transact<Mode extends IDBTransactionMode, T>(
  database: Database,
  mode: Mode,
  action: (transaction: Transaction<Mode>) => Promise<T>,
): Promise<T> {
  const transaction = database.transaction(STORES, mode);
  const done = transaction.done;
  done.catch(() => undefined);
  let value: T;
  try {
    value = await action(transaction);
  } catch (error) {
    abortQuietly(transaction);
    throw error;
  }
  await done;
  return value;
}

function abortQuietly(transaction: { abort(): void }): void {
  try {
    transaction.abort();
  } catch {
    return;
  }
}

function createId(timestamp: number): string {
  return `save-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSaveStore(options: SaveStoreOptions = {}): SaveStore {
  const now = options.now ?? Date.now;
  let connection: Promise<Database> | null = null;

  function connect(): Promise<Database> {
    if (connection === null) {
      const opening = openDatabase();
      opening.catch(() => {
        if (connection === opening) {
          connection = null;
        }
      });
      connection = opening;
    }
    return connection;
  }

  async function run<T>(
    action: (database: Database) => Promise<StorageResult<T>>,
  ): Promise<StorageResult<T>> {
    let database: Database;
    try {
      database = await connect();
    } catch {
      return fail('unavailable');
    }
    try {
      return await action(database);
    } catch (error) {
      return fail(toErrorCode(error));
    }
  }

  function write(
    id: string | null,
    input: SaveInput,
    mustExist: boolean,
  ): Promise<StorageResult<SaveMeta>> {
    return run(async (database) => {
      const createdAt = now();
      const meta: SaveMeta = {
        id: id ?? createId(createdAt),
        name: input.name,
        createdAt,
        formatVersion: FORMAT_VERSION,
        gameVersion: GAME_VERSION,
        summary: { ...input.summary },
      };
      const data = compressJson(input.state);
      return transact(database, 'readwrite', async (transaction) => {
        const metas = transaction.objectStore(SAVES_STORE);
        if (mustExist && (await metas.getKey(meta.id)) === undefined) {
          return fail<SaveMeta>('not_found');
        }
        await metas.put(meta);
        await transaction.objectStore(SAVE_STATES_STORE).put({ id: meta.id, data });
        return ok(toMeta(meta));
      });
    });
  }

  function read(id: string): Promise<StorageResult<SaveRecord>> {
    return run(async (database) => {
      const [meta, stored] = await transact(database, 'readonly', async (transaction) => [
        await transaction.objectStore(SAVES_STORE).get(id),
        await transaction.objectStore(SAVE_STATES_STORE).get(id),
      ] as const);
      if (meta === undefined) {
        return fail('not_found');
      }
      if (meta.formatVersion !== FORMAT_VERSION) {
        return fail('version_mismatch');
      }
      if (stored === undefined) {
        return fail('corrupt');
      }
      try {
        const state = decompressJson(stored.data) as SaveRecord['state'];
        return ok({ ...toMeta(meta), state });
      } catch {
        return fail('corrupt');
      }
    });
  }

  return {
    list: () =>
      run(async (database) => {
        const metas = await database.getAll(SAVES_STORE);
        return ok(
          metas
            .filter((meta) => meta.id !== AUTOSAVE_ID)
            .map(toMeta)
            .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)),
        );
      }),
    save: (input) => write(null, input, false),
    overwrite: (id, input) => write(id, input, true),
    load: (id) => read(id),
    rename: (id, name) =>
      run((database) =>
        transact(database, 'readwrite', async (transaction) => {
          const metas = transaction.objectStore(SAVES_STORE);
          const meta = await metas.get(id);
          if (meta === undefined) {
            return fail<SaveMeta>('not_found');
          }
          const renamed: SaveMeta = { ...toMeta(meta), name };
          await metas.put(renamed);
          return ok(renamed);
        }),
      ),
    delete: (id) =>
      run((database) =>
        transact(database, 'readwrite', async (transaction) => {
          await transaction.objectStore(SAVES_STORE).delete(id);
          await transaction.objectStore(SAVE_STATES_STORE).delete(id);
          return ok(undefined);
        }),
      ),
    saveAuto: (input) => write(AUTOSAVE_ID, input, false),
    loadAuto: () => read(AUTOSAVE_ID),
    exportToFile: exportSaveFile,
    importFromFile: importSaveFile,
  };
}
