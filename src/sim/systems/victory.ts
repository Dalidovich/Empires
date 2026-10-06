import type { BuildingClass, GameData, MapObjectKind } from '../../data/types';
import type { Command } from '../commands';
import { removeEntity } from '../core/entities';
import { setStat } from '../playerStats';
import type { StepContext, System } from '../system';
import type {
  Entity,
  EntityId,
  GameOverReason,
  GameState,
  Player,
  PlayerId,
  VictoryTimer,
  VictoryTimerKind,
} from '../types';
import { areMutualAllies } from './diplomacy';
import { releaseRelics, relicsOfKind } from './relics';

const DEFENSIVE_CLASSES: readonly BuildingClass[] = ['wall', 'tower'];
const WONDER_CLASS: BuildingClass = 'wonder';

interface Claim {
  kind: VictoryTimerKind;
  playerId: PlayerId;
  entityId: EntityId | null;
}

export function countdownTicks(data: GameData): number {
  return Math.round(data.game.victoryCountdownYears * data.game.ticksPerGameYear);
}

function isCompleteBuilding(entity: Entity): boolean {
  return entity.kind === 'building' && entity.buildProgress === 1;
}

function sustainsPlayer(entity: Entity, data: GameData): boolean {
  if (entity.kind === 'unit') {
    return true;
  }
  if (!isCompleteBuilding(entity)) {
    return false;
  }
  const classes = data.buildings[entity.type]?.class ?? [];
  return !classes.some((tag) => DEFENSIVE_CLASSES.includes(tag));
}

function isActive(player: Player | undefined): player is Player {
  return player !== undefined && !player.defeated;
}

function defeat(state: GameState, player: Player, resigned: boolean, ctx: StepContext): void {
  player.defeated = true;
  player.resigned = resigned;
  releaseRelics(state, player.id);
  ctx.events.push({ type: 'playerDefeated', playerId: player.id, resigned });
}

function removeBelongings(state: GameState, playerId: PlayerId, data: GameData): void {
  for (const entity of Object.values(state.entities)) {
    if (entity.owner === playerId && (entity.kind === 'unit' || entity.kind === 'building')) {
      removeEntity(state, entity.id, data);
    }
  }
}

function eliminatePlayers(state: GameState, ctx: StepContext): void {
  const sustaining = state.players.map(() => 0);
  const settled = state.players.map(() => false);
  for (const entity of Object.values(state.entities)) {
    if (!state.players[entity.owner]) {
      continue;
    }
    if (sustainsPlayer(entity, ctx.data)) {
      sustaining[entity.owner] += 1;
    }
    if (isCompleteBuilding(entity) && entity.type === ctx.data.game.start.building) {
      settled[entity.owner] = true;
    }
  }
  for (const player of state.players) {
    if (player.defeated) {
      continue;
    }
    if (settled[player.id] && !player.stats.established) {
      setStat(state, player.id, 'established', 1);
    }
    const settles = state.settings.startMode === 'nomad' || player.stats.established;
    if (sustaining[player.id] === 0 && settles) {
      defeat(state, player, false, ctx);
    }
  }
}

function relicClaim(state: GameState, data: GameData, kind: MapObjectKind): PlayerId | null {
  const relics = relicsOfKind(state, data, kind);
  if (relics.length === 0) {
    return null;
  }
  const owner = relics[0].owner;
  if (!isActive(state.players[owner]) || relics.some((relic) => relic.owner !== owner)) {
    return null;
  }
  return owner;
}

function currentClaims(state: GameState, data: GameData): Claim[] {
  const claims: Claim[] = [];
  const ruins = relicClaim(state, data, 'ruin');
  if (ruins !== null) {
    claims.push({ kind: 'ruins', playerId: ruins, entityId: null });
  }
  const artifacts = relicClaim(state, data, 'artifact');
  if (artifacts !== null) {
    claims.push({ kind: 'artifacts', playerId: artifacts, entityId: null });
  }
  for (const entity of Object.values(state.entities)) {
    if (
      isCompleteBuilding(entity) &&
      isActive(state.players[entity.owner]) &&
      data.buildings[entity.type]?.class.includes(WONDER_CLASS)
    ) {
      claims.push({ kind: 'wonder', playerId: entity.owner, entityId: entity.id });
    }
  }
  return claims;
}

function sameClaim(a: Claim, b: Claim): boolean {
  return a.kind === b.kind && a.playerId === b.playerId && a.entityId === b.entityId;
}

function updateTimers(state: GameState, ctx: StepContext): void {
  const claims = state.settings.victoryMode === 'standard' ? currentClaims(state, ctx.data) : [];
  const kept: VictoryTimer[] = [];
  for (const timer of state.victoryTimers) {
    if (claims.some((claim) => sameClaim(claim, timer))) {
      kept.push(timer);
    } else {
      ctx.events.push({ type: 'victoryTimerReset', kind: timer.kind, playerId: timer.playerId });
    }
  }
  for (const claim of claims) {
    if (kept.some((timer) => sameClaim(claim, timer))) {
      continue;
    }
    const endTick = state.tick + countdownTicks(ctx.data);
    kept.push({ ...claim, startTick: state.tick, endTick });
    ctx.events.push({
      type: 'victoryTimerStarted',
      kind: claim.kind,
      playerId: claim.playerId,
      endTick,
    });
  }
  state.victoryTimers = kept;
}

function withAllies(state: GameState, core: readonly PlayerId[]): PlayerId[] {
  const winners = [...core];
  for (const player of state.players) {
    if (
      !core.includes(player.id) &&
      !player.resigned &&
      core.every((id) => areMutualAllies(state, id, player.id))
    ) {
      winners.push(player.id);
    }
  }
  return winners.sort((a, b) => a - b);
}

function finish(state: GameState, winners: PlayerId[], reason: GameOverReason): void {
  state.outcome = { winners, reason, tick: state.tick };
}

function expiredTimer(state: GameState): VictoryTimer | null {
  let first: VictoryTimer | null = null;
  for (const timer of state.victoryTimers) {
    if (timer.endTick <= state.tick && (first === null || timer.endTick < first.endTick)) {
      first = timer;
    }
  }
  return first;
}

function resolveOutcome(state: GameState): void {
  const defeated = state.players.filter((player) => player.defeated);
  const survivors = state.players.filter((player) => !player.defeated).map((player) => player.id);
  const united = survivors.every((a) => survivors.every((b) => areMutualAllies(state, a, b)));
  if (defeated.length > 0 && survivors.length > 0 && united) {
    finish(state, withAllies(state, survivors), 'conquest');
    return;
  }
  const timer = expiredTimer(state);
  if (timer) {
    finish(state, withAllies(state, [timer.playerId]), timer.kind);
    return;
  }
  if (defeated.some((player) => player.kind === 'human')) {
    finish(state, [], 'human_defeated');
    return;
  }
  if (defeated.length > 0 && survivors.length === 0) {
    finish(state, [], 'conquest');
  }
}

function handleCommand(state: GameState, command: Command, ctx: StepContext): boolean {
  if (command.type !== 'resign') {
    return false;
  }
  const player = state.players[command.playerId];
  if (isActive(player)) {
    removeBelongings(state, player.id, ctx.data);
    defeat(state, player, true, ctx);
  }
  return true;
}

function update(state: GameState, ctx: StepContext): void {
  eliminatePlayers(state, ctx);
  updateTimers(state, ctx);
  resolveOutcome(state);
}

export const victorySystem: System = {
  id: 'victory',
  handleCommand,
  update,
};
