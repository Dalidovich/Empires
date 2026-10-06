import type { Cost, ResourceKind } from '../data/types';
import { RESOURCE_KINDS } from '../data/types';

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`;
  }
  return `${minutes}:${rest}`;
}

export function colorCss(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

export function costEntries(cost: Cost): [ResourceKind, number][] {
  const entries: [ResourceKind, number][] = [];
  for (const kind of RESOURCE_KINDS) {
    const amount = cost[kind] ?? 0;
    if (amount > 0) {
      entries.push([kind, amount]);
    }
  }
  return entries;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
