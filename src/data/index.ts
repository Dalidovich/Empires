import type { z } from 'zod';
import aiJson from './ai.json';
import buildingsJson from './buildings.json';
import civilizationsJson from './civilizations.json';
import gameJson from './game.json';
import mapsJson from './maps.json';
import resourcesJson from './resources.json';
import technologiesJson from './technologies.json';
import unitsJson from './units.json';
import {
  aiSchema,
  buildingsFileSchema,
  civilizationsFileSchema,
  gameRulesSchema,
  mapsSchema,
  resourcesSchema,
  technologiesFileSchema,
  unitsFileSchema,
} from './schema';
import type { GameData, RawGameData } from './types';

export * from './types';

export class GameDataError extends Error {
  readonly file: string;
  readonly issues: string[];

  constructor(file: string, issues: string[]) {
    super(`Invalid game data in ${file}: ${issues.join('; ')}`);
    this.name = 'GameDataError';
    this.file = file;
    this.issues = issues;
  }
}

function parseFile<T>(file: string, schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.map(String).join('.')}: ${issue.message}`,
    );
    throw new GameDataError(file, issues);
  }
  return result.data;
}

function indexById<T extends { id: string }>(file: string, records: T[]): Record<string, T> {
  const index: Record<string, T> = {};
  for (const record of records) {
    if (record.id in index) {
      throw new GameDataError(file, [`duplicate id ${record.id}`]);
    }
    index[record.id] = record;
  }
  return index;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export const RAW_GAME_DATA: RawGameData = {
  units: unitsJson,
  buildings: buildingsJson,
  technologies: technologiesJson,
  civilizations: civilizationsJson,
  resources: resourcesJson,
  maps: mapsJson,
  ai: aiJson,
  game: gameJson,
};

export function buildGameData(raw: RawGameData): GameData {
  const units = parseFile('units.json', unitsFileSchema, structuredClone(raw.units));
  const buildings = parseFile('buildings.json', buildingsFileSchema, structuredClone(raw.buildings));
  const technologies = parseFile(
    'technologies.json',
    technologiesFileSchema,
    structuredClone(raw.technologies),
  );
  const civilizations = parseFile(
    'civilizations.json',
    civilizationsFileSchema,
    structuredClone(raw.civilizations),
  );
  const resources = parseFile('resources.json', resourcesSchema, structuredClone(raw.resources));
  const maps = parseFile('maps.json', mapsSchema, structuredClone(raw.maps));
  const ai = parseFile('ai.json', aiSchema, structuredClone(raw.ai));
  const game = parseFile('game.json', gameRulesSchema, structuredClone(raw.game));

  const data: GameData = {
    units: indexById('units.json', units),
    buildings: indexById('buildings.json', buildings),
    technologies: indexById('technologies.json', technologies),
    civilizations: indexById('civilizations.json', civilizations),
    resources,
    resourceSources: indexById('resources.json', resources.sources),
    mapObjects: indexById('resources.json', resources.objects),
    maps,
    mapSizes: indexById('maps.json', maps.sizes) as GameData['mapSizes'],
    mapTypes: indexById('maps.json', maps.types) as GameData['mapTypes'],
    ai,
    aiLevels: indexById('ai.json', ai.levels) as GameData['aiLevels'],
    game,
  };
  return deepFreeze(data);
}

let cached: GameData | null = null;

export function loadGameData(): GameData {
  if (cached === null) {
    cached = buildGameData(RAW_GAME_DATA);
  }
  return cached;
}
