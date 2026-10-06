import type { AiDifficulty, GameData } from '../data/types';
import type { Command } from '../sim/commands';
import type { PlayerView } from '../sim/snapshot';
import type { JsonValue, PlayerId } from '../sim/types';
import { MAX_PLAYERS } from '../sim/types';
import type { AiController } from './api';
import type { Think } from './context';
import { createThink, dist } from './context';
import { manageDiplomacy, observeTribute } from './diplomacy';
import { manageEconomy } from './economy';
import { manageMilitary } from './military';
import { holdTransportFunds, manageNavy } from './naval';
import { resolveParams } from './params';
import { manageRelics } from './relics';
import { chooseRoster } from './roster';
import { manageScouting } from './scouting';
import { restoreAiState, serializeAiState } from './state';
import { manageStrategy, planAgeAdvance } from './strategy';

export type { AiController, CreateAi } from './api';

const INTENT_TIMEOUT_TICKS = 60;
const MAX_BAD_TILES = 300;

function decisionPhase(playerId: PlayerId, interval: number): number {
  if (interval <= 1) {
    return 0;
  }
  const slot = Math.floor(((playerId % MAX_PLAYERS) * (interval - 1)) / MAX_PLAYERS);
  return 1 + slot;
}

function settleIntents(think: Think): void {
  const state = think.state;
  const kept = [];
  for (const intent of state.intents) {
    const size = think.data.buildings[intent.building]?.size ?? 1;
    const center = { x: intent.x + size / 2, y: intent.y + size / 2 };
    const placed = [...think.foundations, ...think.buildings].some(
      (building) => building.type === intent.building && dist(building.position, center) < 0.5,
    );
    if (placed) {
      continue;
    }
    if (think.tick - intent.tick <= INTENT_TIMEOUT_TICKS) {
      kept.push(intent);
      continue;
    }
    state.badTiles.push(intent.y * think.size + intent.x);
    if (state.badTiles.length > MAX_BAD_TILES) {
      state.badTiles.shift();
    }
  }
  state.intents = kept;
}

export function createAi(
  playerId: PlayerId,
  difficulty: AiDifficulty,
  data: GameData,
  savedState?: JsonValue,
): AiController {
  const state = restoreAiState(playerId, difficulty, savedState);
  const level = data.aiLevels[state.difficulty];
  const params = resolveParams(level);
  const interval = Math.max(1, level.decisionIntervalTicks);
  const phase = decisionPhase(playerId, interval);

  let watchesEveryTick = true;

  function think(view: PlayerView, tick: number): Command[] {
    watchesEveryTick = !view.settings.lockTeams;
    observeTribute(view, state);
    if (view.outcome !== null || view.paused || view.players[playerId]?.defeated !== false) {
      return [];
    }
    if (tick % interval !== phase) {
      return [];
    }
    const context = createThink(view, data, level, params, state);
    settleIntents(context);
    holdTransportFunds(context);
    planAgeAdvance(context);
    manageEconomy(context);
    const roster = chooseRoster(context.know);
    manageStrategy(context, roster);
    manageMilitary(context, roster);
    manageNavy(context);
    manageScouting(context);
    manageRelics(context);
    manageDiplomacy(context);
    return context.commands;
  }

  return {
    playerId,
    think,
    serialize: () => serializeAiState(state),
    needsView: (tick) => watchesEveryTick || tick % interval === phase,
  };
}
