import type { AssetManifest } from '../shared/assetManifest';
import type { SimEvent } from '../sim/events';
import type { PlayerId, Vec2 } from '../sim/types';
import type { AgeId } from '../data/types';

export interface ListenerViewport {
  playerId: PlayerId;
  center: Vec2;
  halfWidth: number;
  halfHeight: number;
}

export type UiSound =
  | 'click'
  | 'select'
  | 'acknowledge'
  | 'error'
  | 'victory'
  | 'defeat';

export interface UiSoundOptions {
  entityType?: string;
}

export interface AudioOptions {
  manifest: AssetManifest;
  assetBasePath?: string;
}

export interface AudioSystem {
  resume(): Promise<void>;
  handleEvents(events: readonly SimEvent[], listener: ListenerViewport): void;
  playUi(sound: UiSound, options?: UiSoundOptions): void;
  startMusic(): void;
  stopMusic(): void;
  setEffectsVolume(volume: number): void;
  setMusicVolume(volume: number): void;
  setMuted(muted: boolean): void;
  destroy(): void;
  setMusicAge?(age: AgeId): void;
}

export type CreateAudioSystem = (options: AudioOptions) => AudioSystem;
