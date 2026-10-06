import type { AudioSystem } from '../audio/api';
import type { GameData } from '../data/types';
import type { CreateRenderer } from '../render/api';
import type { AssetManifest } from '../shared/assetManifest';
import type { GameOverPlayerSummary } from '../sim/events';
import type { MainToWorkerMessage, SerializedGame, WorkerToMainMessage } from '../sim/protocol';
import type { PlayerPublicView } from '../sim/snapshot';
import type { GameOverReason, PlayerId } from '../sim/types';
import type { AppSettings, NewGameSetup, SaveStore } from '../storage/api';

export interface SimWorker {
  postMessage(message: MainToWorkerMessage): void;
  onmessage: ((event: MessageEvent<WorkerToMainMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export type CreateWorker = () => SimWorker;

export interface Screen {
  element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

export interface GameResult {
  viewerId: PlayerId;
  winners: PlayerId[];
  reason: GameOverReason;
  tickRate: number;
  players: PlayerPublicView[];
  summaries: GameOverPlayerSummary[];
}

export type AppErrorKind = 'webgl' | 'renderer' | 'simulation' | 'load_failed';

export type GameStart =
  | { kind: 'new'; setup: NewGameSetup }
  | { kind: 'load'; game: SerializedGame };

export interface AppContext {
  readonly data: GameData;
  readonly manifest: AssetManifest;
  readonly audio: AudioSystem;
  readonly saveStore: SaveStore;
  readonly createRenderer: CreateRenderer;
  readonly createWorker: CreateWorker;
  readonly overlayRoot: HTMLElement;
  getSettings(): AppSettings;
  updateSettings(patch: Partial<AppSettings>): void;
  showMainMenu(): void;
  showSetup(): void;
  showLoad(): void;
  showSettings(): void;
  startGame(start: GameStart): void;
  showSummary(result: GameResult): void;
  showError(kind: AppErrorKind): void;
}
