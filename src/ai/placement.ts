import type { BuildingDef } from '../data/types';
import type { EntityView } from '../sim/snapshot';
import type { TileCoord, Vec2 } from '../sim/types';
import { TERRAIN } from '../sim/types';
import type { Think } from './context';
import {
  canAfford,
  dist,
  gridOf,
  isIdle,
  isWaterTerrain,
  landRegionAt,
  markIntent,
  randomInt,
  regionsOf,
  retask,
  spend,
} from './context';
import { buildingStats, currentBuildingType } from './knowledge';

const EDGE_MARGIN = 1;
const MIN_OPEN_WATER = 20;
const DOCK_SEARCH_RADIUS = 34;
const SITE_CHOICES = 3;

export interface SiteOptions {
  anchor: Vec2;
  minRadius: number;
  maxRadius: number;
  gap: number;
  maxSolidRing: number;
}

function landSiteValid(
  think: Think,
  def: BuildingDef,
  originX: number,
  originY: number,
  options: SiteOptions,
  region: number,
): boolean {
  const size = think.size;
  const grid = gridOf(think);
  const terrain = think.view.map.terrain;
  const explored = think.view.fog.explored;
  const land = regionsOf(think).land;
  if (
    originX < EDGE_MARGIN ||
    originY < EDGE_MARGIN ||
    originX + def.size > size - EDGE_MARGIN ||
    originY + def.size > size - EDGE_MARGIN
  ) {
    return false;
  }
  let solidRing = 0;
  for (let dy = -options.gap; dy < def.size + options.gap; dy++) {
    for (let dx = -options.gap; dx < def.size + options.gap; dx++) {
      const x = originX + dx;
      const y = originY + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) {
        continue;
      }
      const tile = y * size + x;
      const inside = dx >= 0 && dy >= 0 && dx < def.size && dy < def.size;
      if (inside) {
        if (
          explored[tile] !== 1 ||
          grid.solid[tile] === 1 ||
          isWaterTerrain(terrain[tile]) ||
          land[tile] !== region
        ) {
          return false;
        }
      } else {
        if (grid.built[tile] === 1) {
          return false;
        }
        if (grid.solid[tile] === 1 || isWaterTerrain(terrain[tile])) {
          solidRing += 1;
        }
      }
    }
  }
  return solidRing <= options.maxSolidRing;
}

export function findLandSite(
  think: Think,
  buildingId: string,
  options: SiteOptions,
): TileCoord | null {
  const def = think.data.buildings[buildingId];
  const region = landRegionAt(think, think.home);
  if (!def || region === 0) {
    return null;
  }
  const baseX = Math.round(options.anchor.x - def.size / 2);
  const baseY = Math.round(options.anchor.y - def.size / 2);
  for (let radius = options.minRadius; radius <= options.maxRadius; radius++) {
    const found: { tile: TileCoord; distance: number }[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const x = baseX + dx;
        const y = baseY + dy;
        if (landSiteValid(think, def, x, y, options, region)) {
          found.push({ tile: { x, y }, distance: dx * dx + dy * dy });
        }
      }
    }
    if (found.length > 0) {
      found.sort((a, b) => a.distance - b.distance || a.tile.y - b.tile.y || a.tile.x - b.tile.x);
      return found[randomInt(think, 0, Math.min(SITE_CHOICES, found.length))].tile;
    }
  }
  return null;
}

