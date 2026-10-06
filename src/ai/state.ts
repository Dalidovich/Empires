import type { AiDifficulty, ResourceAmounts } from '../data/types';
import { hashSeed, seedRng } from '../sim/rng';
import type { JsonValue, PlayerId, Vec2 } from '../sim/types';

export const AI_STATE_VERSION = 1;

export type ArmyMode = 'home' | 'attack';

export type InvasionPhase = 'idle' | 'board' | 'sail';

export interface BuildIntent {
  building: string;
  x: number;
  y: number;
  tick: number;
}

export interface Assignment {
  targetId: number;
  tick: number;
}

export interface ProbeState {
  unitId: number | null;
  target: Vec2 | null;
  since: number;
}

export interface ArmyState {
  mode: ArmyMode;
  members: number[];
  launchSize: number;
  target: Vec2 | null;
  targetSince: number;
  nextAttackTick: number;
  waves: number;
  swept: number[];
}

export interface TransportLoad {
  transport: number;
  passengers: number[];
}

export interface InvasionState {
  phase: InvasionPhase;
  loads: TransportLoad[];
  target: Vec2 | null;
  since: number;
  landings: number;
}

export interface CollectorState {
  unitId: number | null;
  objectId: number | null;
}

export interface AiState {
  version: number;
  difficulty: AiDifficulty;
  rngState: number;
  home: Vec2 | null;
  attackAgeTick: number | null;
  ageSeen: number;
  ageTick: number;
  contactTick: number;
  lastResources: ResourceAmounts | null;
  tributeCredit: Record<string, number>;
  stanceSteps: Record<string, number>;
  grudgeTick: Record<string, number>;
  intents: BuildIntent[];
  badTiles: number[];
  badTargets: number[];
  assigned: Record<string, Assignment>;
  foundationSeen: Record<string, number>;
  visited: number[];
  scout: ProbeState;
  prospector: ProbeState;
  prospectIndex: number;
  navalScout: ProbeState;
  army: ArmyState;
  navy: ArmyState;
  invasion: InvasionState;
  collector: CollectorState;
  scoreSeen: number;
  scoreTick: number;
}

function emptyArmy(): ArmyState {
  return {
    mode: 'home',
    members: [],
    launchSize: 0,
    target: null,
    targetSince: 0,
    nextAttackTick: 0,
    waves: 0,
    swept: [],
  };
}

export function createAiState(playerId: PlayerId, difficulty: AiDifficulty): AiState {
  return {
    version: AI_STATE_VERSION,
    difficulty,
    rngState: seedRng(hashSeed(`ai:${playerId}:${difficulty}`)),
    home: null,
    attackAgeTick: null,
    ageSeen: 0,
    ageTick: 0,
    contactTick: 0,
    lastResources: null,
    tributeCredit: {},
    stanceSteps: {},
    grudgeTick: {},
    intents: [],
    badTiles: [],
    badTargets: [],
    assigned: {},
    foundationSeen: {},
    visited: [],
    scout: { unitId: null, target: null, since: 0 },
    prospector: { unitId: null, target: null, since: 0 },
    prospectIndex: 0,
    navalScout: { unitId: null, target: null, since: 0 },
    army: emptyArmy(),
    navy: emptyArmy(),
    invasion: { phase: 'idle', loads: [], target: null, since: 0, landings: 0 },
    collector: { unitId: null, objectId: null },
    scoreSeen: 0,
    scoreTick: 0,
  };
}

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function restoreAiState(
  playerId: PlayerId,
  difficulty: AiDifficulty,
  saved: JsonValue | undefined,
): AiState {
  const fresh = createAiState(playerId, difficulty);
  if (!isRecord(saved) || saved.version !== AI_STATE_VERSION) {
    return fresh;
  }
  const copy = JSON.parse(JSON.stringify(saved)) as Partial<AiState>;
  return { ...fresh, ...copy, difficulty };
}

export function serializeAiState(state: AiState): JsonValue {
  return JSON.parse(JSON.stringify(state)) as JsonValue;
}
