import { assetUrl } from '../shared/assetManifest';
import type { WarnOnce } from './sampleBank';

export class MusicPlayer {
  private element: HTMLAudioElement | null = null;
  private node: AudioNode | null = null;
  private readonly failed = new Set<number>();
  private index = 0;
  private loadedIndex = -1;
  private wanted = false;
  private suspended = false;

  constructor(
    private readonly tracks: readonly string[],
    private readonly basePath: string,
    private readonly warn: WarnOnce,
  ) {}

  attach(context: AudioContext, destination: AudioNode): void {
    if (this.element || typeof Audio === 'undefined') {
      return;
    }
    const element = new Audio();
    element.preload = 'auto';
    element.addEventListener('ended', this.onEnded);
    element.addEventListener('error', this.onError);
    this.node = context.createMediaElementSource(element);
    this.node.connect(destination);
    this.element = element;
  }

  start(): void {
    this.wanted = true;
    this.ensurePlaying();
  }

  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) {
      this.element?.pause();
    }
  }

  stop(): void {
    this.wanted = false;
    this.element?.pause();
  }

  ensurePlaying(): void {
    const element = this.element;
    if (!this.wanted || this.suspended || !element || !element.paused || !this.hasPlayableTrack()) {
      return;
    }
    if (this.loadedIndex !== this.index) {
      this.loadedIndex = this.index;
      element.src = assetUrl(this.tracks[this.index] ?? '', this.basePath);
    }
    void Promise.resolve(element.play()).catch(() => {});
  }

  destroy(): void {
    this.wanted = false;
    const element = this.element;
    if (element) {
      element.removeEventListener('ended', this.onEnded);
      element.removeEventListener('error', this.onError);
      element.pause();
    }
    this.node?.disconnect();
    this.element = null;
    this.node = null;
  }

  private hasPlayableTrack(): boolean {
    return this.failed.size < this.tracks.length;
  }

  private readonly onEnded = (): void => {
    this.advance();
  };

  private readonly onError = (): void => {
    const track = this.tracks[this.index];
    if (this.loadedIndex !== this.index || track === undefined) {
      return;
    }
    this.failed.add(this.index);
    this.warn(`music:${track}`, `Audio asset failed to load: music track "${track}"`);
    this.advance();
  };

  private advance(): void {
    const element = this.element;
    if (!element || !this.hasPlayableTrack()) {
      return;
    }
    const count = this.tracks.length;
    for (let step = 1; step <= count; step += 1) {
      const candidate = (this.index + step) % count;
      if (!this.failed.has(candidate)) {
        this.index = candidate;
        break;
      }
    }
    this.loadedIndex = -1;
    element.pause();
    this.ensurePlaying();
  }
}
