import { loadGameData } from '../data';
import type { Session } from './core/session';
import {
  advanceSession,
  createSession,
  queueCommands,
  saveSession,
  sessionView,
  startSession,
} from './core/session';
import type { MainToWorkerMessage, SimErrorCode, WorkerToMainMessage } from './protocol';
import { deserialize } from './serialize';
import type { PlayerId } from './types';

interface WorkerScope {
  onmessage: ((event: { data: MainToWorkerMessage }) => void) | null;
  postMessage(message: WorkerToMainMessage): void;
}

interface Host {
  session: Session;
  viewerId: PlayerId;
  timer: ReturnType<typeof setTimeout> | null;
  lastTime: number;
  debt: number;
}

const MAX_TICKS_PER_PUMP = 5;

const scope = self as unknown as WorkerScope;

let host: Host | null = null;

function post(message: WorkerToMainMessage): void {
  scope.postMessage(message);
}

function reportError(code: SimErrorCode, error: unknown, tick: number): void {
  post({
    type: 'error',
    code,
    tick,
    message: error instanceof Error ? error.message : String(error),
  });
}

function stopHost(): number {
  const tick = host?.session.state.tick ?? 0;
  if (host?.timer != null) {
    clearTimeout(host.timer);
  }
  host = null;
  return tick;
}

function tickInterval(session: Session): number {
  const rules = session.data.game;
  return 1000 / (rules.tickRate * rules.speedMultipliers[session.state.settings.speed]);
}

function pump(current: Host): void {
  const now = performance.now();
  current.debt += now - current.lastTime;
  current.lastTime = now;
  let changed = false;
  for (let ran = 0; ran < MAX_TICKS_PER_PUMP; ran++) {
    const interval = tickInterval(current.session);
    if (current.debt < interval) {
      break;
    }
    current.debt -= interval;
    const events = advanceSession(current.session);
    if (events === null) {
      continue;
    }
    changed = true;
    if (events.length > 0) {
      post({ type: 'events', tick: current.session.state.tick, events });
    }
  }
  const interval = tickInterval(current.session);
  if (current.debt > interval * MAX_TICKS_PER_PUMP) {
    current.debt = 0;
  }
  if (changed) {
    post({ type: 'snapshot', view: sessionView(current.session, current.viewerId) });
  }
}

function schedule(current: Host): void {
  const delay = Math.max(0, tickInterval(current.session) - current.debt);
  current.timer = setTimeout(() => {
    if (host !== current) {
      return;
    }
    try {
      pump(current);
      schedule(current);
    } catch (error) {
      reportError('simulation_error', error, stopHost());
    }
  }, delay);
}

function run(session: Session, viewerId: PlayerId): void {
  stopHost();
  if (!session.state.players[viewerId]) {
    throw new Error(`Unknown viewer: ${viewerId}`);
  }
  const current: Host = {
    session,
    viewerId,
    timer: null,
    lastTime: performance.now(),
    debt: 0,
  };
  host = current;
  post({ type: 'ready', viewerId, tickRate: session.data.game.tickRate });
  post({ type: 'snapshot', view: sessionView(session, viewerId) });
  schedule(current);
}

function handleMessage(message: MainToWorkerMessage): void {
  switch (message.type) {
    case 'init': {
      const data = loadGameData();
      run(startSession(message.settings, message.players, message.seed, data), message.viewerId);
      return;
    }
    case 'load':
      run(createSession(deserialize(message.game), loadGameData()), message.viewerId);
      return;
    case 'commands':
      if (host) {
        queueCommands(host.session, message.commands);
      }
      return;
    case 'saveRequest':
      if (host) {
        post({ type: 'saveResponse', requestId: message.requestId, game: saveSession(host.session) });
      }
      return;
    case 'stop':
      stopHost();
      return;
    default:
      reportError('invalid_message', 'Unknown message type', host?.session.state.tick ?? 0);
  }
}

scope.onmessage = (event) => {
  try {
    handleMessage(event.data);
  } catch (error) {
    if (event.data?.type === 'load') {
      reportError('load_failed', error, host?.session.state.tick ?? 0);
    } else {
      reportError('simulation_error', error, stopHost());
    }
  }
};
