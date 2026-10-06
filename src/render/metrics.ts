import type { AgeId, ArchitectureSet, BuildingDef, GameData, UnitDef } from '../data/types';
import { AGE_ORDER } from '../data/types';
import type { EntityKind } from '../sim/types';
import { DEPTH_LAYER } from './depth';
import type { DepthLayer } from './depth';
import { TILE_HALF_HEIGHT, TILE_HALF_WIDTH } from './projection';

export type UnitShape =
  | 'villager'
  | 'infantry'
  | 'archer'
  | 'mounted'
  | 'siege'
  | 'priest'
  | 'ship'
  | 'animal';

export type ResourceShape = 'tree' | 'bush' | 'rock' | 'fish' | 'carcass' | 'generic';

export interface EntityMetrics {
  halfWidth: number;
  height: number;
  footprint: number;
  layer: DepthLayer;
  pickPriority: number;
  ringRadius: number;
  barWidth: number;
  gaiaColor: number;
}

export const DEFAULT_ARCHITECTURE: ArchitectureSet = 'egyptian';

const UNIT_PIXELS_PER_RADIUS = 40;
const GAIA_UNIT_COLOR = 0xb89b6a;
const GAIA_OBJECT_COLOR = 0xd8cfae;
const ARTIFACT_COLOR = 0xe8c450;
const FALLBACK_COLOR = 0xb8b8a0;

const RESOURCE_COLORS: Record<ResourceShape, number> = {
  tree: 0x2f7d36,
  bush: 0xc2416b,
  rock: 0x9a9a9a,
  fish: 0x9fd8e8,
  carcass: 0x8a5a3a,
  generic: FALLBACK_COLOR,
};

const GOLD_COLOR = 0xe2b93b;

const WALL_HEIGHTS: Record<string, number> = {
  house: 26,
  tower: 72,
  wall: 22,
  wonder: 120,
  town_center: 50,
  temple: 48,
  farm: 0,
};

const DEFAULT_WALL_HEIGHT = 40;
const AGE_HEIGHT_GROWTH = 0.1;

export function ageIndex(age: AgeId): number {
  return Math.max(0, AGE_ORDER.indexOf(age));
}

export function unitShape(def: UnitDef): UnitShape {
  const classes = def.class;
  if (classes.includes('animal')) {
    return 'animal';
  }
  if (def.domain === 'water' || classes.includes('ship')) {
    return 'ship';
  }
  if (classes.includes('villager')) {
    return 'villager';
  }
  if (classes.includes('priest')) {
    return 'priest';
  }
  if (classes.includes('siege') || classes.includes('machine')) {
    return 'siege';
  }
  if (
    classes.includes('cavalry') ||
    classes.includes('mounted_archer') ||
    classes.includes('chariot') ||
    classes.includes('elephant') ||
    classes.includes('scout')
  ) {
    return 'mounted';
  }
  if (classes.includes('archer')) {
    return 'archer';
  }
  return 'infantry';
}

export function unitBodySize(def: UnitDef): { width: number; height: number } {
  const radius = def.radius * UNIT_PIXELS_PER_RADIUS;
  switch (unitShape(def)) {
    case 'villager':
      return { width: radius * 1.6, height: radius * 1.9 };
    case 'infantry':
      return { width: radius * 1.5, height: radius * 2.5 };
    case 'archer':
      return { width: radius * 1.9, height: radius * 2.4 };
    case 'priest':
      return { width: radius * 1.6, height: radius * 2.7 };
    case 'mounted':
      return { width: radius * 2.3, height: radius * 1.7 };
    case 'siege':
      return { width: radius * 1.7, height: radius * 1.3 };
    case 'ship':
      return { width: radius * 2, height: radius * 1.5 };
    case 'animal':
      return { width: radius * 2.2, height: radius * 1.3 };
  }
}

export function resourceShape(type: string, data: GameData): ResourceShape {
  const def = data.resourceSources[type];
  if (!def) {
    return 'generic';
  }
  switch (def.gatherKind) {
    case 'wood':
      return 'tree';
    case 'forage':
      return 'bush';
    case 'stone':
    case 'gold':
      return 'rock';
    case 'shore_fish':
    case 'boat_fish':
      return 'fish';
    case 'hunt':
      return 'carcass';
    default:
      return 'generic';
  }
}

