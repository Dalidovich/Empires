import type { Entity, EntityId, GameState, Vec2 } from '../types';

const CELL_SIZE = 2;

interface SpatialIndex {
  tick: number;
  columns: number;
  cells: EntityId[][];
  cellOf: Map<EntityId, number>;
}

const indexes = new WeakMap<GameState, SpatialIndex>();

function cellCoord(value: number, columns: number): number {
  const cell = Math.floor(value / CELL_SIZE);
  if (cell < 0) {
    return 0;
  }
  return cell >= columns ? columns - 1 : cell;
}

function cellAt(index: SpatialIndex, x: number, y: number): number {
  return cellCoord(y, index.columns) * index.columns + cellCoord(x, index.columns);
}

function insert(index: SpatialIndex, entity: Entity): void {
  const cell = cellAt(index, entity.position.x, entity.position.y);
  index.cells[cell].push(entity.id);
  index.cellOf.set(entity.id, cell);
}

function detach(index: SpatialIndex, id: EntityId): void {
  const cell = index.cellOf.get(id);
  if (cell === undefined) {
    return;
  }
  const ids = index.cells[cell];
  const position = ids.indexOf(id);
  if (position >= 0) {
    ids.splice(position, 1);
  }
  index.cellOf.delete(id);
}

function build(state: GameState): SpatialIndex {
  const columns = Math.max(1, Math.ceil(state.map.size / CELL_SIZE));
  const cells: EntityId[][] = new Array<EntityId[]>(columns * columns);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = [];
  }
  const index: SpatialIndex = { tick: state.tick, columns, cells, cellOf: new Map() };
  for (const entity of Object.values(state.entities)) {
    if (entity.carriedBy === null) {
      insert(index, entity);
    }
  }
  return index;
}

function currentIndex(state: GameState): SpatialIndex {
  let index = indexes.get(state);
  if (!index || index.tick !== state.tick) {
    index = build(state);
    indexes.set(state, index);
  }
  return index;
}

function liveIndex(state: GameState): SpatialIndex | null {
  const index = indexes.get(state);
  return index && index.tick === state.tick ? index : null;
}

export function invalidateSpatialIndex(state: GameState): void {
  indexes.delete(state);
}

export function indexEntity(state: GameState, entity: Entity): void {
  const index = liveIndex(state);
  if (!index) {
    return;
  }
  detach(index, entity.id);
  if (entity.carriedBy === null) {
    insert(index, entity);
  }
}

export function unindexEntity(state: GameState, id: EntityId): void {
  const index = liveIndex(state);
  if (index) {
    detach(index, id);
  }
}

export function setEntityPosition(state: GameState, entity: Entity, x: number, y: number): void {
  entity.position.x = x;
  entity.position.y = y;
  const index = liveIndex(state);
  if (!index || entity.carriedBy !== null) {
    return;
  }
  const cell = cellAt(index, x, y);
  if (index.cellOf.get(entity.id) !== cell) {
    detach(index, entity.id);
    index.cells[cell].push(entity.id);
    index.cellOf.set(entity.id, cell);
  }
}

export function forEachEntityNear(
  state: GameState,
  x: number,
  y: number,
  radius: number,
  visit: (entity: Entity) => void,
): void {
  const index = currentIndex(state);
  const minX = cellCoord(x - radius, index.columns);
  const maxX = cellCoord(x + radius, index.columns);
  const minY = cellCoord(y - radius, index.columns);
  const maxY = cellCoord(y + radius, index.columns);
  const radiusSq = radius * radius;
  for (let cy = minY; cy <= maxY; cy++) {
    for (let cx = minX; cx <= maxX; cx++) {
      const ids = index.cells[cy * index.columns + cx];
      for (let i = 0; i < ids.length; i++) {
        const entity = state.entities[ids[i]];
        if (!entity) {
          continue;
        }
        const dx = entity.position.x - x;
        const dy = entity.position.y - y;
        if (dx * dx + dy * dy <= radiusSq) {
          visit(entity);
        }
      }
    }
  }
}

export function entitiesInRadius(
  state: GameState,
  center: Vec2,
  radius: number,
  predicate?: (entity: Entity) => boolean,
): Entity[] {
  const found: Entity[] = [];
  forEachEntityNear(state, center.x, center.y, radius, (entity) => {
    if (!predicate || predicate(entity)) {
      found.push(entity);
    }
  });
  return found.sort((a, b) => a.id - b.id);
}

export function nearestEntity(
  state: GameState,
  center: Vec2,
  maxRadius: number,
  predicate: (entity: Entity) => boolean,
): Entity | null {
  const index = currentIndex(state);
  const originX = cellCoord(center.x, index.columns);
  const originY = cellCoord(center.y, index.columns);
  const maxRing = Math.ceil(maxRadius / CELL_SIZE) + 1;
  const maxSq = maxRadius * maxRadius;
  let best: Entity | null = null;
  let bestSq = Infinity;

  const scan = (cx: number, cy: number): void => {
    if (cx < 0 || cy < 0 || cx >= index.columns || cy >= index.columns) {
      return;
    }
    const ids = index.cells[cy * index.columns + cx];
    for (let i = 0; i < ids.length; i++) {
      const entity = state.entities[ids[i]];
      if (!entity) {
        continue;
      }
      const dx = entity.position.x - center.x;
      const dy = entity.position.y - center.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > maxSq || distSq > bestSq) {
        continue;
      }
      if (distSq === bestSq && best !== null && best.id < entity.id) {
        continue;
      }
      if (predicate(entity)) {
        best = entity;
        bestSq = distSq;
      }
    }
  };

  for (let ring = 0; ring <= maxRing; ring++) {
    if (ring === 0) {
      scan(originX, originY);
    } else {
      for (let offset = -ring; offset <= ring; offset++) {
        scan(originX + offset, originY - ring);
        scan(originX + offset, originY + ring);
      }
      for (let offset = -ring + 1; offset <= ring - 1; offset++) {
        scan(originX - ring, originY + offset);
        scan(originX + ring, originY + offset);
      }
    }
    const reach = ring * CELL_SIZE;
    if (best !== null && bestSq <= reach * reach) {
      break;
    }
  }
  return best;
}
