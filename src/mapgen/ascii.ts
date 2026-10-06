import type { GameData } from '../data/types';
import type { EntitySpec } from '../sim/types';
import { GAIA_PLAYER_ID, TERRAIN } from '../sim/types';
import type { GeneratedMap } from './api';

const TERRAIN_GLYPHS: Record<number, string> = {
  [TERRAIN.grass]: '.',
  [TERRAIN.desert]: ',',
  [TERRAIN.forest]: '"',
  [TERRAIN.shallows]: '-',
  [TERRAIN.deepWater]: '~',
  [TERRAIN.shore]: '_',
  [TERRAIN.cliff]: '#',
};

const RESOURCE_GLYPHS: Record<string, string> = {
  wood: '^',
  gold: 'G',
  stone: 'S',
};

function glyphOf(spec: EntitySpec, data: GameData): string {
  switch (spec.kind) {
    case 'building':
      return 'T';
    case 'unit':
      if (spec.owner !== GAIA_PLAYER_ID) {
        return String(spec.owner % 10);
      }
      return data.units[spec.type]?.animal?.behavior === 'aggressive' ? 'x' : 'a';
    case 'resource': {
      const source = data.resourceSources[spec.type];
      if (!source) {
        return '?';
      }
      if (source.resource === 'food') {
        return source.domain === 'water' ? 'f' : 'b';
      }
      return RESOURCE_GLYPHS[source.resource] ?? '?';
    }
    default:
      return data.mapObjects[spec.type]?.kind === 'ruin' ? 'R' : 'A';
  }
}

function footprintOf(spec: EntitySpec, data: GameData): number {
  if (spec.kind === 'building') {
    return data.buildings[spec.type]?.size ?? 1;
  }
  if (spec.kind === 'object') {
    return data.mapObjects[spec.type]?.size ?? 1;
  }
  return 1;
}

export function renderAscii(generated: GeneratedMap, data: GameData): string {
  const { size, terrain } = generated.map;
  const rows: string[][] = [];
  for (let y = 0; y < size; y++) {
    const row: string[] = [];
    for (let x = 0; x < size; x++) {
      row.push(TERRAIN_GLYPHS[terrain[y * size + x]] ?? '?');
    }
    rows.push(row);
  }
  for (const spec of generated.entities) {
    const footprint = footprintOf(spec, data);
    const glyph = glyphOf(spec, data);
    const originX = Math.floor(spec.position.x - footprint / 2 + 0.5);
    const originY = Math.floor(spec.position.y - footprint / 2 + 0.5);
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        const row = rows[originY + dy];
        if (row && originX + dx >= 0 && originX + dx < size) {
          row[originX + dx] = glyph;
        }
      }
    }
  }
  return rows.map((row) => row.join('')).join('\n');
}
