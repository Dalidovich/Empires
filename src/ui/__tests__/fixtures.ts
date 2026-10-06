import type { AudioSystem } from '../../audio/api';
import { loadGameData } from '../../data';
import type { Renderer, ScreenPoint } from '../../render/api';
import type { Command } from '../../sim/commands';
import type { Session } from '../../sim/core/session';
import {
  advanceSession,
  createSession,
  queueCommands,
  saveSession,
  sessionView,
  startSession,
} from '../../sim/core/session';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../../sim/protocol';
import type { EntityView, PlayerView } from '../../sim/snapshot';
import type { EntityId, PlayerSetup, Settings } from '../../sim/types';
import type { SimWorker } from '../context';

export const data = loadGameData();

export const TEST_SETTINGS: Settings = {
  mapType: 'inland',
  mapSize: 'tiny',
  victoryMode: 'conquest',
  populationLimit: 50,
  startingAge: 'stone',
  revealMap: true,
  lockTeams: false,
  speed: 'normal',
};

export const TEST_PLAYERS: PlayerSetup[] = [
  { id: 0, kind: 'human', civilization: 'assyrian', team: null, color: 0x2f6fde, difficulty: null },
  { id: 1, kind: 'ai', civilization: 'greek', team: null, color: 0xd9412f, difficulty: 'moderate' },
];

export function makeView(): PlayerView {
  return structuredClone(sessionView(startSession(TEST_SETTINGS, TEST_PLAYERS, 7, data), 0));
}

let nextId = 100000;

export function addEntity(view: PlayerView, partial: Partial<EntityView> & Pick<EntityView, 'kind' | 'type' | 'owner'>): EntityView {
  nextId += 1;
  const entity: EntityView = {
    id: nextId,
    position: { x: 10, y: 10 },
    facing: 0,
    hp: 100,
    maxHp: 100,
    state: 'idle',
    target: null,
    buildProgress: partial.kind === 'building' ? 1 : null,
    amount: null,
    heldBy: null,
    remembered: false,
    own:
      partial.owner === view.playerId
        ? {
            orders: [],
            standGround: false,
            carry: null,
            faith: null,
            cargo: [],
            queue: [],
            rallyPoint: null,
            research: null,
          }
        : null,
    ...partial,
  };
  view.entities.push(entity);
  return entity;
}

export function ownOf(view: PlayerView, type: string): EntityView[] {
  return view.entities.filter((entity) => entity.owner === view.playerId && entity.type === type);
}

export class FakeWorker implements SimWorker {
  onmessage: ((event: MessageEvent<WorkerToMainMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: MainToWorkerMessage[] = [];
  readonly commands: Command[] = [];
  terminated = false;
  private session: Session | null = null;

  postMessage(message: MainToWorkerMessage): void {
    this.messages.push(message);
    switch (message.type) {
      case 'init':
        this.session = startSession(message.settings, message.players, message.seed, data);
        this.emit({ type: 'ready', viewerId: message.viewerId, tickRate: data.game.tickRate });
        this.snapshot();
        break;
      case 'load':
        this.session = createSession(structuredClone(message.game), data);
        this.emit({ type: 'ready', viewerId: message.viewerId, tickRate: data.game.tickRate });
        this.snapshot();
        break;
      case 'commands':
        this.commands.push(...message.commands);
        if (this.session) {
          queueCommands(this.session, message.commands);
          const events = advanceSession(this.session);
          if (events && events.length > 0) {
            this.emit({ type: 'events', tick: this.session.state.tick, events });
          }
          this.snapshot();
        }
        break;
      case 'saveRequest':
        if (this.session) {
          this.emit({
            type: 'saveResponse',
            requestId: message.requestId,
            game: structuredClone(saveSession(this.session)),
          });
        }
        break;
      default:
        break;
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(message: WorkerToMainMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerToMainMessage>);
  }

  private snapshot(): void {
    if (this.session) {
      this.emit({ type: 'snapshot', view: structuredClone(sessionView(this.session, 0)) });
    }
  }
}

export class FakeRenderer implements Renderer {
  picked: EntityId | null = null;
  inRect: EntityId[] = [];
  selection: EntityId[] = [];
  view: PlayerView | null = null;
  destroyed = false;
  private readonly minimap = document.createElement('canvas');

  attach(): void {}
  applyView(view: PlayerView): void {
    this.view = view;
  }
  render(): void {}
  getCamera() {
    return { x: 0, y: 0, zoom: 1 };
  }
  setCamera(): void {}
  panCamera(): void {}
  centerOn(): void {}
  screenToWorld(point: ScreenPoint) {
    return { x: point.x, y: point.y };
  }
  worldToScreen(world: ScreenPoint) {
    return { x: world.x, y: world.y };
  }
  pickEntity(): EntityId | null {
    return this.picked;
  }
  entitiesInRect(): EntityId[] {
    return this.inRect;
  }
  setSelection(entityIds: readonly EntityId[]): void {
    this.selection = [...entityIds];
  }
  setPlacementGhost(): void {}
  setWallGhost(): void {}
  setDragRect(): void {}
  setRallyMarkers(): void {}
  addPing(): void {}
  getMinimapCanvas(): HTMLCanvasElement {
    return this.minimap;
  }
  minimapToWorld(point: ScreenPoint) {
    return { x: point.x, y: point.y };
  }
  resize(): void {}
  destroy(): void {
    this.destroyed = true;
  }
}

export function silentAudio(): AudioSystem {
  return {
    resume: async () => {},
    handleEvents: () => {},
    playUi: () => {},
    startMusic: () => {},
    stopMusic: () => {},
    setEffectsVolume: () => {},
    setMusicVolume: () => {},
    setMuted: () => {},
    destroy: () => {},
  };
}