export function buildingWallHeight(def: BuildingDef, age: AgeId): number {
  let base = DEFAULT_WALL_HEIGHT;
  for (const tag of def.class) {
    const height = WALL_HEIGHTS[tag];
    if (height !== undefined) {
      base = height;
      break;
    }
  }
  return base * (1 + AGE_HEIGHT_GROWTH * ageIndex(age));
}

export function isFlatBuilding(def: BuildingDef): boolean {
  return def.class.includes('farm');
}

function unitMetrics(def: UnitDef): EntityMetrics {
  const body = unitBodySize(def);
  return {
    halfWidth: Math.max(8, body.width / 2),
    height: Math.max(16, body.height),
    footprint: 0,
    layer: DEPTH_LAYER.upright,
    pickPriority: 2,
    ringRadius: Math.max(10, def.radius * UNIT_PIXELS_PER_RADIUS * 1.2),
    barWidth: Math.max(20, body.width),
    gaiaColor: GAIA_UNIT_COLOR,
  };
}

function buildingMetrics(def: BuildingDef): EntityMetrics {
  const flat = isFlatBuilding(def);
  const tower = def.class.includes('tower');
  return {
    halfWidth: def.size * TILE_HALF_WIDTH * (tower ? 0.5 : 0.8),
    height: flat ? 0 : buildingWallHeight(def, 'iron') + def.size * TILE_HALF_HEIGHT * 0.5,
    footprint: def.size,
    layer: flat ? DEPTH_LAYER.ground : DEPTH_LAYER.upright,
    pickPriority: 1,
    ringRadius: 0,
    barWidth: def.size * 24,
    gaiaColor: FALLBACK_COLOR,
  };
}

function resourceMetrics(type: string, data: GameData): EntityMetrics {
  const shape = resourceShape(type, data);
  const def = data.resourceSources[type];
  const tall = shape === 'tree';
  const flat = shape === 'fish' || shape === 'carcass';
  return {
    halfWidth: tall ? 12 : 14,
    height: tall ? 44 : flat ? 8 : 18,
    footprint: def?.size ?? 1,
    layer: flat ? DEPTH_LAYER.ground : DEPTH_LAYER.upright,
    pickPriority: 0,
    ringRadius: 0,
    barWidth: 24,
    gaiaColor: def?.resource === 'gold' ? GOLD_COLOR : RESOURCE_COLORS[shape],
  };
}

function objectMetrics(type: string, data: GameData): EntityMetrics {
  const def = data.mapObjects[type];
  const ruin = def?.kind === 'ruin';
  return {
    halfWidth: ruin ? 34 : 12,
    height: ruin ? 40 : 22,
    footprint: ruin ? (def?.size ?? 1) : 0,
    layer: DEPTH_LAYER.upright,
    pickPriority: 1,
    ringRadius: ruin ? 0 : 16,
    barWidth: 24,
    gaiaColor: ruin ? GAIA_OBJECT_COLOR : ARTIFACT_COLOR,
  };
}

const FALLBACK_METRICS: EntityMetrics = {
  halfWidth: 12,
  height: 24,
  footprint: 0,
  layer: DEPTH_LAYER.upright,
  pickPriority: 0,
  ringRadius: 12,
  barWidth: 24,
  gaiaColor: FALLBACK_COLOR,
};

export class MetricsCache {
  private readonly data: GameData;
  private readonly cache = new Map<string, EntityMetrics>();

  constructor(data: GameData) {
    this.data = data;
  }

  get(kind: EntityKind, type: string): EntityMetrics {
    const key = `${kind}:${type}`;
    let metrics = this.cache.get(key);
    if (!metrics) {
      metrics = this.compute(kind, type);
      this.cache.set(key, metrics);
    }
    return metrics;
  }

  private compute(kind: EntityKind, type: string): EntityMetrics {
    switch (kind) {
      case 'unit': {
        const def = this.data.units[type];
        return def ? unitMetrics(def) : FALLBACK_METRICS;
      }
      case 'building': {
        const def = this.data.buildings[type];
        return def ? buildingMetrics(def) : FALLBACK_METRICS;
      }
      case 'resource':
        return resourceMetrics(type, this.data);
      case 'object':
        return objectMetrics(type, this.data);
      default:
        return FALLBACK_METRICS;
    }
  }
}
