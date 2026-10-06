import type { EntityView } from '../sim/snapshot';
import type { Think } from './context';
import { dist, isIdle, sameLand } from './context';

const MIN_ARMY_FOR_COLLECTOR = 3;
const DANGER_RADIUS = 8;
const HOME_ARRIVAL = 5;
const REACH = 1;

function isMutualAlly(think: Think, owner: number): boolean {
  if (owner === think.me) {
    return true;
  }
  return (
    think.view.self.diplomacy[owner] === 'ally' &&
    think.view.players[owner]?.stanceTowardViewer === 'ally'
  );
}

function wanted(think: Think, object: EntityView): boolean {
  if (object.owner === think.me || (object.owner >= 0 && isMutualAlly(think, object.owner))) {
    return false;
  }
  if (!sameLand(think, object.position, think.home)) {
    return false;
  }
  return !think.enemyUnits.some((enemy) => dist(enemy.position, object.position) <= DANGER_RADIUS);
}

export function manageRelics(think: Think): void {
  const collector = think.state.collector;
  if (think.view.settings.victoryMode !== 'standard' || think.params.relics <= 0) {
    collector.unitId = null;
    return;
  }
  let unit = collector.unitId !== null ? think.byId.get(collector.unitId) : undefined;
  if (unit && unit.owner !== think.me) {
    unit = undefined;
  }
  let goal: EntityView | null = null;
  let bestDistance = Infinity;
  const from = unit ? unit.position : think.home;
  for (const object of think.objects) {
    if (!wanted(think, object)) {
      continue;
    }
    const d = dist(object.position, from);
    if (d < bestDistance) {
      goal = object;
      bestDistance = d;
    }
  }
  const escorting =
    unit !== undefined &&
    think.objects.some((object) => object.owner === think.me && object.heldBy === unit?.id);
  if (!unit) {
    collector.unitId = null;
    if (!goal || think.soldiers.length < MIN_ARMY_FOR_COLLECTOR) {
      return;
    }
    const members = think.state.army.members;
    let best: EntityView | null = null;
    let bestSpeed = -Infinity;
    for (const soldier of think.soldiers) {
      if (members.includes(soldier.id) || soldier.id === think.state.scout.unitId) {
        continue;
      }
      const speed = think.data.units[soldier.type]?.speed ?? 0;
      if (speed > bestSpeed) {
        best = soldier;
        bestSpeed = speed;
      }
    }
    if (!best) {
      return;
    }
    unit = best;
    collector.unitId = best.id;
  }
  if (goal) {
    collector.objectId = goal.id;
    const order = unit.own?.orders[0];
    const heading = order && order.type === 'move' && dist(order.target, goal.position) <= REACH;
    if (!heading && dist(unit.position, goal.position) > REACH) {
      think.commands.push({
        type: 'move',
        playerId: think.me,
        entityIds: [unit.id],
        target: { x: goal.position.x, y: goal.position.y },
        queued: false,
      });
    }
    return;
  }
  collector.objectId = null;
  if (!escorting) {
    collector.unitId = null;
    return;
  }
  if (isIdle(unit) && dist(unit.position, think.home) > HOME_ARRIVAL) {
    think.commands.push({
      type: 'move',
      playerId: think.me,
      entityIds: [unit.id],
      target: { x: think.home.x, y: think.home.y },
      queued: false,
    });
  }
}
