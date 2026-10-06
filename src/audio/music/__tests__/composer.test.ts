import { describe, expect, it } from 'vitest';
import type { Mood, Note } from '../composer';
import { BARS_PER_PHRASE, BEATS_PER_BAR, composeBar, describePiece, MAX_ERA } from '../composer';

const SEEDS = [1, 2, 3, 42, 1234567, 4294967295];
const MOODS: Mood[] = ['calm', 'tension', 'battle'];
const BARS = 48;

function voices(notes: readonly Note[]): Set<string> {
  return new Set(notes.map((note) => note.voice));
}

function countNotes(seed: number, mood: Mood, era: number): number {
  let total = 0;
  for (let bar = 0; bar < BARS; bar += 1) {
    total += composeBar(seed, bar, mood, era).length;
  }
  return total;
}

describe('composer', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    for (let bar = 0; bar < BARS; bar += 1) {
      expect(composeBar(7, bar, 'tension', 2)).toEqual(composeBar(7, bar, 'tension', 2));
    }
    const first = JSON.stringify([0, 1, 2, 3].map((bar) => composeBar(7, bar, 'calm', 0)));
    const second = JSON.stringify([0, 1, 2, 3].map((bar) => composeBar(8, bar, 'calm', 0)));
    expect(first).not.toBe(second);
  });

  it('keeps every pitched note inside the mode of the piece', () => {
    for (const seed of SEEDS) {
      const piece = describePiece(seed);
      for (const mood of MOODS) {
        for (let bar = 0; bar < BARS; bar += 1) {
          for (const note of composeBar(seed, bar, mood, MAX_ERA)) {
            if (note.voice === 'drum') {
              continue;
            }
            const pitchClass = (((note.pitch - piece.root) % 12) + 12) % 12;
            expect(piece.mode).toContain(pitchClass);
            expect(note.pitch).toBeGreaterThanOrEqual(30);
            expect(note.pitch).toBeLessThanOrEqual(96);
          }
        }
      }
    }
  });

  it('keeps notes inside the bar with sane velocities', () => {
    for (const seed of SEEDS) {
      for (const mood of MOODS) {
        for (let bar = 0; bar < BARS; bar += 1) {
          for (const note of composeBar(seed, bar, mood, MAX_ERA)) {
            expect(note.beat).toBeGreaterThanOrEqual(0);
            expect(note.beat).toBeLessThan(BEATS_PER_BAR);
            expect(note.beats).toBeGreaterThan(0);
            expect(note.velocity).toBeGreaterThan(0);
            expect(note.velocity).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('gets denser as the mood escalates', () => {
    for (const seed of SEEDS) {
      const calm = countNotes(seed, 'calm', 1);
      const tension = countNotes(seed, 'tension', 1);
      const battle = countNotes(seed, 'battle', 1);
      expect(tension).toBeGreaterThan(calm);
      expect(battle).toBeGreaterThan(tension);
    }
  });

  it('adds instruments with later ages', () => {
    const collect = (era: number, mood: Mood): Set<string> => {
      const all = new Set<string>();
      for (let bar = 0; bar < BARS; bar += 1) {
        for (const voice of voices(composeBar(5, bar, mood, era))) {
          all.add(voice);
        }
      }
      return all;
    };
    expect([...collect(0, 'calm')].sort()).toEqual(['drone', 'lyre']);
    expect([...collect(1, 'calm')].sort()).toEqual(['drone', 'flute', 'lyre']);
    expect([...collect(2, 'calm')].sort()).toEqual(['drone', 'flute', 'harp', 'lyre']);
    expect([...collect(MAX_ERA, 'calm')].sort()).toEqual(['drone', 'drum', 'flute', 'harp', 'lyre']);
    expect(collect(0, 'battle').has('drum')).toBe(true);
  });

  it('repeats the opening motif and resolves phrases to the tonic', () => {
    for (const seed of SEEDS) {
      const piece = describePiece(seed);
      const lyre = (bar: number): Note[] => composeBar(seed, bar, 'calm', 0).filter((note) => note.voice === 'lyre');
      expect(lyre(BARS_PER_PHRASE)[0].pitch).toBe(lyre(0)[0].pitch);
      expect(lyre(BARS_PER_PHRASE)[0].beat).toBe(lyre(0)[0].beat);
      for (let phrase = 0; phrase < 8; phrase += 1) {
        const last = lyre(phrase * BARS_PER_PHRASE + BARS_PER_PHRASE - 1).at(-1);
        expect(last).toBeDefined();
        expect(((last?.pitch ?? 1) - piece.root) % 12).toBe(0);
      }
    }
  });
});
