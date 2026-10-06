import type {
  AppSettings,
  SaveInput,
  SaveMeta,
  SaveRecord,
  SaveStore,
  SettingsStore,
  StorageResult,
} from './api';
import { AUTOSAVE_ID, DEFAULT_APP_SETTINGS, FORMAT_VERSION, GAME_VERSION } from './api';
import { exportSaveFile, importSaveFile } from './files';
import { fail, ok, toMeta } from './result';

export function createMemorySaveStore(): SaveStore {
  const records = new Map<string, SaveRecord>();
  let nextId = 1;

  function put(id: string, input: SaveInput): StorageResult<SaveMeta> {
    const record: SaveRecord = {
      id,
      name: input.name,
      createdAt: Date.now(),
      formatVersion: FORMAT_VERSION,
      gameVersion: GAME_VERSION,
      summary: input.summary,
      state: input.state,
    };
    records.set(id, record);
    return ok(toMeta(record));
  }

  function get(id: string): StorageResult<SaveRecord> {
    const record = records.get(id);
    return record ? ok(record) : fail('not_found');
  }

  return {
    list: async () =>
      ok(
        [...records.values()]
          .filter((record) => record.id !== AUTOSAVE_ID)
          .map(toMeta)
          .sort((a, b) => b.createdAt - a.createdAt),
      ),
    save: async (input) => {
      const id = `save-${nextId}`;
      nextId += 1;
      return put(id, input);
    },
    overwrite: async (id, input) => (records.has(id) ? put(id, input) : fail('not_found')),
    load: async (id) => get(id),
    rename: async (id, name) => {
      const record = records.get(id);
      if (!record) {
        return fail('not_found');
      }
      record.name = name;
      return ok(toMeta(record));
    },
    delete: async (id) => {
      records.delete(id);
      return ok(undefined);
    },
    saveAuto: async (input) => put(AUTOSAVE_ID, input),
    loadAuto: async () => get(AUTOSAVE_ID),
    exportToFile: exportSaveFile,
    importFromFile: importSaveFile,
  };
}

export function createMemorySettingsStore(): SettingsStore {
  let current: AppSettings = { ...DEFAULT_APP_SETTINGS };
  return {
    load: () => ({ ...current }),
    save: (settings) => {
      current = { ...settings };
    },
  };
}
