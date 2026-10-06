export interface RngHolder {
  rngState: number;
}

export function seedRng(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h === 0 ? 0x6d2b79f5 : h;
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  return h >>> 0;
}

export function nextUint32(holder: RngHolder): number {
  const state = (holder.rngState + 0x6d2b79f5) >>> 0;
  holder.rngState = state;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export function nextFloat(holder: RngHolder): number {
  return nextUint32(holder) / 4294967296;
}

export function nextInt(holder: RngHolder, min: number, maxExclusive: number): number {
  if (maxExclusive <= min) {
    return min;
  }
  return min + Math.floor(nextFloat(holder) * (maxExclusive - min));
}

export function nextRange(holder: RngHolder, min: number, max: number): number {
  return min + nextFloat(holder) * (max - min);
}

export function chance(holder: RngHolder, probability: number): boolean {
  return nextFloat(holder) < probability;
}

export function pick<T>(holder: RngHolder, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from an empty list');
  }
  return items[nextInt(holder, 0, items.length)];
}

export function shuffle<T>(holder: RngHolder, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(holder, 0, i + 1);
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
}
