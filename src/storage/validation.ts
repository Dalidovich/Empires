import { z } from 'zod';
import {
  ageIdSchema,
  aiDifficultySchema,
  gameSpeedSchema,
  mapSizeIdSchema,
  mapTypeIdSchema,
} from '../data/schema';
import type { JsonValue } from '../sim/types';
import type { AppSettings, NewGameSetup, SaveMeta, SaveRecord, StorageResult } from './api';
import { DEFAULT_APP_SETTINGS, FORMAT_VERSION } from './api';
import { fail, ok } from './result';

const saveMetaSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  formatVersion: z.number().int(),
  gameVersion: z.string(),
  summary: z.strictObject({
    mapType: mapTypeIdSchema,
    mapSize: mapSizeIdSchema,
    civilization: z.string(),
    gameTicks: z.number().nonnegative(),
  }),
});

const newGameSetupSchema = z.object({
  settings: z.object({
    mapType: mapTypeIdSchema,
    mapSize: mapSizeIdSchema,
    victoryMode: z.enum(['conquest', 'standard']),
    populationLimit: z.number().int().positive(),
    startingAge: ageIdSchema,
    revealMap: z.boolean(),
    lockTeams: z.boolean(),
    speed: gameSpeedSchema,
    resourceLevel: z.string().optional().catch(undefined),
    startMode: z.enum(['standard', 'nomad', 'post_iron']).optional().catch(undefined),
    fullTechTree: z.boolean().optional().catch(undefined),
  }),
  seed: z.number().int(),
  players: z.array(
    z.object({
      id: z.number().int(),
      kind: z.enum(['human', 'ai']),
      civilization: z.string(),
      team: z.number().int().nullable(),
      color: z.number().int(),
      difficulty: aiDifficultySchema.nullable(),
    }),
  ),
});

const volumeSchema = z.number().min(0).max(1);

const appSettingsSchema = z.object({
  language: z.enum(['en', 'ru']).catch(DEFAULT_APP_SETTINGS.language),
  effectsVolume: volumeSchema.catch(DEFAULT_APP_SETTINGS.effectsVolume),
  musicVolume: volumeSchema.catch(DEFAULT_APP_SETTINGS.musicVolume),
  muted: z.boolean().catch(DEFAULT_APP_SETTINGS.muted),
  autosave: z.boolean().catch(DEFAULT_APP_SETTINGS.autosave),
  lastGameSetup: newGameSetupSchema.nullable().catch(DEFAULT_APP_SETTINGS.lastGameSetup),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSaveRecord(value: unknown): StorageResult<SaveRecord> {
  if (!isPlainObject(value)) {
    return fail('corrupt');
  }
  if (typeof value.formatVersion === 'number' && value.formatVersion !== FORMAT_VERSION) {
    return fail('version_mismatch');
  }
  const { state, ...rest } = value;
  const meta = saveMetaSchema.safeParse(rest);
  if (!meta.success || state === undefined) {
    return fail('corrupt');
  }
  const parsed: SaveMeta = meta.data;
  return ok({ ...parsed, state: state as JsonValue });
}

export function parseAppSettings(value: unknown): AppSettings {
  const settings = appSettingsSchema.safeParse(value);
  if (!settings.success) {
    return { ...DEFAULT_APP_SETTINGS };
  }
  const lastGameSetup: NewGameSetup | null = settings.data.lastGameSetup;
  return { ...settings.data, lastGameSetup };
}
