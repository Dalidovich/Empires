import type { GameData, GameSpeed } from '../../data/types';
import type { Command } from '../../sim/commands';
import type { SimEvent } from '../../sim/events';
import type {
  MainToWorkerMessage,
  SerializedGame,
  SimErrorCode,
  WorkerToMainMessage,
} from '../../sim/protocol';
import type { PlayerView } from '../../sim/snapshot';
import type { PlayerId } from '../../sim/types';
import type { GameStart, SimWorker } from '../context';
import { clamp01 } from '../format';

export const SPEED_ORDER: readonly GameSpeed[] = ['slow', 'normal', 'fast'];

export const SAVE_TIMEOUT_MS = 10000;

export interface SessionListener {
  onView(view: PlayerView): void;
  onEvents(events: SimEvent[]): void;
  onError(code: SimErrorCode): void;
}

interface PendingSave {
  resolve(game: SerializedGame): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class GameSession {
  view: PlayerView | null = null;
  private readonly pendingSaves = new Map<number, PendingSave>();
  private nextRequestId = 1;
  private lastSnapshotAt = 0;
  private stopped = false;

  constructor(
    private readonly worker: SimWorker,
    private readonly data: GameData,
    private readonly viewerId: PlayerId,
    private readonly listener: SessionListener,
    private readonly now: () => number = () => performance.now(),
  ) {
    worker.onmessage = (event) => this.handle(event.data);
    worker.onerror = (event) => {
      console.error(`Simulation worker failed: ${event.message}`);
      this.fail('simulation_error');
    };
  }

  begin(start: GameStart): void {
    if (start.kind === 'new') {
      this.post({
        type: 'init',
        settings: start.setup.settings,
        players: start.setup.players,
        seed: start.setup.seed,
        viewerId: this.viewerId,
      });
    } else {
      this.post({ type: 'load', game: start.game, viewerId: this.viewerId });
    }
  }

  send(commands: readonly Command[]): void {
    if (commands.length > 0) {
      this.post({ type: 'commands', commands: [...commands] });
    }
  }

  setSpeed(speed: GameSpeed): void {
    this.send([{ type: 'setSpeed', playerId: this.viewerId, speed }]);
  }

  shiftSpeed(direction: number): void {
    const current = SPEED_ORDER.indexOf(this.view?.speed ?? 'normal');
    const next = SPEED_ORDER[Math.min(SPEED_ORDER.length - 1, Math.max(0, current + direction))];
    if (next !== this.view?.speed) {
      this.setSpeed(next);
    }
  }

  cycleSpeed(): void {
    const current = SPEED_ORDER.indexOf(this.view?.speed ?? 'normal');
    this.setSpeed(SPEED_ORDER[(current + 1) % SPEED_ORDER.length]);
  }

  setPaused(paused: boolean): void {
    this.send([{ type: 'pause', playerId: this.viewerId, paused }]);
  }

  requestSave(): Promise<SerializedGame> {
    return new Promise((resolve, reject) => {
      if (this.stopped) {
        reject(new Error('stopped'));
        return;
      }
      const requestId = this.nextRequestId;
      this.nextRequestId += 1;
      const timer = setTimeout(() => {
        this.pendingSaves.delete(requestId);
        reject(new Error('timeout'));
      }, SAVE_TIMEOUT_MS);
      this.pendingSaves.set(requestId, { resolve, reject, timer });
      this.post({ type: 'saveRequest', requestId });
    });
  }

  interpolation(): number {
    const view = this.view;
    if (!view || view.paused || view.outcome !== null) {
      return 1;
    }
    const rules = this.data.game;
    const interval = 1000 / (rules.tickRate * rules.speedMultipliers[view.speed]);
    return clamp01((this.now() - this.lastSnapshotAt) / interval);
  }

  stop(): void {
    if (this.stopped) {
      return;
    }
    this.post({ type: 'stop' });
    this.stopped = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    for (const pending of this.pendingSaves.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('stopped'));
    }
    this.pendingSaves.clear();
  }

  private post(message: MainToWorkerMessage): void {
    if (!this.stopped) {
      this.worker.postMessage(message);
    }
  }

  private fail(code: SimErrorCode): void {
    if (!this.stopped) {
      this.listener.onError(code);
    }
  }

  private handle(message: WorkerToMainMessage): void {
    if (this.stopped) {
      return;
    }
    switch (message.type) {
      case 'snapshot':
        this.view = message.view;
        this.lastSnapshotAt = this.now();
        this.listener.onView(message.view);
        break;
      case 'events':
        this.listener.onEvents(message.events);
        break;
      case 'saveResponse': {
        const pending = this.pendingSaves.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingSaves.delete(message.requestId);
          pending.resolve(message.game);
        }
        break;
      }
      case 'error':
        console.error(`Simulation error at tick ${message.tick}: ${message.message}`);
        this.fail(message.code);
        break;
      default:
        break;
    }
  }
}
