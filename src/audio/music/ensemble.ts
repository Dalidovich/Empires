import type { Voice } from './composer';
import { DRUM_LOW } from './composer';
import { createRandom } from './random';

export interface TimedNote {
  voice: Voice;
  pitch: number;
  velocity: number;
  time: number;
  duration: number;
}

export interface NotePlayer {
  play(note: TimedNote): void;
  release(fade: number): void;
  dispose(): void;
}

export const MAX_MUSIC_VOICES = 28;

const OUTPUT_LEVEL = 0.7;
const REVERB_LEVEL = 0.32;
const REVERB_SECONDS = 2.4;
const STRING_SECONDS = 2.4;
const STRING_FADE = 0.3;
const NOISE_SECONDS = 1;

const LEVEL: Record<Voice, number> = { lyre: 0.5, harp: 0.3, flute: 0.2, drone: 0.11, drum: 0.6 };

interface PluckedString {
  buffer: AudioBuffer;
  rate: number;
}

function frequencyOf(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

export class Ensemble implements NotePlayer {
  private readonly output: GainNode;
  private readonly bus: GainNode;
  private readonly chain: AudioNode[];
  private readonly noise: AudioBuffer;
  private readonly strings = new Map<number, PluckedString>();
  private readonly sources = new Set<AudioScheduledSourceNode>();
  private voices = 0;
  private disposed = false;

  constructor(
    private readonly context: AudioContext,
    destination: AudioNode,
  ) {
    this.noise = this.renderNoise();
    this.bus = context.createGain();
    this.output = context.createGain();
    this.output.gain.value = OUTPUT_LEVEL;
    const reverb = context.createConvolver();
    reverb.buffer = this.renderImpulse();
    const wet = context.createGain();
    wet.gain.value = REVERB_LEVEL;
    const limiter = context.createDynamicsCompressor();
    this.bus.connect(this.output);
    this.bus.connect(reverb);
    reverb.connect(wet);
    wet.connect(this.output);
    this.output.connect(limiter);
    limiter.connect(destination);
    this.chain = [this.bus, reverb, wet, this.output, limiter];
  }

  play(note: TimedNote): void {
    if (this.disposed) {
      return;
    }
    const optional = note.voice === 'harp' || note.voice === 'lyre';
    if (optional && this.voices >= MAX_MUSIC_VOICES) {
      return;
    }
    const level = LEVEL[note.voice] * note.velocity;
    switch (note.voice) {
      case 'lyre':
      case 'harp':
        this.pluck(note, level);
        break;
      case 'flute':
        this.blow(note, level);
        break;
      case 'drone':
        this.sustain(note, level);
        break;
      case 'drum':
        if (note.pitch === DRUM_LOW) {
          this.thump(note, level);
        } else {
          this.tap(note, level);
        }
        break;
    }
  }

  release(fade: number): void {
    if (this.disposed) {
      return;
    }
    const now = this.context.currentTime;
    const gain = this.output.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + fade);
    this.stopSources(now + fade);
    setTimeout(() => this.dispose(), (fade + 0.1) * 1000);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopSources(0);
    this.sources.clear();
    for (const node of this.chain) {
      node.disconnect();
    }
  }

  private stopSources(when: number): void {
    for (const source of this.sources) {
      try {
        source.stop(when);
      } catch {
        continue;
      }
    }
  }

  private pluck(note: TimedNote, level: number): void {
    const string = this.string(note.pitch);
    const source = this.context.createBufferSource();
    source.buffer = string.buffer;
    source.playbackRate.value = string.rate;
    const gain = this.context.createGain();
    gain.gain.value = level;
    source.connect(gain);
    gain.connect(this.bus);
    this.track(source, [gain], true);
    source.start(note.time);
  }

  private blow(note: TimedNote, level: number): void {
    const { context } = this;
    const frequency = frequencyOf(note.pitch);
    const end = note.time + note.duration;
    const stopAt = end + 0.6;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, note.time);
    envelope.gain.linearRampToValueAtTime(level, note.time + 0.09);
    envelope.gain.setTargetAtTime(0, end, 0.09);
    envelope.connect(this.bus);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = frequency * 2.5;
    filter.connect(envelope);

    const tone = context.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = frequency;
    tone.connect(filter);

    const vibratoDepth = context.createGain();
    vibratoDepth.gain.setValueAtTime(0, note.time);
    vibratoDepth.gain.linearRampToValueAtTime(7, note.time + 0.5);
    vibratoDepth.connect(tone.detune);
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 5;
    vibrato.connect(vibratoDepth);

    const breathBand = context.createBiquadFilter();
    breathBand.type = 'bandpass';
    breathBand.frequency.value = frequency * 2;
    breathBand.Q.value = 1;
    const breathLevel = context.createGain();
    breathLevel.gain.value = 0.25;
    breathBand.connect(breathLevel);
    breathLevel.connect(envelope);
    const breath = context.createBufferSource();
    breath.buffer = this.noise;
    breath.loop = true;
    breath.connect(breathBand);

    this.track(tone, [filter, envelope], true);
    this.track(vibrato, [vibratoDepth], false);
    this.track(breath, [breathBand, breathLevel], false);
    for (const source of [tone, vibrato, breath]) {
      source.start(note.time);
      source.stop(stopAt);
    }
  }

  private sustain(note: TimedNote, level: number): void {
    const { context } = this;
    const frequency = frequencyOf(note.pitch);
    const end = note.time + note.duration;
    const stopAt = end + 4;

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, note.time);
    envelope.gain.linearRampToValueAtTime(level, note.time + 1.2);
    envelope.gain.setTargetAtTime(0, end, 0.8);
    envelope.connect(this.bus);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.7;
    filter.connect(envelope);

    const partials: [OscillatorType, number, number][] = [
      ['sawtooth', 1, -7],
      ['sawtooth', 1, 7],
      ['sine', 1.5, 0],
    ];
    partials.forEach(([type, ratio, detune], index) => {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.value = frequency * ratio;
      oscillator.detune.value = detune;
      oscillator.connect(filter);
      this.track(oscillator, index === 0 ? [filter, envelope] : [], index === 0);
      oscillator.start(note.time);
      oscillator.stop(stopAt);
    });
  }

  private thump(note: TimedNote, level: number): void {
    const { context } = this;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(level, note.time);
    envelope.gain.exponentialRampToValueAtTime(0.001, note.time + 0.45);
    envelope.connect(this.bus);
    const oscillator = context.createOscillator();
    oscillator.frequency.setValueAtTime(125, note.time);
    oscillator.frequency.exponentialRampToValueAtTime(52, note.time + 0.14);
    oscillator.connect(envelope);
    this.track(oscillator, [envelope], true);
    oscillator.start(note.time);
    oscillator.stop(note.time + 0.5);
  }

  private tap(note: TimedNote, level: number): void {
    const { context } = this;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(level, note.time);
    envelope.gain.exponentialRampToValueAtTime(0.001, note.time + 0.09);
    envelope.connect(this.bus);
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1900;
    band.Q.value = 1.5;
    band.connect(envelope);
    const source = context.createBufferSource();
    source.buffer = this.noise;
    source.connect(band);
    this.track(source, [band, envelope], true);
    source.start(note.time);
    source.stop(note.time + 0.12);
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[], counted: boolean): void {
    this.sources.add(source);
    if (counted) {
      this.voices += 1;
    }
    source.onended = () => {
      this.sources.delete(source);
      if (counted) {
        this.voices -= 1;
      }
      source.disconnect();
      for (const node of nodes) {
        node.disconnect();
      }
    };
  }

  private string(pitch: number): PluckedString {
    const cached = this.strings.get(pitch);
    if (cached) {
      return cached;
    }
    const sampleRate = this.context.sampleRate;
    const frequency = frequencyOf(pitch);
    const period = Math.max(2, Math.round(sampleRate / frequency));
    const length = Math.floor(sampleRate * STRING_SECONDS);
    const buffer = this.context.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    const random = createRandom(pitch + 1);
    let smoothed = 0;
    let sum = 0;
    for (let index = 0; index < period; index += 1) {
      smoothed = 0.55 * (random() * 2 - 1) + 0.45 * smoothed;
      data[index] = smoothed;
      sum += smoothed;
    }
    const offset = sum / period;
    for (let index = 0; index < period; index += 1) {
      data[index] -= offset;
    }
    for (let index = period; index < length; index += 1) {
      data[index] = 0.4985 * (data[index - period] + data[index - period + 1]);
    }
    const fadeStart = Math.floor(length * (1 - STRING_FADE));
    for (let index = fadeStart; index < length; index += 1) {
      data[index] *= (length - index) / (length - fadeStart);
    }
    const string = { buffer, rate: (frequency * (period - 0.5)) / sampleRate };
    this.strings.set(pitch, string);
    return string;
  }

  private renderNoise(): AudioBuffer {
    const sampleRate = this.context.sampleRate;
    const buffer = this.context.createBuffer(1, Math.floor(sampleRate * NOISE_SECONDS), sampleRate);
    const data = buffer.getChannelData(0);
    const random = createRandom(977);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = random() * 2 - 1;
    }
    return buffer;
  }

  private renderImpulse(): AudioBuffer {
    const sampleRate = this.context.sampleRate;
    const length = Math.floor(sampleRate * REVERB_SECONDS);
    const buffer = this.context.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      const random = createRandom(4001 + channel);
      for (let index = 0; index < length; index += 1) {
        data[index] = (random() * 2 - 1) * (1 - index / length) ** 3;
      }
    }
    return buffer;
  }
}
