import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../data';
import type { GameData, MapSizeId, MapTypeDef, MapTypeId } from '../../data/types';
import { blocksTiles, entityFootprint, footprintOrigin } from '../../sim/core/entities';
import type { EntitySpec, PlayerSetup, Settings, VictoryMode } from '../../sim/types';
import { GAIA_PLAYER_ID, TERRAIN } from '../../sim/types';
import type { GeneratedMap } from '../api';
import { generateMap, renderAscii } from '../index';
import { PARAM_KEYS, readParams } from '../params';

const data: GameData = loadGameData();

const MAP_TYPES: MapTypeId[] = [
  'small_islands',
  'large_islands',
  'coastal',
  'inland',
  'highland',
  'sandbox',
];

const MAP_SIZES: MapSizeId[] = ['tiny', 'small', 'medium', 'large', 'huge'];

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8];

const GUARANTEED_KINDS = ['forage', 'wood', 'gold', 'stone'] as const;

const STEPS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

function settingsOf(mapType: MapTypeId, mapSize: MapSizeId, victoryMode: VictoryMode): Settings {
  return {
    mapType,
    mapSize,
    victoryMode,
    populationLimit: 50,
    startingAge: 'stone',
    revealMap: false,
    lockTeams: false,
    speed: 'normal',
  };
}

function playersOf(count: number, teams: (number | null)[] = []): PlayerSetup[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    kind: 'ai' as const,
    civilization: Object.keys(data.civilizations)[0],
    team: teams[id] ?? null,
    color: 0xffffff,
    difficulty: 'moderate' as const,
  }));
}

function seedOf(type: MapTypeId, size: MapSizeId, count: number): number {
  return MAP_TYPES.indexOf(type) * 1000 + MAP_SIZES.indexOf(size) * 100 + count;
}

interface Analysis {
  size: number;
  blocked: Uint8Array;
  overlaps: number;
}

function analyse(generated: GeneratedMap): Analysis {
  const size = generated.map.size;
  const blocked = new Uint8Array(size * size);
  let overlaps = 0;
  for (const spec of generated.entities) {
    if (!blocksTiles(spec, data)) {
      continue;
    }
    const footprint = entityFootprint(spec, data);
    const origin = footprintOrigin(spec.position, footprint);
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        const i = (origin.y + dy) * size + origin.x + dx;
        overlaps += blocked[i];
        blocked[i] = 1;
      }
    }
  }
  return { size, blocked, overlaps };
}

function tileOf(spec: EntitySpec, size: number): number {
  return Math.floor(spec.position.y) * size + Math.floor(spec.position.x);
}

function flood(generated: GeneratedMap, analysis: Analysis, from: number): Uint8Array {
  const { size, blocked } = analysis;
  const reached = new Uint8Array(size * size);
  const queue = [from];
  reached[from] = 1;
  while (queue.length > 0) {
    const i = queue.pop() as number;
    const x = i % size;
    const y = (i - x) / size;
    for (const [dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
        continue;
      }
      const j = ny * size + nx;
      if (reached[j] === 0 && blocked[j] === 0 && generated.map.terrain[j] !== TERRAIN.deepWater && generated.map.terrain[j] !== TERRAIN.cliff) {
        reached[j] = 1;
        queue.push(j);
      }
    }
  }
  return reached;
}

function touches(reached: Uint8Array, size: number, tile: number): boolean {
  const x = tile % size;
  const y = (tile - x) / size;
  return STEPS.some(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < size && ny < size && reached[ny * size + nx] === 1;
  });
}

function isWaterCode(code: number): boolean {
  return code === TERRAIN.deepWater || code === TERRAIN.shallows;
}

