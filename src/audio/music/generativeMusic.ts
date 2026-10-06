import type { SimEvent } from '../../sim/events';
import type { PlayerId } from '../../sim/types';
import type { Mood } from './composer';
import { BEATS_PER_BAR, composeBar, MAX_ERA, MOOD_TEMPO } from './composer';
import type { NotePlayer } from './ensemble';
import { Ensemble } from './ensemble';
import { GameMood } from './mood';

export const SCHEDULE_INTERVAL_MS = 50;
export const SCHEDULE_AHEAD = 0.3;
export const START_DELAY = 0.1;
export const STOP_FADE = 0.6;
export const TEMPO_STEP = 8;

export interface GenerativeMusicOptions {
  nextSeed?: () => number;
  createPlayer?: (context: AudioContext, destination: AudioNode) => NotePlayer;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 4294967296);
}

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}

export class GenerativeMusic {
  private readonly gameMood = new GameMood();
  private context: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private player: NotePlayer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wanted = false;
  private forcedMood: Mood | null = null;
  private era = 0;
  private seed = 0;
  private bar = 0;
  private nextBarTime = 0;
  private tempo = MOOD_TEMPO.calm;

  constructor(private readonly options: GenerativeMusicOptions = {}) {}

  attach(context: AudioContext, destination: AudioNode): void {
    if (this.context) {
      return;
    }
    this.context = context;
    this.destination = destination;
  }

  start(): void {
    this.wanted = true;
    this.ensurePlaying();
  }

  stop(): void {
    this.wanted = false;
    this.gameMood.reset();
    this.era = 0;
    this.halt();
    this.player?.release(STOP_FADE);
    this.player = null;
  }

  ensurePlaying(): void {
    const { context, destination } = this;
    if (!this.wanted || this.timer !== null || !context || !destination || context.state !== 'running') {
      return;
    }
    this.player = (this.options.createPlayer ?? defaultPlayer)(context, destination);
    this.seed = (this.options.nextSeed ?? randomSeed)();
    this.bar = 0;
    this.tempo = MOOD_TEMPO.calm;
    this.nextBarTime = context.currentTime + START_DELAY;
    this.timer = setInterval(this.tick, SCHEDULE_INTERVAL_MS);
    this.tick();
  }

  observe(events: readonly SimEvent[], playerId: PlayerId): void {
    if (this.context) {
      this.gameMood.observe(events, playerId, this.context.currentTime);
    }
  }

  setEra(era: number): void {
    this.era = Math.min(MAX_ERA, Math.max(0, Math.floor(era)));
  }

  forceMood(mood: Mood | null): void {
    this.forcedMood = mood;
  }

  destroy(): void {
    this.wanted = false;
    this.halt();
    this.player?.dispose();
    this.player = null;
    this.context = null;
    this.destination = null;
  }

  private halt(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private readonly tick = (): void => {
    const { context, player } = this;
    if (!context || !player) {
      return;
    }
    const now = context.currentTime;
    if (this.nextBarTime < now) {
      this.nextBarTime = now + START_DELAY;
    }
    if (this.nextBarTime - now > SCHEDULE_AHEAD) {
      return;
    }
    const mood = this.forcedMood ?? this.gameMood.current(now);
    this.tempo = approach(this.tempo, MOOD_TEMPO[mood], TEMPO_STEP);
    const beat = 60 / this.tempo;
    for (const note of composeBar(this.seed, this.bar, mood, this.era)) {
      player.play({
        voice: note.voice,
        pitch: note.pitch,
        velocity: note.velocity,
        time: this.nextBarTime + note.beat * beat,
        duration: note.beats * beat,
      });
    }
    this.bar += 1;
    this.nextBarTime += BEATS_PER_BAR * beat;
  };
}

function defaultPlayer(context: AudioContext, destination: AudioNode): NotePlayer {
  return new Ensemble(context, destination);
}
