import type { GameData, MovementDomain } from '../../data/types';
import { inRange } from '../core/geometry';
import type { NavState } from '../core/movement';
import { navOf } from '../core/movement';
import { domainOf, getNavGrid, passability } from '../core/navgrid';
import { computePath, pathCostEstimate, pathFieldKey } from '../core/pathfinding';
import { forEachEntityNear, setEntityPosition } from '../core/spatial';
import { getUnitStats } from '../stats';
import type { StepContext, System } from '../system';
import type { Entity, GameState } from '../types';
import { revealHiddenIdle } from './idleReveal';

const PATH_COST_BUDGET = 80000;
const PATH_REQUEST_LIMIT = 400;
const STALL_LIMIT = 15;
const STALL_SHARE = 0.25;
const REPATH_LIMIT = 3;
const PUSH_SHARE = 0.6;
const IDLE_SPREAD_INTERVAL = 4;
const IDLE_OVERLAP_SHARE = 0.6;
const IDLE_STEP_SHARE = 0.5;
const IDLE_PUSH_MINIMUM = 0.01;
const LARGEST_RADIUS = 1;
const DEFAULT_RADIUS = 0.3;
const GOLDEN_ANGLE = 2.399963229728653;

interface Push {
  x: number;
  y: number;
}

interface Mover {
  state: GameState;
  data: GameData;
  speeds: Map<string, number>;
  land: Uint8Array;
  water: Uint8Array;
  size: number;
  push: Push;
}

function speedOf(mover: Mover, entity: Entity): number {
  const owner = entity.statsOwner ?? entity.owner;
  const key = `${entity.kind}:${owner}:${entity.type}`;
  let speed = mover.speeds.get(key);
  if (speed === undefined) {
    if (entity.kind === 'unit' && mover.data.units[entity.type]) {
      speed = getUnitStats(mover.state, owner, entity.type, mover.data).speed;
    } else if (entity.kind === 'object') {
      speed = mover.data.mapObjects[entity.type]?.speed ?? 0;
    } else {
      speed = 0;
    }
    mover.speeds.set(key, speed);
  }
  return speed;
}

function radiusOf(data: GameData, entity: Entity): number {
  return data.units[entity.type]?.radius ?? DEFAULT_RADIUS;
}

function open(mover: Mover, domain: MovementDomain, x: number, y: number): boolean {
  const tileX = Math.floor(x);
  const tileY = Math.floor(y);
  if (tileX < 0 || tileY < 0 || tileX >= mover.size || tileY >= mover.size) {
    return false;
  }
  const pass = domain === 'water' ? mover.water : mover.land;
  return pass[tileY * mover.size + tileX] === 1;
}

function separation(
  mover: Mover,
  entity: Entity,
  domain: MovementDomain,
  x: number,
  y: number,
  overlapShare: number,
): Push {
  const push = mover.push;
  push.x = 0;
  push.y = 0;
  const radius = radiusOf(mover.data, entity);
  forEachEntityNear(mover.state, x, y, radius + LARGEST_RADIUS, (other) => {
    if (other.id === entity.id || other.kind !== 'unit') {
      return;
    }
    if (domainOf(other, mover.data) !== domain) {
      return;
    }
    const reach = (radius + radiusOf(mover.data, other)) * overlapShare;
    const dx = x - other.position.x;
    const dy = y - other.position.y;
    const distSq = dx * dx + dy * dy;
    if (distSq >= reach * reach) {
      return;
    }
    if (distSq < 1e-8) {
      const angle = Math.min(entity.id, other.id) * GOLDEN_ANGLE;
      const side = entity.id < other.id ? 0.5 : -0.5;
      push.x += Math.cos(angle) * reach * side;
      push.y += Math.sin(angle) * reach * side;
      return;
    }
    const dist = Math.sqrt(distSq);
    const overlap = (reach - dist) * 0.5;
    push.x += (dx / dist) * overlap;
    push.y += (dy / dist) * overlap;
  });
  return push;
}

function limit(push: Push, max: number): void {
  const length = Math.hypot(push.x, push.y);
  if (length > max && length > 0) {
    push.x = (push.x / length) * max;
    push.y = (push.y / length) * max;
  }
}

function finish(entity: Entity, nav: NavState): void {
  nav.status = 'done';
  entity.path = null;
}