function dockSiteScore(think: Think, def: BuildingDef, originX: number, originY: number): number {
  const size = think.size;
  const grid = gridOf(think);
  const terrain = think.view.map.terrain;
  const explored = think.view.fog.explored;
  const regions = regionsOf(think);
  const homeRegion = landRegionAt(think, think.home);
  let waterInside = 0;
  let shoreInside = 0;
  let landRing = false;
  let waterRing = 0;
  for (let dy = -1; dy <= def.size; dy++) {
    for (let dx = -1; dx <= def.size; dx++) {
      const x = originX + dx;
      const y = originY + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) {
        return -1;
      }
      const tile = y * size + x;
      const inside = dx >= 0 && dy >= 0 && dx < def.size && dy < def.size;
      const water = isWaterTerrain(terrain[tile]);
      if (explored[tile] !== 1) {
        return -1;
      }
      if (inside) {
        if (grid.solid[tile] === 1 || terrain[tile] === TERRAIN.cliff) {
          return -1;
        }
        if (water) {
          waterInside += 1;
        } else {
          shoreInside += 1;
        }
        continue;
      }
      if (grid.solid[tile] === 1) {
        continue;
      }
      if (water) {
        if (regions.waterSizes[regions.water[tile]] >= MIN_OPEN_WATER) {
          waterRing += 1;
        }
      } else if (regions.land[tile] === homeRegion) {
        landRing = true;
      }
    }
  }
  if (!landRing || waterRing < 2 || waterInside + waterRing < 4 || shoreInside === 0) {
    return -1;
  }
  return waterRing + waterInside;
}

export function findDockSite(think: Think, buildingId: string): TileCoord | null {
  const def = think.data.buildings[buildingId];
  if (!def || landRegionAt(think, think.home) === 0) {
    return null;
  }
  const homeX = Math.floor(think.home.x);
  const homeY = Math.floor(think.home.y);
  let best: TileCoord | null = null;
  let bestScore = -Infinity;
  for (let dy = -DOCK_SEARCH_RADIUS; dy <= DOCK_SEARCH_RADIUS; dy++) {
    for (let dx = -DOCK_SEARCH_RADIUS; dx <= DOCK_SEARCH_RADIUS; dx++) {
      const x = homeX + dx;
      const y = homeY + dy;
      if (x < 0 || y < 0 || x >= think.size || y >= think.size) {
        continue;
      }
      if (think.view.fog.explored[y * think.size + x] !== 1) {
        continue;
      }
      const water = dockSiteScore(think, def, x, y);
      if (water < 0) {
        continue;
      }
      const score = water * 0.5 - Math.sqrt(dx * dx + dy * dy);
      if (score > bestScore) {
        best = { x, y };
        bestScore = score;
      }
    }
  }
  return best;
}

function isBuilding(villager: EntityView): boolean {
  const order = villager.own?.orders[0];
  return order !== undefined && (order.type === 'build' || order.type === 'repair');
}

export function pickBuilders(think: Think, site: Vec2, count: number): EntityView[] {
  const candidates = think.villagers
    .filter(
      (villager) =>
        !isBuilding(villager) &&
        !think.busy.has(villager.id) &&
        villager.id !== think.state.scout.unitId,
    )
    .map((villager) => ({
      villager,
      cost: dist(villager.position, site) - (isIdle(villager) ? 6 : 0),
    }))
    .sort((a, b) => a.cost - b.cost || a.villager.id - b.villager.id);
  return candidates.slice(0, count).map((entry) => entry.villager);
}

export function placeBuilding(
  think: Think,
  buildingId: string,
  tile: TileCoord,
  builderCount: number,
  chosen: readonly EntityView[] | null = null,
): boolean {
  const type = currentBuildingType(think.know, buildingId);
  const stats = buildingStats(think.know, type);
  if (!stats || !canAfford(think, stats.cost)) {
    return false;
  }
  const center = { x: tile.x + stats.size / 2, y: tile.y + stats.size / 2 };
  const builders = chosen ?? pickBuilders(think, center, builderCount);
  if (builders.length === 0) {
    return false;
  }
  think.commands.push({
    type: 'placeBuilding',
    playerId: think.me,
    entityIds: builders.map((builder) => builder.id),
    building: type,
    tile,
    queued: false,
  });
  for (const builder of builders) {
    retask(think, builder.id);
  }
  spend(think, stats.cost);
  markIntent(think, type, tile.x, tile.y);
  return true;
}
