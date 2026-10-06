import type { AgeId } from '../data/types';
import { AGE_ORDER } from '../data/types';
import { ASSET_BASE_PATH } from '../shared/assetManifest';
import type { SimEvent } from '../sim/events';
import type { Vec2 } from '../sim/types';
import type { AudioOptions, AudioSystem, ListenerViewport, UiSound, UiSoundOptions } from './api';
import type { SoundRequest } from './mapping';
import { eventSound, uiSoundRequest } from './mapping';
import { MusicPlayer } from './music';
import { GenerativeMusic } from './music/generativeMusic';
import { createWarnOnce, SampleBank } from './sampleBank';

export type * from './api';

export const MAX_VOICES = 16;
export const LATE_START_LIMIT = 0.25;

type AudioContextConstructor = new () => AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  const scope = globalThis as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0;
}

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden;
}

function insideViewport(position: Vec2, listener: ListenerViewport): boolean {
  return (
    Math.abs(position.x - listener.center.x) <= listener.halfWidth &&
    Math.abs(position.y - listener.center.y) <= listener.halfHeight
  );
}

interface Graph {
  context: AudioContext;
  master: GainNode;
  effects: GainNode;
  music: GainNode;
}

class WebAudioSystem implements AudioSystem {
  private readonly warn = createWarnOnce();
  private readonly bank: SampleBank;
  private readonly playlist: MusicPlayer | null;
  private readonly generative: GenerativeMusic | null;
  private readonly music: MusicPlayer | GenerativeMusic;
  private readonly voices = new Set<AudioBufferSourceNode>();
  private readonly lastPlayed = new Map<string, number>();
  private graph: Graph | null = null;
  private effectsVolume = 1;
  private musicVolume = 1;
  private muted = false;
  private destroyed = false;
  private unlocked = false;

  constructor(options: AudioOptions) {
    const basePath = options.assetBasePath ?? ASSET_BASE_PATH;
    this.bank = new SampleBank(options.manifest, basePath, this.warn);
    const tracks = options.manifest.music;
    if (tracks.length > 0) {
      const playlist = new MusicPlayer(tracks, basePath, this.warn);
      this.playlist = playlist;
      this.generative = null;
      this.music = playlist;
    } else {
      const generative = new GenerativeMusic();
      this.playlist = null;
      this.generative = generative;
      this.music = generative;
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  async resume(): Promise<void> {
    const graph = this.ensureGraph();
    if (!graph) {
      return;
    }
    this.unlocked = true;
    await this.syncContext(graph);
  }

  handleEvents(events: readonly SimEvent[], listener: ListenerViewport): void {
    this.generative?.observe(events, listener.playerId);
    for (const event of events) {
      const request = eventSound(event, listener.playerId);
      if (!request) {
        continue;
      }
      if (request.position && !insideViewport(request.position, listener)) {
        continue;
      }
      this.play(request);
    }
  }

  playUi(sound: UiSound, options?: UiSoundOptions): void {
    this.play(uiSoundRequest(sound, options));
  }

  startMusic(): void {
    this.music.start();
  }

  stopMusic(): void {
    this.music.stop();
  }

  setMusicAge(age: AgeId): void {
    this.generative?.setEra(AGE_ORDER.indexOf(age));
  }

  setEffectsVolume(volume: number): void {
    this.effectsVolume = clampVolume(volume);
    this.applyVolumes();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume(volume);
    this.applyVolumes();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
    }
    this.music.destroy();
    for (const voice of this.voices) {
      voice.onended = null;
      try {
        voice.stop();
      } catch {
        continue;
      }
    }
    this.voices.clear();
    this.lastPlayed.clear();
    this.bank.clear();
    const graph = this.graph;
    this.graph = null;
    if (graph) {
      void graph.context.close().catch(() => {});
    }
  }

  private ensureGraph(): Graph | null {
    if (this.graph || this.destroyed) {
      return this.graph;
    }
    const Constructor = audioContextConstructor();
    if (!Constructor) {
      this.warn('context', 'Web Audio is not available: audio is disabled');
      return null;
    }
    let context: AudioContext;
    try {
      context = new Constructor();
    } catch {
      this.warn('context', 'Web Audio is not available: audio is disabled');
      return null;
    }
    const master = context.createGain();
    const effects = context.createGain();
    const music = context.createGain();
    effects.connect(master);
    music.connect(master);
    master.connect(context.destination);
    this.graph = { context, master, effects, music };
    this.applyVolumes();
    this.music.attach(context, music);
    return this.graph;
  }

  private readonly onVisibilityChange = (): void => {
    if (this.graph && this.unlocked) {
      void this.syncContext(this.graph);
    }
  };

  private async syncContext(graph: Graph): Promise<void> {
    const hidden = pageHidden();
    this.playlist?.setSuspended(hidden);
    try {
      await (hidden ? graph.context.suspend() : graph.context.resume());
    } catch {
      return;
    }
    if (!hidden && this.graph === graph) {
      this.music.ensurePlaying();
    }
  }

  private applyVolumes(): void {
    const graph = this.graph;
    if (!graph) {
      return;
    }
    graph.master.gain.value = this.muted ? 0 : 1;
    graph.effects.gain.value = this.effectsVolume;
    graph.music.gain.value = this.musicVolume;
  }

  private play(request: SoundRequest): void {
    const id = this.bank.resolve(request.candidates);
    const graph = this.graph;
    if (id === null || !graph || graph.context.state !== 'running') {
      return;
    }
    const { context } = graph;
    const requestedAt = context.currentTime;
    const previous = this.lastPlayed.get(id);
    if (previous !== undefined && requestedAt - previous < request.minInterval) {
      return;
    }
    this.lastPlayed.set(id, requestedAt);
    void this.bank.load(context, id).then((buffer) => {
      if (!buffer || this.graph !== graph || context.currentTime - requestedAt > LATE_START_LIMIT) {
        return;
      }
      if (!request.priority && this.voices.size >= MAX_VOICES) {
        return;
      }
      this.startVoice(graph, buffer);
    });
  }

  private startVoice(graph: Graph, buffer: AudioBuffer): void {
    const source = graph.context.createBufferSource();
    source.buffer = buffer;
    source.connect(graph.effects);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
    };
    this.voices.add(source);
    source.start();
  }
}

export function createAudioSystem(options: AudioOptions): AudioSystem {
  return new WebAudioSystem(options);
}
