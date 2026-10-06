import { describe, expect, it } from 'vitest';
import { createGame } from '../../engine';
import { buildPlayerView } from '../../snapshot';
import {
  areMutualAllies,
  isAlly,
  isEnemy,
  isMutualAllyInView,
  isNeutral,
  stanceOf,
  viewStance,
} from '../../systems/diplomacy';
import type { PlayerSetup } from '../../types';
import { GAIA_PLAYER_ID } from '../../types';
import { baseSettings, context, data, run } from '../fixtures';
import { ally, arena, eventsOf } from './fixtures';

const setups: PlayerSetup[] = [
  { id: 0, kind: 'human', civilization: 'greek', team: 1, color: 0x0000ff, difficulty: null },
  { id: 1, kind: 'ai', civilization: 'assyrian', team: 1, color: 0xff0000, difficulty: 'easy' },
  { id: 2, kind: 'ai', civilization: 'greek', team: 2, color: 0x00ff00, difficulty: 'easy' },
  { id: 3, kind: 'ai', civilization: 'greek', team: null, color: 0xffff00, difficulty: 'easy' },
  { id: 4, kind: 'ai', civilization: 'greek', team: null, color: 0xff00ff, difficulty: 'easy' },
];

describe('initial stances', () => {
  it('allies team members and makes teamless players hostile to everyone', () => {
    const state = createGame(baseSettings, setups, data, 3);
    expect(areMutualAllies(state, 0, 1)).toBe(true);
    expect(isEnemy(state, 0, 2)).toBe(true);
    expect(isEnemy(state, 2, 1)).toBe(true);
    for (const other of [0, 1, 2, 4]) {
      expect(isEnemy(state, 3, other)).toBe(true);
      expect(isEnemy(state, other, 3)).toBe(true);
    }
    expect(isEnemy(state, 3, 4)).toBe(true);
  });

  it('treats a player as its own ally and gaia as neutral', () => {
    const state = arena();
    expect(stanceOf(state, 0, 0)).toBe('ally');
    expect(areMutualAllies(state, 1, 1)).toBe(true);
    expect(isNeutral(state, 0, GAIA_PLAYER_ID)).toBe(true);
    expect(isEnemy(state, GAIA_PLAYER_ID, 0)).toBe(false);
  });
});

describe('setStance', () => {
  it('changes only the stance of the issuing player', () => {
    const state = arena();
    const ctx = context();
    const events = run(state, ctx, 1, [
      { type: 'setStance', playerId: 0, targetPlayerId: 1, stance: 'ally' },
    ]);
    expect(isAlly(state, 0, 1)).toBe(true);
    expect(isEnemy(state, 1, 0)).toBe(true);
    expect(areMutualAllies(state, 0, 1)).toBe(false);
    expect(eventsOf(events, 'stanceChanged')).toEqual([
      { type: 'stanceChanged', playerId: 0, targetPlayerId: 1, stance: 'ally' },
    ]);
  });

  it('supports all three stances and becomes mutual when both sides agree', () => {
    const state = arena();
    const ctx = context();
    run(state, ctx, 1, [{ type: 'setStance', playerId: 0, targetPlayerId: 1, stance: 'neutral' }]);
    expect(isNeutral(state, 0, 1)).toBe(true);
    run(state, ctx, 1, [
      { type: 'setStance', playerId: 0, targetPlayerId: 1, stance: 'ally' },
      { type: 'setStance', playerId: 1, targetPlayerId: 0, stance: 'ally' },
    ]);
    expect(areMutualAllies(state, 0, 1)).toBe(true);
    run(state, ctx, 1, [{ type: 'setStance', playerId: 1, targetPlayerId: 0, stance: 'enemy' }]);
    expect(isEnemy(state, 1, 0)).toBe(true);
    expect(isAlly(state, 0, 1)).toBe(true);
  });

  it('emits nothing when the stance does not change', () => {
    const state = arena();
    const events = run(state, context(), 1, [
      { type: 'setStance', playerId: 0, targetPlayerId: 1, stance: 'enemy' },
    ]);
    expect(events).toEqual([]);
  });

  it('is rejected while teams are locked', () => {
    const state = arena({ lockTeams: true });
    const events = run(state, context(), 1, [
      { type: 'setStance', playerId: 0, targetPlayerId: 1, stance: 'ally' },
    ]);
    expect(isEnemy(state, 0, 1)).toBe(true);
    expect(eventsOf(events, 'stanceChanged')).toEqual([]);
    expect(eventsOf(events, 'commandRejected')).toEqual([
      { type: 'commandRejected', playerId: 0, command: 'setStance', reason: 'teams_locked' },
    ]);
  });

  it('rejects a stance toward oneself or an unknown player', () => {
    const state = arena();
    const events = run(state, context(), 1, [
      { type: 'setStance', playerId: 0, targetPlayerId: 0, stance: 'enemy' },
      { type: 'setStance', playerId: 0, targetPlayerId: 7, stance: 'ally' },
    ]);
    expect(eventsOf(events, 'commandRejected').map((event) => event.reason)).toEqual([
      'invalid',
      'invalid',
    ]);
    expect(state.players[0].diplomacy).toEqual({ 1: 'enemy' });
  });
});

describe('view helpers', () => {
  it('report the viewer stance and mutual alliances', () => {
    const state = arena({ players: 3 });
    ally(state, 0, 1);
    state.players[0].diplomacy[2] = 'ally';
    const view = buildPlayerView(state, 0, data);
    expect(viewStance(view, 0)).toBe('ally');
    expect(viewStance(view, 1)).toBe('ally');
    expect(viewStance(view, 2)).toBe('ally');
    expect(isMutualAllyInView(view, 1)).toBe(true);
    expect(isMutualAllyInView(view, 2)).toBe(false);
    expect(viewStance(buildPlayerView(state, 2, data), 0)).toBe('enemy');
  });
});