function entityProblems(generated: GeneratedMap, analysis: Analysis): string[] {
  const problems: string[] = [];
  const { size } = analysis;
  for (const spec of generated.entities) {
    const label = `${spec.type}@${spec.position.x},${spec.position.y}`;
    const footprint = Math.max(1, entityFootprint(spec, data));
    const origin = footprintOrigin(spec.position, footprint);
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        const x = origin.x + dx;
        const y = origin.y + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) {
          problems.push(`${label} out of bounds`);
          continue;
        }
        const code = generated.map.terrain[y * size + x];
        const source = spec.kind === 'resource' ? data.resourceSources[spec.type] : undefined;
        if (source?.domain === 'water') {
          if (!isWaterCode(code)) problems.push(`${label} water resource on land`);
        } else if (code === TERRAIN.deepWater) {
          problems.push(`${label} on deep water`);
        } else if (code === TERRAIN.shallows && spec.kind !== 'unit') {
          problems.push(`${label} static object on shallows`);
        }
      }
    }
    if (spec.kind === 'unit' && analysis.blocked[tileOf(spec, size)] === 1) {
      problems.push(`${label} unit on a blocked tile`);
    }
    if (spec.kind === 'resource' && !data.resourceSources[spec.type]) {
      problems.push(`${label} unknown resource`);
    }
    if (spec.kind === 'unit' && !data.units[spec.type]) problems.push(`${label} unknown unit`);
    if (spec.kind === 'object' && !data.mapObjects[spec.type]) problems.push(`${label} unknown object`);
  }
  return problems;
}

function slopeProblems(generated: GeneratedMap): string[] {
  const { size, elevation, terrain } = generated.map;
  const problems: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (isWaterCode(terrain[i]) && elevation[i] !== 0) problems.push(`water elevated at ${x},${y}`);
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= size || ny >= size) continue;
        if (Math.abs(elevation[i] - elevation[ny * size + nx]) > 1) {
          problems.push(`steep slope at ${x},${y}`);
        }
      }
    }
  }
  return problems;
}

function startProblems(
  generated: GeneratedMap,
  analysis: Analysis,
  players: readonly PlayerSetup[],
  def: MapTypeDef,
): string[] {
  const problems: string[] = [];
  const { size } = analysis;
  const start = data.game.start;
  const params = readParams(def);
  const floods: Uint8Array[] = [];
  const access: number[] = [];
  for (const player of players) {
    const owned = generated.entities.filter((spec) => spec.owner === player.id);
    const centers = owned.filter((spec) => spec.kind === 'building' && spec.type === start.building);
    const villagers = owned.filter((spec) => spec.kind === 'unit' && spec.type === start.unit);
    const position = generated.startPositions[player.id];
    if (centers.length !== 1) problems.push(`player ${player.id} has ${centers.length} start buildings`);
    if (villagers.length !== start.unitCount) {
      problems.push(`player ${player.id} has ${villagers.length} start units`);
    }
    if (owned.length !== centers.length + villagers.length) {
      problems.push(`player ${player.id} owns unexpected entities`);
    }
    if (!position || !centers[0] || !villagers[0]) {
      problems.push(`player ${player.id} has no start`);
      continue;
    }
    if (centers[0].position.x !== position.x || centers[0].position.y !== position.y) {
      problems.push(`player ${player.id} start position differs from the start building`);
    }
    const from = tileOf(villagers[0], size);
    const reached = flood(generated, analysis, from);
    floods.push(reached);
    access.push(from);
    for (const villager of villagers) {
      if (reached[tileOf(villager, size)] === 0) problems.push(`player ${player.id} villagers split`);
      if (Math.hypot(villager.position.x - position.x, villager.position.y - position.y) > 4) {
        problems.push(`player ${player.id} villager far from the start building`);
      }
    }
    const nearby = generated.entities.filter(
      (spec) =>
        spec.kind === 'resource' &&
        Math.hypot(spec.position.x - position.x, spec.position.y - position.y) <= def.startZoneRadius,
    );
    for (const kind of GUARANTEED_KINDS) {
      const usable = nearby.filter(
        (spec) =>
          data.resourceSources[spec.type].gatherKind === kind &&
          touches(reached, size, tileOf(spec, size)),
      );
      if (usable.length === 0) problems.push(`player ${player.id} lacks reachable ${kind}`);
    }
    let buildable = 0;
    let shore = false;
    for (let i = 0; i < size * size; i++) {
      if (reached[i] === 0) continue;
      const x = i % size;
      const distance = Math.hypot(x + 0.5 - position.x, (i - x) / size + 0.5 - position.y);
      const code = generated.map.terrain[i];
      if (distance <= def.startZoneRadius && !isWaterCode(code)) buildable++;
      if (distance <= params.shoreAccessDistance && code === TERRAIN.shore) shore = true;
    }
    if (buildable < params.minBuildableTiles) {
      problems.push(`player ${player.id} has only ${buildable} buildable tiles`);
    }
    if (def.layout !== 'land' && !shore) problems.push(`player ${player.id} has no shore access`);
  }
  for (let a = 0; a < floods.length; a++) {
    for (let b = a + 1; b < floods.length; b++) {
      const linked = floods[a][access[b]] === 1;
      if (def.layout === 'islands' && linked) problems.push(`starts ${a} and ${b} share an island`);
      if (def.layout !== 'islands' && !linked) problems.push(`starts ${a} and ${b} are disconnected`);
    }
  }
  const positions = players.map((player) => generated.startPositions[player.id]);
  for (let a = 0; a < positions.length; a++) {
    for (let b = a + 1; b < positions.length; b++) {
      const gap = Math.hypot(positions[a].x - positions[b].x, positions[a].y - positions[b].y);
      if (gap < size * 0.15) problems.push(`starts ${a} and ${b} are only ${gap.toFixed(1)} apart`);
    }
  }
  return problems;
}

