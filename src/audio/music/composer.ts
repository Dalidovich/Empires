import type { Random } from './random';
import { createRandom, mixSeed, randomPick } from './random';

export type Mood = 'calm' | 'tension' | 'battle';

export type Voice = 'lyre' | 'harp' | 'flute' | 'drone' | 'drum';

export interface Note {
  voice: Voice;
  beat: number;
  beats: number;
  pitch: number;
  velocity: number;
}

export interface Piece {
  seed: number;
  root: number;
  mode: readonly number[];
}

export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 4;
export const PHRASES_PER_SECTION = 4;
export const MAX_ERA = 3;
export const DRUM_LOW = 0;
export const DRUM_HIGH = 1;

export const MOOD_TEMPO: Record<Mood, number> = { calm: 72, tension: 88, battle: 108 };

const STEPS_PER_BAR = 8;
const STEP_BEATS = BEATS_PER_BAR / STEPS_PER_BAR;
const STEPS_PER_PHRASE = STEPS_PER_BAR * BARS_PER_PHRASE;
const SCALE_SIZE = 7;
const MELODY_LOW = 4;
const MELODY_HIGH = 16;
const VARIATION_CHANCE = 0.15;

const MODES: readonly (readonly number[])[] = [
  [0, 2, 3, 5, 7, 9, 10],
  [0, 1, 3, 5, 7, 8, 10],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 1, 4, 5, 7, 8, 10],
];

const ROOTS: readonly number[] = [50, 52, 53, 55, 57];

const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 0, 3, 0],
  [0, 3, 6, 0],
  [0, 6, 4, 0],
  [0, 5, 3, 0],
];

const WALK: readonly number[] = [-2, -1, -1, -1, 0, 1, 1, 1, 2];

const CADENCE_RHYTHM: readonly number[] = [1, 0, 1, 0, 1, 0, 0, 0];

const RHYTHMS: Record<Mood, readonly (readonly number[])[]> = {
  calm: [
    [1, 0, 0, 0, 1, 0, 1, 0],
    [1, 0, 1, 0, 0, 0, 1, 0],
    [1, 0, 0, 1, 0, 0, 1, 0],
    [1, 0, 1, 0, 1, 0, 0, 0],
  ],
  tension: [
    [1, 0, 1, 1, 0, 1, 1, 0],
    [1, 1, 0, 1, 1, 0, 1, 0],
    [1, 0, 1, 0, 1, 1, 0, 1],
  ],
  battle: [
    [1, 1, 1, 0, 1, 1, 1, 0],
    [1, 0, 1, 1, 1, 0, 1, 1],
    [1, 1, 0, 1, 1, 1, 0, 1],
  ],
};

const MELODY_LEVEL: Record<Mood, number> = { calm: 0.6, tension: 0.72, battle: 0.85 };
const DRONE_LEVEL: Record<Mood, number> = { calm: 0.5, tension: 0.6, battle: 0.7 };

const DRUM_PATTERNS: Record<Mood, readonly (readonly [number, number, number])[]> = {
  calm: [],
  tension: [
    [0, DRUM_LOW, 0.5],
    [3, DRUM_HIGH, 0.3],
    [5, DRUM_LOW, 0.4],
    [7, DRUM_HIGH, 0.3],
  ],
  battle: [
    [0, DRUM_LOW, 0.85],
    [1, DRUM_HIGH, 0.4],
    [2, DRUM_HIGH, 0.45],
    [3, DRUM_LOW, 0.7],
    [4, DRUM_HIGH, 0.4],
    [5, DRUM_HIGH, 0.45],
    [6, DRUM_LOW, 0.75],
    [7, DRUM_HIGH, 0.5],
  ],
};

function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function describePiece(seed: number): Piece {
  const random = createRandom(mixSeed(seed, 1));
  return { seed, root: randomPick(random, ROOTS), mode: randomPick(random, MODES) };
}

