import type { MapSizeId, MapTypeDef } from '../data/types';

export const PARAM_KEYS = [
  'startRingRatio',
  'startEdgeMargin',
  'startClearRadius',
  'minStartZoneRadius',
  'startForestClumps',
  'minBuildableTiles',
  'coastOffset',
  'coastNoise',
  'edgeWater',
  'shoreAccessDistance',
  'channelWidth',
  'minIslandRadius',
  'maxIslandRadius',
  'extraIslandMinRadius',
  'extraIslandMaxRadius',
  'islandRoughness',
  'terrainNoiseScale',
  'forestNoiseScale',
  'elevationNoiseScale',
  'elevationFloor',
  'shallowsRatio',
  'predatorMargin',
  'objectMargin',
] as const;

export type ParamKey = (typeof PARAM_KEYS)[number];

export type MapParams = Record<ParamKey, number>;

export const CLUSTER_PREFIX = 'cluster_';

export const WATERSIDE_PREFIX = 'waterside_';

export function readParams(def: MapTypeDef): MapParams {
  const params = {} as MapParams;
  for (const key of PARAM_KEYS) {
    const value = def.params[key];
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`Map type ${def.id} is missing parameter ${key}`);
    }
    params[key] = value;
  }
  return params;
}

export function optionalParam(def: MapTypeDef, key: string, fallback: number): number {
  const value = def.params[key];
  return typeof value === 'number' ? value : fallback;
}

export function sizeScale(def: MapTypeDef, size: MapSizeId): number {
  return def.sizeScale[size] ?? 1;
}