function contentProblems(generated: GeneratedMap, def: MapTypeDef): string[] {
  const present = new Set(generated.entities.map((spec) => spec.type));
  const animals = Object.keys(def.areaAnimals).filter((id) => def.areaAnimals[id] > 0);
  const expected = [...animals, 'tree', 'berry_bush', 'gold_mine', 'stone_mine'];
  if (def.layout !== 'land') expected.push('shore_fish', 'deep_fish');
  const problems = expected.filter((id) => !present.has(id)).map((id) => `no ${id} on the map`);
  if (present.has('ruin') || present.has('artifact')) problems.push('relics in conquest mode');
  for (const spec of generated.entities) {
    if (spec.kind !== 'building' && spec.owner !== GAIA_PLAYER_ID && spec.type !== data.game.start.unit) {
      problems.push(`${spec.type} owned by a player`);
    }
  }
  return problems;
}

describe('map data', () => {
  it('declares the five sizes of the specification', () => {
    expect(data.maps.sizes.map((size) => [size.id, size.tiles])).toEqual([
      ['tiny', 72],
      ['small', 96],
      ['medium', 120],
      ['large', 144],
      ['huge', 200],
    ]);
  });

  it.each(MAP_TYPES)('%s has every tunable and resolvable ids', (type) => {
    const def = data.mapTypes[type];
    expect(Object.keys(readParams(def)).sort()).toEqual([...PARAM_KEYS].sort());
    const ids = [
      ...Object.keys(def.startResources),
      ...Object.keys(def.areaResources),
      ...Object.keys(def.areaAnimals),
    ];
    expect(ids.filter((id) => !data.resourceSources[id] && !data.units[id])).toEqual([]);
    expect(Object.keys(def.areaAnimals).filter((id) => !data.units[id]?.animal)).toEqual([]);
    expect(Object.keys(def.areaAnimals).sort()).toEqual(['alligator', 'elephant', 'gazelle', 'lion']);
  });
});

describe('determinism', () => {
  it.each(MAP_TYPES)('%s: same seed and settings give an identical map', (type) => {
    const settings = settingsOf(type, 'small', 'standard');
    const players = playersOf(4, [1, 1, 2, 2]);
    const first = generateMap(settings, players, 12345, data);
    const second = generateMap(settings, players, 12345, data);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const other = generateMap(settings, players, 12346, data);
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(first));
  });
});

