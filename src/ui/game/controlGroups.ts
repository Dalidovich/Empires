import type { EntityId } from '../../sim/types';

export const DOUBLE_PRESS_MS = 400;

export const GROUP_COUNT = 9;

export interface GroupRecall {
  ids: EntityId[];
  center: boolean;
}

export class ControlGroups {
  private readonly groups = new Map<number, EntityId[]>();
  private lastIndex = -1;
  private lastTime = Number.NEGATIVE_INFINITY;

  assign(index: number, ids: readonly EntityId[]): void {
    if (!this.isValid(index)) {
      return;
    }
    if (ids.length === 0) {
      this.groups.delete(index);
    } else {
      this.groups.set(index, [...new Set(ids)]);
    }
  }

  get(index: number): EntityId[] {
    return [...(this.groups.get(index) ?? [])];
  }

  recall(index: number, now: number): GroupRecall | null {
    const ids = this.groups.get(index);
    if (!ids || ids.length === 0) {
      return null;
    }
    const center = this.lastIndex === index && now - this.lastTime <= DOUBLE_PRESS_MS;
    this.lastIndex = index;
    this.lastTime = center ? Number.NEGATIVE_INFINITY : now;
    return { ids: [...ids], center };
  }

  prune(exists: (id: EntityId) => boolean): void {
    for (const [index, ids] of [...this.groups]) {
      const alive = ids.filter(exists);
      if (alive.length === 0) {
        this.groups.delete(index);
      } else if (alive.length !== ids.length) {
        this.groups.set(index, alive);
      }
    }
  }

  private isValid(index: number): boolean {
    return Number.isInteger(index) && index >= 1 && index <= GROUP_COUNT;
  }
}
