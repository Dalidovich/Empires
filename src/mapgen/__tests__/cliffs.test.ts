import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../data';
import type { MapSizeId, MapTypeId } from '../../data/types';
import { entityFootprint, footprintOrigin } from '../../sim/core/entities';
import type { PlayerSetup, Settings } from '../../sim/types';
import { TERRAIN } from '../../sim/types';
import { generateMap, renderAscii } from '../index';

const data = loadGameData();

const SIZES: MapSizeId[] = ['tiny', 'small', 'medium', 'large', 'huge'];

const SEEDS = [1, 2, 3];

function settingsOf(mapType: MapTypeId, mapSize: MapSizeId): Settings {
  return {
    mapType,
    mapSize,
    victoryMode: 'standard',
    populationLimit: 50,
    startingAge: 'stone',
    revealMap: false,
    lockTeams: false,
    speed: 'normal',
  };
}

function playersOf(count: number): PlayerSetup[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    kind: 'ai' as const,
    civilization: Object.keys(data.civilizations)[0],
    team: null,
    color: 0xffffff,
    difficulty: 'moderate' as const,
  }));
}

function cliffCount(terrain: readonly number[]): number {
  return terrain.filter((code) => code === TERRAIN.cliff).length;
}

function landComponents(terrain: readonly number[], size: number): number {
  const seen = new Uint8Array(terrain.length);
  let components = 0;
  for (let from = 0; from < terrain.length; from++) {
    const walkable = terrain[from] !== TERRAIN.deepWater && terrain[from] !== TERRAIN.cliff;
    if (!walkable || seen[from] === 1) {
      continue;
    }
    components++;
    const stack = [from];
    seen[from] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const x = i % size;
      const y = (i - x) / size;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
          continue;
        }
        const j = ny * size + nx;
        const open = terrain[j] !== TERRAIN.deepWater && terrain[j] !== TERRAIN.cliff;
        if (open && seen[j] === 0) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return components;
}

describe('cliffs', () => {
  it('are generated deterministically', () => {
    const settings = settingsOf('highland', 'small');
    const first = generateMap(settings, playersOf(4), 77, data);
    const second = generateMap(settings, playersOf(4), 77, data);
    expect(cliffCount(first.map.terrain)).toBeGreaterThan(0);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('are densest on highland and absent on small islands', () => {
    const count = (type: MapTypeId): number =>
      cliffCount(generateMap(settingsOf(type, 'medium'), playersOf(4), 5, data).map.terrain);
    expect(count('highland')).toBeGreaterThan(count('inland'));
    expect(count('inland')).toBeGreaterThan(0);
    expect(count('coastal')).toBeGreaterThan(0);
    expect(count('small_islands')).toBe(0);
  });

  it.each(['inland', 'highland'] as MapTypeId[])('%s: keep starts clear and land connected', (type) => {
    for (const sizeId of SIZES) {
      for (const seed of SEEDS) {
        const players = playersOf(sizeId === 'tiny' ? 3 : 6);
        const generated = generateMap(settingsOf(type, sizeId), players, seed, data);
        const { terrain, size } = generated.map;
        const zone = data.mapTypes[type].startZoneRadius;
        for (const position of Object.values(generated.startPositions)) {
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (Math.hypot(x + 0.5 - position.x, y + 0.5 - position.y) <= zone / 2) {
                expect(terrain[y * size + x]).not.toBe(TERRAIN.cliff);
              }
            }
          }
        }
        const clean = generated.map.terrain.map((code) => (code === TERRAIN.cliff ? TERRAIN.grass : code));
        expect(landComponents(terrain, size)).toBeLessThanOrEqual(landComponents(clean, size));
        for (const spec of generated.entities) {
          const footprint = Math.max(1, entityFootprint(spec, data));
          const origin = footprintOrigin(spec.position, footprint);
          for (let dy = 0; dy < footprint; dy++) {
            for (let dx = 0; dx < footprint; dx++) {
              expect(terrain[(origin.y + dy) * size + origin.x + dx]).not.toBe(TERRAIN.cliff);
            }
          }
        }
      }
    }
  }, 120000);

  it('show up in the ASCII dump', () => {
    const generated = generateMap(settingsOf('highland', 'tiny'), playersOf(2), 9, data);
    expect(renderAscii(generated, data)).toContain('#');
  });
});