describe.each(MAP_TYPES)('%s', (type) => {
  const def = data.mapTypes[type];

  describe.each(MAP_SIZES)('%s', (sizeId) => {
    it.each(PLAYER_COUNTS)('%i players: valid, fair and connected', (count) => {
      const players = playersOf(count);
      const generated = generateMap(
        settingsOf(type, sizeId, 'conquest'),
        players,
        seedOf(type, sizeId, count),
        data,
      );
      const size = data.mapSizes[sizeId].tiles;
      expect(generated.map.size).toBe(size);
      expect(generated.map.terrain).toHaveLength(size * size);
      expect(generated.map.elevation).toHaveLength(size * size);
      expect(generated.map.occupancy).toHaveLength(size * size);
      expect(generated.map.terrain.every((code) => code >= 0 && code <= TERRAIN.cliff)).toBe(true);
      const analysis = analyse(generated);
      expect(analysis.overlaps).toBe(0);
      expect(entityProblems(generated, analysis)).toEqual([]);
      expect(slopeProblems(generated)).toEqual([]);
      expect(startProblems(generated, analysis, players, def)).toEqual([]);
      expect(contentProblems(generated, def)).toEqual([]);
    });
  });

  it('generates a huge map within two seconds', () => {
    const settings = settingsOf(type, 'huge', 'standard');
    const players = playersOf(8);
    generateMap(settings, players, 1, data);
    const started = performance.now();
    generateMap(settings, players, 2, data);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('places ruins and artifacts only in standard victory mode', () => {
    const players = playersOf(4);
    const standard = generateMap(settingsOf(type, 'medium', 'standard'), players, 77, data);
    const count = (id: string): number => standard.entities.filter((spec) => spec.type === id).length;
    expect(count('ruin')).toBe(def.ruins);
    expect(count('artifact')).toBe(def.artifacts);
    const analysis = analyse(standard);
    expect(analysis.overlaps).toBe(0);
    expect(entityProblems(standard, analysis)).toEqual([]);
    expect(startProblems(standard, analysis, players, def)).toEqual([]);
    const conquest = generateMap(settingsOf(type, 'medium', 'conquest'), players, 77, data);
    expect(conquest.entities.some((spec) => spec.kind === 'object')).toBe(false);
  });

  it('gives every start the full resource set on an uncrowded map', () => {
    const players = playersOf(4);
    const generated = generateMap(settingsOf(type, 'medium', 'conquest'), players, 91, data);
    for (const player of players) {
      const position = generated.startPositions[player.id];
      for (const [id, amount] of Object.entries(def.startResources)) {
        if (data.resourceSources[id]?.domain !== 'land') continue;
        const found = generated.entities.filter(
          (spec) =>
            spec.type === id &&
            Math.hypot(spec.position.x - position.x, spec.position.y - position.y) <=
              def.startZoneRadius,
        );
        expect(found.length, `${id} for player ${player.id}`).toBeGreaterThanOrEqual(amount);
      }
    }
  });

  it('keeps teammates on neighbouring start positions', () => {
    const teams = [1, 2, 1, 2, 1, 2];
    const players = playersOf(6, teams);
    for (const seed of [3, 4, 5]) {
      const generated = generateMap(settingsOf(type, 'large', 'conquest'), players, seed, data);
      const half = generated.map.size / 2;
      const around = players
        .map((player) => {
          const position = generated.startPositions[player.id];
          return { team: player.team, angle: Math.atan2(position.y - half, position.x - half) };
        })
        .sort((a, b) => a.angle - b.angle);
      const switches = around.filter(
        (entry, index) => entry.team !== around[(index + 1) % around.length].team,
      );
      expect(switches).toHaveLength(2);
    }
  });

  it('matches the land profile of its type', () => {
    const generated = generateMap(settingsOf(type, 'medium', 'conquest'), playersOf(4), 5, data);
    const { terrain, elevation } = generated.map;
    const land = terrain.filter((code) => !isWaterCode(code)).length / terrain.length;
    expect(Math.abs(land - def.landRatio)).toBeLessThan(0.12);
    const highest = elevation.reduce((max, value) => Math.max(max, value), 0);
    expect(highest).toBeLessThanOrEqual(def.maxElevation);
    if (type === 'highland') {
      expect(highest).toBeGreaterThanOrEqual(5);
      expect(elevation.filter((value) => value >= 2).length / elevation.length).toBeGreaterThan(0.25);
    }
    if (type === 'inland') {
      expect(land).toBeGreaterThan(0.9);
    }
  });

  it('renders an ASCII dump', () => {
    const generated = generateMap(settingsOf(type, 'tiny', 'standard'), playersOf(4), 2024, data);
    const dump = renderAscii(generated, data);
    const rows = dump.split('\n');
    expect(rows).toHaveLength(generated.map.size);
    expect(rows.every((row) => row.length === generated.map.size)).toBe(true);
    expect(dump).toContain('T');
    if (process.env.MAPGEN_DUMP) {
      process.stdout.write(`\n${type}\n${dump}\n`);
    }
  });
});
