import type { MapSizeId, MapTypeId } from '../data/types';
import type { JsonValue, PlayerSetup, Settings } from '../sim/types';

export const FORMAT_VERSION = 1;

export const GAME_VERSION = '0.1.0';

export const AUTOSAVE_ID = 'autosave';

export const SAVE_FILE_EXTENSION = '.aoesave';

export const SETTINGS_KEY = 'settings';

export const DATABASE_NAME = 'game-clone';

export const SAVES_STORE = 'saves';

export interface SaveSummary {
  mapType: MapTypeId;
  mapSize: MapSizeId;
  civilization: string;
  gameTicks: number;
}

export interface SaveMeta {
  id: string;
  name: string;
  createdAt: number;
  formatVersion: number;
  gameVersion: string;
  summary: SaveSummary;
}

export interface SaveRecord extends SaveMeta {
  state: JsonValue;
}

export interface SaveInput {
  name: string;
  summary: SaveSummary;
  state: JsonValue;
}

export type StorageErrorCode =
  | 'unavailable'
  | 'quota_exceeded'
  | 'not_found'
  | 'corrupt'
  | 'version_mismatch'
  | 'unknown';

export type StorageResult<T> = { ok: true; value: T } | { ok: false; error: StorageErrorCode };

export interface SaveStore {
  list(): Promise<StorageResult<SaveMeta[]>>;
  save(input: SaveInput): Promise<StorageResult<SaveMeta>>;
  overwrite(id: string, input: SaveInput): Promise<StorageResult<SaveMeta>>;
  load(id: string): Promise<StorageResult<SaveRecord>>;
  rename(id: string, name: string): Promise<StorageResult<SaveMeta>>;
  delete(id: string): Promise<StorageResult<void>>;
  saveAuto(input: SaveInput): Promise<StorageResult<SaveMeta>>;
  loadAuto(): Promise<StorageResult<SaveRecord>>;
  exportToFile(record: SaveRecord): Promise<StorageResult<Blob>>;
  importFromFile(file: Blob): Promise<StorageResult<SaveRecord>>;
}

export type Language = 'en' | 'ru';

export interface NewGameSetup {
  settings: Settings;
  seed: number;
  players: PlayerSetup[];
}

export interface AppSettings {
  language: Language;
  effectsVolume: number;
  musicVolume: number;
  muted: boolean;
  autosave: boolean;
  lastGameSetup: NewGameSetup | null;
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  language: 'en',
  effectsVolume: 0.8,
  musicVolume: 0.5,
  muted: false,
  autosave: true,
  lastGameSetup: null,
};

export interface SettingsStore {
  load(): AppSettings;
  save(settings: AppSettings): void;
}

export type CreateSaveStore = () => SaveStore;

export type CreateSettingsStore = () => SettingsStore;
