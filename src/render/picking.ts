import type { EntityId } from '../sim/types';
import type { ScreenPoint, ScreenRect } from './api';

export const PICK_TOLERANCE = 3;

export interface PickTarget {
  id: EntityId;
  priority: number;
  depth: number;
  screenX: number;
  screenY: number;
  halfWidth: number;
  height: number;
  footprintHalfWidth: number;
  footprintHalfHeight: number;
  groundFirst: boolean;
}

export function footprintHit(target: PickTarget, point: ScreenPoint): boolean {
  if (target.footprintHalfWidth <= 0 || target.footprintHalfHeight <= 0) {
    return false;
  }
  const dx = Math.abs(point.x - target.screenX);
  const dy = Math.abs(point.y - target.screenY);
  return dx / target.footprintHalfWidth + dy / target.footprintHalfHeight <= 1;
}

export function hitTest(
  target: PickTarget,
  point: ScreenPoint,
  tolerance: number = PICK_TOLERANCE,
): boolean {
  const dx = Math.abs(point.x - target.screenX);
  const dy = point.y - target.screenY;
  if (dx <= target.halfWidth + tolerance && dy <= tolerance && dy >= -target.height - tolerance) {
    return true;
  }
  return footprintHit(target, point);
}

function isBetter(
  candidate: PickTarget,
  candidateGrounded: boolean,
  best: PickTarget,
  bestGrounded: boolean,
): boolean {
  if (candidate.priority !== best.priority) {
    return candidate.priority > best.priority;
  }
  if (candidateGrounded !== bestGrounded) {
    return candidateGrounded;
  }
  if (candidate.depth !== best.depth) {
    return candidate.depth > best.depth;
  }
  return candidate.id < best.id;
}

export function pickTarget(targets: readonly PickTarget[], point: ScreenPoint): EntityId | null {
  let best: PickTarget | null = null;
  let bestGrounded = false;
  for (const target of targets) {
    if (!hitTest(target, point)) {
      continue;
    }
    const grounded = target.groundFirst && footprintHit(target, point);
    if (best === null || isBetter(target, grounded, best, bestGrounded)) {
      best = target;
      bestGrounded = grounded;
    }
  }
  return best === null ? null : best.id;
}

export function normalizeRect(rect: ScreenRect): ScreenRect {
  const x = rect.width < 0 ? rect.x + rect.width : rect.x;
  const y = rect.height < 0 ? rect.y + rect.height : rect.y;
  return { x, y, width: Math.abs(rect.width), height: Math.abs(rect.height) };
}

export function targetsInRect(targets: readonly PickTarget[], rect: ScreenRect): EntityId[] {
  const area = normalizeRect(rect);
  const right = area.x + area.width;
  const bottom = area.y + area.height;
  const ids: EntityId[] = [];
  for (const target of targets) {
    const halfWidth = Math.max(target.halfWidth, target.footprintHalfWidth);
    const top = target.screenY - Math.max(target.height, target.footprintHalfHeight);
    const base = target.screenY + target.footprintHalfHeight;
    if (
      target.screenX + halfWidth >= area.x &&
      target.screenX - halfWidth <= right &&
      base >= area.y &&
      top <= bottom
    ) {
      ids.push(target.id);
    }
  }
  return ids.sort((a, b) => a - b);
}