function degreePitch(piece: Piece, degree: number): number {
  const octave = Math.floor(degree / SCALE_SIZE);
  return piece.root + 12 * octave + piece.mode[degree - SCALE_SIZE * octave];
}

function isChordTone(degree: number, pedal: number): boolean {
  const relative = mod(degree - pedal, SCALE_SIZE);
  return relative === 0 || relative === 2 || relative === 4;
}

function nearestChordTone(degree: number, pedal: number): number {
  for (let distance = 0; distance <= 2; distance += 1) {
    if (isChordTone(degree - distance, pedal)) {
      return degree - distance;
    }
    if (isChordTone(degree + distance, pedal)) {
      return degree + distance;
    }
  }
  return degree;
}

function nearestTonic(degree: number): number {
  return SCALE_SIZE * Math.round(degree / SCALE_SIZE);
}

function motifOf(phrase: number): number {
  return phrase === 2 ? 1 : 0;
}

function phrasePedals(piece: Piece, section: number, phrase: number): readonly number[] {
  const random = createRandom(mixSeed(piece.seed, section, motifOf(phrase), 3));
  return randomPick(random, PROGRESSIONS);
}

function phraseContour(piece: Piece, section: number, phrase: number, pedals: readonly number[]): number[] {
  const motif = motifOf(phrase);
  const random = createRandom(mixSeed(piece.seed, section, motif, 11));
  const contour: number[] = [];
  let degree = motif === 0 ? SCALE_SIZE : SCALE_SIZE + 4;
  for (let step = 0; step < STEPS_PER_PHRASE; step += 1) {
    const moved = clamp(degree + randomPick(random, WALK), MELODY_LOW, MELODY_HIGH);
    degree = step % STEPS_PER_BAR === 0 ? nearestChordTone(moved, pedals[step / STEPS_PER_BAR]) : moved;
    contour.push(degree);
  }
  if (phrase === 1 || phrase === 3) {
    const vary = createRandom(mixSeed(piece.seed, section, phrase, 13));
    for (let step = 0; step < STEPS_PER_PHRASE; step += 1) {
      const changed = vary() < VARIATION_CHANCE;
      const direction = vary() < 0.5 ? -1 : 1;
      if (changed && step % STEPS_PER_BAR !== 0) {
        contour[step] = clamp(contour[step] + direction, MELODY_LOW, MELODY_HIGH);
      }
    }
  }
  for (let step = STEPS_PER_PHRASE - STEPS_PER_BAR / 2; step < STEPS_PER_PHRASE; step += 1) {
    contour[step] = nearestTonic(contour[step]);
  }
  return contour;
}

function barRhythm(piece: Piece, section: number, phrase: number, barInPhrase: number, mood: Mood): readonly number[] {
  if (barInPhrase === BARS_PER_PHRASE - 1 && mood !== 'battle') {
    return CADENCE_RHYTHM;
  }
  const random = createRandom(mixSeed(piece.seed, section, motifOf(phrase), barInPhrase, 17));
  return randomPick(random, RHYTHMS[mood]);
}

function humanize(random: Random, velocity: number): number {
  return clamp(velocity * (0.9 + random() * 0.2), 0, 1);
}

function melody(
  piece: Piece,
  contour: readonly number[],
  rhythm: readonly number[],
  barInPhrase: number,
  mood: Mood,
  random: Random,
): Note[] {
  const notes: Note[] = [];
  for (let step = 0; step < STEPS_PER_BAR; step += 1) {
    if (rhythm[step] !== 1) {
      continue;
    }
    let length = 1;
    while (step + length < STEPS_PER_BAR && rhythm[step + length] !== 1) {
      length += 1;
    }
    const accent = step === 0 ? 1 : step === STEPS_PER_BAR / 2 ? 0.85 : 0.7;
    notes.push({
      voice: 'lyre',
      beat: step * STEP_BEATS,
      beats: length * STEP_BEATS,
      pitch: degreePitch(piece, contour[barInPhrase * STEPS_PER_BAR + step]),
      velocity: humanize(random, MELODY_LEVEL[mood] * accent),
    });
  }
  return notes;
}