function advance(mover: Mover, entity: Entity, nav: NavState): void {
  const { state, data } = mover;
  const path = entity.path;
  if (!path || path.length === 0) {
    finish(entity, nav);
    return;
  }
  if (nav.targetId !== null) {
    const target = state.entities[nav.targetId];
    if (!target || inRange(entity, target, nav.range, data)) {
      finish(entity, nav);
      return;
    }
  }
  const step = speedOf(mover, entity) / data.game.tickRate;
  if (step <= 0) {
    finish(entity, nav);
    return;
  }
  const domain = domainOf(entity, data);
  const fromX = entity.position.x;
  const fromY = entity.position.y;
  let x = fromX;
  let y = fromY;
  let remaining = step;
  while (remaining > 0 && path.length > 0) {
    const waypoint = path[0];
    const dx = waypoint.x - x;
    const dy = waypoint.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist <= remaining) {
      x = waypoint.x;
      y = waypoint.y;
      remaining -= dist;
      path.shift();
    } else {
      x += (dx / dist) * remaining;
      y += (dy / dist) * remaining;
      remaining = 0;
    }
  }

  const push = separation(mover, entity, domain, x, y, 1);
  limit(push, step * PUSH_SHARE);
  let nextX = x + push.x;
  let nextY = y + push.y;
  const trapped = !open(mover, domain, fromX, fromY);
  if (trapped || !open(mover, domain, nextX, nextY)) {
    nextX = x;
    nextY = y;
  }
  if (!trapped && !open(mover, domain, nextX, nextY)) {
    if (open(mover, domain, x, fromY)) {
      nextX = x;
      nextY = fromY;
    } else if (open(mover, domain, fromX, y)) {
      nextX = fromX;
      nextY = y;
    } else {
      nextX = fromX;
      nextY = fromY;
    }
  }

  const movedX = nextX - fromX;
  const movedY = nextY - fromY;
  const moved = Math.hypot(movedX, movedY);
  if (moved > 0) {
    entity.facing = Math.atan2(movedY, movedX);
    setEntityPosition(state, entity, nextX, nextY);
  }

  if (path.length === 0) {
    finish(entity, nav);
    return;
  }
  if (moved < step * STALL_SHARE) {
    nav.stall += 1;
    if (nav.stall >= STALL_LIMIT) {
      nav.stall = 0;
      nav.repaths += 1;
      if (nav.repaths > REPATH_LIMIT) {
        finish(entity, nav);
      } else {
        nav.status = 'pending';
        nav.requested = state.tick;
        entity.path = null;
      }
    }
  } else {
    nav.stall = 0;
  }
}

function resolvePending(mover: Mover, pending: Entity[]): void {
  const { state, data } = mover;
  pending.sort((a, b) => {
    const first = navOf(a) as NavState;
    const second = navOf(b) as NavState;
    return first.requested - second.requested || a.id - b.id;
  });
  const charged = new Map<number, number>();
  let spent = 0;
  let served = 0;
  for (const entity of pending) {
    if (served >= PATH_REQUEST_LIMIT) {
      break;
    }
    const nav = navOf(entity) as NavState;
    const domain = domainOf(entity, data);
    const hub = nav.via ?? nav.goal;
    const key = pathFieldKey(state, domain, hub);
    const estimate = pathCostEstimate(state, entity.position, hub);
    const cost = Math.max(0, estimate - (charged.get(key) ?? 0));
    if (served > 0 && spent + cost > PATH_COST_BUDGET) {
      continue;
    }
    spent += cost;
    served += 1;
    charged.set(key, Math.max(estimate, charged.get(key) ?? 0));
    const path = computePath(state, data, domain, entity.position, nav.goal, nav.via);
    if (path.length === 0) {
      finish(entity, nav);
    } else {
      entity.path = path;
      nav.status = 'moving';
    }
  }
}

function spreadIdle(mover: Mover, entity: Entity): void {
  const { state, data } = mover;
  const domain = domainOf(entity, data);
  const push = separation(
    mover,
    entity,
    domain,
    entity.position.x,
    entity.position.y,
    IDLE_OVERLAP_SHARE,
  );
  if (Math.hypot(push.x, push.y) < IDLE_PUSH_MINIMUM) {
    return;
  }
  limit(push, (speedOf(mover, entity) / data.game.tickRate) * IDLE_STEP_SHARE);
  const x = entity.position.x + push.x;
  const y = entity.position.y + push.y;
  if (open(mover, domain, x, y)) {
    setEntityPosition(state, entity, x, y);
  }
}

function update(state: GameState, ctx: StepContext): void {
  const grid = getNavGrid(state, ctx.data);
  const mover: Mover = {
    state,
    data: ctx.data,
    speeds: new Map(),
    land: passability(grid, 'land'),
    water: passability(grid, 'water'),
    size: grid.size,
    push: { x: 0, y: 0 },
  };
  const active: Entity[] = [];
  const pending: Entity[] = [];
  const idle: Entity[] = [];
  for (const entity of Object.values(state.entities)) {
    if (entity.carriedBy !== null || (entity.kind !== 'unit' && entity.kind !== 'object')) {
      continue;
    }
    const nav = navOf(entity);
    if (nav && nav.status !== 'done') {
      active.push(entity);
      if (nav.status === 'pending') {
        pending.push(entity);
      }
    } else if (
      entity.kind === 'unit' &&
      entity.state === 'idle' &&
      entity.orders.length === 0 &&
      (state.tick + entity.id) % IDLE_SPREAD_INTERVAL === 0
    ) {
      idle.push(entity);
    }
  }
  if (pending.length > 0) {
    resolvePending(mover, pending);
  }
  for (const entity of active) {
    const nav = navOf(entity);
    if (nav && nav.status !== 'done' && entity.path) {
      advance(mover, entity, nav);
    }
  }
  for (const entity of idle) {
    spreadIdle(mover, entity);
  }
  revealHiddenIdle(state, ctx.data);
}

export const movementSystem: System = {
  id: 'movement',
  update,
};
