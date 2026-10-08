import { RESOURCE_KINDS } from '../data/types';
import type { PlayerView } from '../sim/snapshot';
import type { PlayerId, Stance } from '../sim/types';
import type { Think } from './context';
import { dist } from './context';
import type { AiState } from './state';

const TRIBUTE_JUMP = 50;
const GRUDGE_TICKS = 6000;
const PROJECTILE_HIT_RADIUS = 1.5;
const STANCE_LADDER: readonly Stance[] = ['enemy', 'neutral', 'ally'];

export function observeTribute(view: PlayerView, state: AiState): void {
  if (view.settings.lockTeams) {
    return;
  }
  const resources = view.self.resources;
  const last = state.lastResources;
  if (last !== null && view.self.sandboxGrantTick !== view.tick) {
    let received = 0;
    for (const kind of RESOURCE_KINDS) {
      const gain = resources[kind] - last[kind];
      if (gain >= TRIBUTE_JUMP) {
        received += gain;
      }
    }
    if (received > 0) {
      const donors = view.players.filter(
        (player) => player.kind === 'human' && player.id !== view.playerId && !player.defeated,
      );
      for (const donor of donors) {
        const key = String(donor.id);
        state.tributeCredit[key] = (state.tributeCredit[key] ?? 0) + received / donors.length;
      }
    }
  }
  state.lastResources = { ...resources };
}

function setStance(think: Think, target: PlayerId, stance: Stance): void {
  if ((think.view.self.diplomacy[target] ?? 'enemy') === stance) {
    return;
  }
  think.commands.push({
    type: 'setStance',
    playerId: think.me,
    targetPlayerId: target,
    stance,
  });
}

function aggressors(think: Think): Set<PlayerId> {
  const found = new Set<PlayerId>();
  for (const entity of think.view.entities) {
    if (entity.owner === think.me || entity.owner < 0 || entity.target === null) {
      continue;
    }
    if (entity.kind !== 'unit' && entity.kind !== 'building') {
      continue;
    }
    if (entity.kind === 'unit' && entity.state !== 'attacking') {
      continue;
    }
    const victim = think.byId.get(entity.target);
    if (victim && victim.owner === think.me) {
      found.add(entity.owner);
    }
  }
  const mine = [...think.buildings, ...think.villagers, ...think.soldiers];
  for (const projectile of think.view.projectiles) {
    if (projectile.owner === think.me || projectile.owner < 0 || found.has(projectile.owner)) {
      continue;
    }
    if (mine.some((entity) => dist(entity.position, projectile.destination) <= PROJECTILE_HIT_RADIUS)) {
      found.add(projectile.owner);
    }
  }
  return found;
}

export function manageDiplomacy(think: Think): void {
  if (think.view.settings.lockTeams) {
    return;
  }
  const state = think.state;
  for (const owner of aggressors(think)) {
    const key = String(owner);
    state.grudgeTick[key] = think.tick;
    state.tributeCredit[key] = 0;
    state.stanceSteps[key] = 0;
    setStance(think, owner, 'enemy');
  }
  for (const key of Object.keys(state.tributeCredit)) {
    const owner = Number(key);
    const other = think.view.players[owner];
    if (!other || other.defeated || owner === think.me) {
      continue;
    }
    const grudge = state.grudgeTick[key];
    if (grudge !== undefined && think.tick - grudge < GRUDGE_TICKS) {
      continue;
    }
    while (state.tributeCredit[key] >= think.params.tributePerStanceStep) {
      state.tributeCredit[key] -= think.params.tributePerStanceStep;
      state.stanceSteps[key] = (state.stanceSteps[key] ?? 0) + 1;
    }
    const steps = state.stanceSteps[key] ?? 0;
    if (steps <= 0) {
      continue;
    }
    const current = STANCE_LADDER.indexOf(think.view.self.diplomacy[owner] ?? 'enemy');
    const wanted = Math.min(STANCE_LADDER.length - 1, current + steps);
    state.stanceSteps[key] = 0;
    setStance(think, owner, STANCE_LADDER[wanted]);
  }
}
