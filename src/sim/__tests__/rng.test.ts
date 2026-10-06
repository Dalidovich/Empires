import { describe, expect, it } from 'vitest';
import {
  chance,
  hashSeed,
  nextFloat,
  nextInt,
  nextUint32,
  pick,
  seedRng,
  shuffle,
} from '../rng';

function sequence(seed: number, length: number): number[] {
  const holder = { rngState: seedRng(seed) };
  return Array.from({ length }, () => nextUint32(holder));
}

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(sequence(42, 50)).toEqual(sequence(42, 50));
  });

  it('produces different sequences for different seeds', () => {
    expect(sequence(1, 10)).not.toEqual(sequence(2, 10));
  });

  it('continues from a stored state', () => {
    const holder = { rngState: seedRng(7) };
    for (let i = 0; i < 5; i++) {
      nextUint32(holder);
    }
    const restored = JSON.parse(JSON.stringify(holder)) as { rngState: number };
    expect(nextUint32(restored)).toBe(nextUint32(holder));
  });

  it('keeps the state a 32-bit unsigned integer', () => {
    const holder = { rngState: seedRng(123456789) };
    for (let i = 0; i < 1000; i++) {
      nextUint32(holder);
      expect(Number.isInteger(holder.rngState)).toBe(true);
      expect(holder.rngState).toBeGreaterThanOrEqual(0);
      expect(holder.rngState).toBeLessThan(4294967296);
    }
  });

  it('returns floats in [0, 1) with a reasonable mean', () => {
    const holder = { rngState: seedRng(99) };
    let sum = 0;
    const count = 10000;
    for (let i = 0; i < count; i++) {
      const value = nextFloat(holder);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(sum / count).toBeGreaterThan(0.47);
    expect(sum / count).toBeLessThan(0.53);
  });

  it('returns integers inside the requested range', () => {
    const holder = { rngState: seedRng(5) };
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const value = nextInt(holder, 3, 8);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(8);
      seen.add(value);
    }
    expect(seen.size).toBe(5);
    expect(nextInt(holder, 4, 4)).toBe(4);
  });

  it('respects probability bounds', () => {
    const holder = { rngState: seedRng(11) };
    expect(chance(holder, 0)).toBe(false);
    expect(chance(holder, 1)).toBe(true);
  });

  it('picks and shuffles deterministically', () => {
    const a = { rngState: seedRng(3) };
    const b = { rngState: seedRng(3) };
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(pick(a, items)).toBe(pick(b, items));
    const shuffledA = shuffle(a, [...items]);
    const shuffledB = shuffle(b, [...items]);
    expect(shuffledA).toEqual(shuffledB);
    expect([...shuffledA].sort((x, y) => x - y)).toEqual(items);
    expect(() => pick(a, [])).toThrow();
  });

  it('hashes text seeds to stable unsigned integers', () => {
    expect(hashSeed('inland')).toBe(hashSeed('inland'));
    expect(hashSeed('inland')).not.toBe(hashSeed('coastal'));
    expect(hashSeed('')).toBeGreaterThanOrEqual(0);
  });
});
