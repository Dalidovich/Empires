import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEATS_PER_BAR, MOOD_TEMPO } from '../composer';
import type { NotePlayer, TimedNote } from '../ensemble';
import { GenerativeMusic, SCHEDULE_INTERVAL_MS, START_DELAY, STOP_FADE, TEMPO_STEP } from '../generativeMusic';

class FakePlayer implements NotePlayer {
  readonly notes: TimedNote[] = [];
  released: number | null = null;
  disposed = false;

  play(note: TimedNote): void {
    this.notes.push(note);
  }

  release(fade: number): void {
    this.released = fade;
  }

  dispose(): void {
    this.disposed = true;
  }
}

interface FakeClock {
  state: string;
  currentTime: number;
}

const CALM_BAR = (BEATS_PER_BAR * 60) / MOOD_TEMPO.calm;

let clock: FakeClock;
let players: FakePlayer[];
let music: GenerativeMusic;

function player(index = 0): FakePlayer {
  const instance = players[index];
  if (!instance) {
    throw new Error('player was not created');
  }
  return instance;
}

function advance(seconds: number): void {
  const steps = Math.round((seconds * 1000) / SCHEDULE_INTERVAL_MS);
  for (let step = 0; step < steps; step += 1) {
    clock.currentTime += SCHEDULE_INTERVAL_MS / 1000;
    vi.advanceTimersByTime(SCHEDULE_INTERVAL_MS);
  }
}

function barStarts(notes: readonly TimedNote[]): number[] {
  return notes.filter((note) => note.voice === 'drone').map((note) => note.time);
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = { state: 'running', currentTime: 10 };
  players = [];
  music = new GenerativeMusic({
    nextSeed: () => 99,
    createPlayer: () => {
      const created = new FakePlayer();
      players.push(created);
      return created;
    },
  });
  music.attach(clock as unknown as AudioContext, {} as AudioNode);
});

afterEach(() => {
  music.destroy();
  vi.useRealTimers();
});

describe('generative music', () => {
  it('schedules the first bar on start and one bar at a time afterwards', () => {
    music.start();
    expect(barStarts(player().notes)).toEqual([10 + START_DELAY]);
    advance(1);
    expect(barStarts(player().notes)).toHaveLength(1);
    advance(CALM_BAR * 3);
    const starts = barStarts(player().notes);
    expect(starts).toHaveLength(4);
    for (let index = 1; index < starts.length; index += 1) {
      expect(starts[index] - starts[index - 1]).toBeCloseTo(CALM_BAR, 6);
    }
    for (const note of player().notes) {
      expect(note.time).toBeGreaterThanOrEqual(10 + START_DELAY);
    }
  });

  it('never schedules a bar in the past after a stalled timer', () => {
    music.start();
    clock.currentTime += 60;
    vi.advanceTimersByTime(SCHEDULE_INTERVAL_MS);
    expect(barStarts(player().notes).at(-1)).toBeCloseTo(70 + START_DELAY, 6);
  });

  it('waits for a running context', () => {
    clock.state = 'suspended';
    music.start();
    expect(players).toHaveLength(0);
    clock.state = 'running';
    music.ensurePlaying();
    music.ensurePlaying();
    expect(players).toHaveLength(1);
  });

  it('schedules nothing while the context clock is frozen', () => {
    music.start();
    vi.advanceTimersByTime(60_000);
    expect(barStarts(player().notes)).toHaveLength(1);
  });

  it('moves the tempo gradually towards the mood', () => {
    music.forceMood('battle');
    music.start();
    advance(16);
    const starts = barStarts(player().notes);
    const tempos = starts.slice(1).map((time, index) => (BEATS_PER_BAR * 60) / (time - starts[index]));
    expect(tempos[0]).toBeCloseTo(MOOD_TEMPO.calm + TEMPO_STEP, 6);
    expect(tempos[1]).toBeCloseTo(MOOD_TEMPO.calm + TEMPO_STEP * 2, 6);
    expect(tempos.at(-1)).toBeCloseTo(MOOD_TEMPO.battle, 6);
    expect(player().notes.some((note) => note.voice === 'drum')).toBe(true);
  });

  it('reacts to combat events', () => {
    music.start();
    advance(CALM_BAR);
    expect(player().notes.some((note) => note.voice === 'drum')).toBe(false);
    const attack = { type: 'underAttack', playerId: 0, attackerOwner: 1, position: { x: 0, y: 0 } } as const;
    music.observe([attack, attack], 0);
    advance(CALM_BAR);
    expect(player().notes.some((note) => note.voice === 'drum')).toBe(true);
  });

  it('adds voices for later ages', () => {
    music.setEra(3);
    music.start();
    expect(player().notes.some((note) => note.voice === 'harp')).toBe(true);
    expect(player().notes.some((note) => note.voice === 'flute')).toBe(true);
  });

  it('fades out on stop and starts a new piece afterwards', () => {
    music.start();
    music.stop();
    expect(player().released).toBe(STOP_FADE);
    advance(CALM_BAR * 2);
    expect(barStarts(player().notes)).toHaveLength(1);
    music.start();
    expect(players).toHaveLength(2);
    expect(barStarts(player(1).notes)).toHaveLength(1);
  });

  it('disposes the player on destroy', () => {
    music.start();
    music.destroy();
    expect(player().disposed).toBe(true);
    advance(CALM_BAR * 2);
    expect(barStarts(player().notes)).toHaveLength(1);
  });
});
