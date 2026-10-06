import type { EntityView } from '../sim/snapshot';
import type { Vec2 } from '../sim/types';
import type { Think } from './context';
import { dist, isExplored, isWaterTerrain, random, tileIndexOf } from './context';
import type { ProbeState } from './state';

const PROBE_STEP = 8;
const PROBE_OFFSET = 4;
const ARRIVAL_RADIUS = 3;
const PROBE_TIMEOUT_TICKS = 1500;
const STOPPED_GRACE_TICKS = 100;
const MAX_VISITED = 400;
const GUESS_WEIGHT = 0.4;
const EDGE_PADDING = 2;

export function enemyGuess(think: Think): Vec2 {
  const alive = think.view.players.filter((player) => !player.defeated).length;
  if (alive === 2) {
    return { x: think.size - think.home.x, y: think.size - think.home.y };
  }
  return { x: think.size / 2, y: think.size / 2 };
}

export function markVisited(think: Think, point: Vec2): void {
  const tile = tileIndexOf(think, point);
  if (!think.state.visited.includes(tile)) {
    think.state.visited.push(tile);
    if (think.state.visited.length > MAX_VISITED) {
      think.state.visited.shift();
    }
  }
}

export function explorationPoint(think: Think, from: Vec2): Vec2 | null {
  const guess = enemyGuess(think);
  let best: Vec2 | null = null;
  let bestScore = Infinity;
  for (let y = PROBE_OFFSET; y < think.size; y += PROBE_STEP) {
    for (let x = PROBE_OFFSET; x < think.size; x += PROBE_STEP) {
      if (isExplored(think, x, y) || think.state.visited.includes(y * think.size + x)) {
        continue;
      }
      const point = { x: x + 0.5, y: y + 0.5 };
      const score = dist(point, from) + GUESS_WEIGHT * dist(point, guess);
      if (score < bestScore) {
        best = point;
        bestScore = score;
      }
    }
  }
  return best;
}

export function sweepPoint(think: Think, from: Vec2, swept: number[], water: boolean): Vec2 {
  const terrain = think.view.map.terrain;
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  for (let y = PROBE_OFFSET; y < think.size; y += PROBE_STEP) {
    for (let x = PROBE_OFFSET; x < think.size; x += PROBE_STEP) {
      const tile = y * think.size + x;
      if (swept.includes(tile)) {
        continue;
      }
      if (isExplored(think, x, y) && isWaterTerrain(terrain[tile]) !== water) {
        continue;
      }
      const point = { x: x + 0.5, y: y + 0.5 };
      const d = dist(point, from);
      if (d < bestDistance) {
        best = point;
        bestDistance = d;
      }
    }
  }
  if (best) {
    return best;
  }
  swept.length = 0;
  return randomPoint(think);
}

export function markSwept(think: Think, swept: number[], point: Vec2): void {
  const tile = tileIndexOf(think, point);
  if (!swept.includes(tile)) {
    swept.push(tile);
  }
}

export function randomPoint(think: Think): Vec2 {
  const span = think.size - EDGE_PADDING * 2;
  return {
    x: EDGE_PADDING + random(think) * span,
    y: EDGE_PADDING + random(think) * span,
  };
}

export function advanceProbe(think: Think, probe: ProbeState, unit: EntityView): void {
  const target = probe.target;
  if (target !== null) {
    const stopped =
      (unit.own?.orders.length ?? 0) === 0 && think.tick - probe.since > STOPPED_GRACE_TICKS;
    const expired =
      stopped ||
      dist(unit.position, target) <= ARRIVAL_RADIUS ||
      think.tick - probe.since > PROBE_TIMEOUT_TICKS ||
      isExplored(think, Math.floor(target.x), Math.floor(target.y));
    if (!expired) {
      return;
    }
    markVisited(think, target);
    probe.target = null;
  }
  const next = explorationPoint(think, unit.position);
  if (!next) {
    probe.unitId = null;
    return;
  }
  probe.target = next;
  probe.since = think.tick;
  think.commands.push({
    type: 'move',
    playerId: think.me,
    entityIds: [unit.id],
    target: next,
    queued: false,
  });
}

function fastest(think: Think, units: readonly EntityView[]): EntityView | null {
  let best: EntityView | null = null;
  let bestSpeed = -Infinity;
  for (const unit of units) {
    const speed = think.data.units[unit.type]?.speed ?? 0;
    if (speed > bestSpeed) {
      best = unit;
      bestSpeed = speed;
    }
  }
  return best;
}

function manageLandScout(think: Think): void {
  const probe = think.state.scout;
  const current = probe.unitId !== null ? think.byId.get(probe.unitId) : undefined;
  if (current && think.data.units[current.type]?.class.includes('villager')) {
    return;
  }
  if (think.enemyBuildings.length > 0) {
    if (current && current.owner === think.me) {
      think.commands.push({
        type: 'move',
        playerId: think.me,
        entityIds: [current.id],
        target: { x: think.home.x, y: think.home.y },
        queued: false,
      });
    }
    probe.unitId = null;
    probe.target = null;
    return;
  }
  let unit = current;
  if (!unit || unit.owner !== think.me) {
    const candidates = think.soldiers.filter(
      (soldier) =>
        !think.state.army.members.includes(soldier.id) &&
        soldier.id !== think.state.collector.unitId,
    );
    unit = fastest(think, candidates) ?? undefined;
    probe.unitId = unit ? unit.id : null;
    probe.target = null;
  }
  if (unit) {
    advanceProbe(think, probe, unit);
  }
}

function manageNavalScout(think: Think): void {
  const probe = think.state.navalScout;
  if (think.layout === 'land' || think.enemyBuildings.length > 0) {
    probe.unitId = null;
    probe.target = null;
    return;
  }
  let unit = probe.unitId !== null ? think.byId.get(probe.unitId) : undefined;
  if (!unit || unit.owner !== think.me) {
    unit = fastest(think, think.warships) ?? undefined;
    probe.unitId = unit ? unit.id : null;
    probe.target = null;
  }
  if (unit) {
    advanceProbe(think, probe, unit);
  }
}

export function manageScouting(think: Think): void {
  if (think.params.scouting <= 0) {
    return;
  }
  manageLandScout(think);
  manageNavalScout(think);
}