function accompaniment(piece: Piece, pedal: number, mood: Mood, random: Random): Note[] {
  const shape = [0, 4, 7, 4, 2, 4, 7, 4];
  const stride = mood === 'calm' ? 2 : 1;
  const notes: Note[] = [];
  for (let step = 0; step < STEPS_PER_BAR; step += stride) {
    notes.push({
      voice: 'harp',
      beat: step * STEP_BEATS,
      beats: stride * STEP_BEATS,
      pitch: degreePitch(piece, pedal + shape[step]),
      velocity: humanize(random, step === 0 ? 0.5 : 0.36),
    });
  }
  return notes;
}

function countermelody(piece: Piece, pedal: number, mood: Mood, random: Random): Note[] {
  const tones = [2, 4, 7];
  const count = mood === 'calm' ? 1 : 2;
  const beats = BEATS_PER_BAR / count;
  const notes: Note[] = [];
  for (let index = 0; index < count; index += 1) {
    notes.push({
      voice: 'flute',
      beat: index * beats,
      beats,
      pitch: degreePitch(piece, pedal + SCALE_SIZE + randomPick(random, tones)),
      velocity: humanize(random, 0.5),
    });
  }
  return notes;
}

function percussion(mood: Mood, era: number, bar: number, barInPhrase: number, random: Random): Note[] {
  const notes: Note[] = [];
  const hit = (beat: number, pitch: number, velocity: number): void => {
    notes.push({ voice: 'drum', beat, beats: STEP_BEATS, pitch, velocity: humanize(random, velocity) });
  };
  if (mood === 'calm') {
    if (era >= MAX_ERA && bar % 2 === 0) {
      hit(0, DRUM_LOW, 0.3);
    }
    return notes;
  }
  for (const [step, pitch, velocity] of DRUM_PATTERNS[mood]) {
    hit(step * STEP_BEATS, pitch, velocity);
  }
  if (mood === 'battle' && barInPhrase === BARS_PER_PHRASE - 1) {
    for (let index = 0; index < 4; index += 1) {
      hit(BEATS_PER_BAR - 1 + index * 0.25 + 0.125, DRUM_HIGH, 0.3 + index * 0.06);
    }
  }
  return notes;
}

export function composeBar(seed: number, bar: number, mood: Mood, era: number): Note[] {
  const piece = describePiece(seed);
  const barsPerSection = BARS_PER_PHRASE * PHRASES_PER_SECTION;
  const section = Math.floor(bar / barsPerSection);
  const phrase = Math.floor((bar % barsPerSection) / BARS_PER_PHRASE);
  const barInPhrase = bar % BARS_PER_PHRASE;
  const pedals = phrasePedals(piece, section, phrase);
  const pedal = pedals[barInPhrase];
  const contour = phraseContour(piece, section, phrase, pedals);
  const rhythm = barRhythm(piece, section, phrase, barInPhrase, mood);
  const random = createRandom(mixSeed(seed, bar, 7));

  const notes: Note[] = [
    {
      voice: 'drone',
      beat: 0,
      beats: BEATS_PER_BAR,
      pitch: degreePitch(piece, pedal - SCALE_SIZE),
      velocity: DRONE_LEVEL[mood],
    },
    ...melody(piece, contour, rhythm, barInPhrase, mood, random),
  ];
  if (era >= 1 && (phrase >= 2 || era >= MAX_ERA)) {
    notes.push(...countermelody(piece, pedal, mood, random));
  }
  if (era >= 2) {
    notes.push(...accompaniment(piece, pedal, mood, random));
  }
  notes.push(...percussion(mood, era, bar, barInPhrase, random));
  return notes;
}
