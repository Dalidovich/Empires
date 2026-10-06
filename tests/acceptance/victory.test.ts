import { describe, expect, it } from 'vitest';
import { killEntity, removeEntity } from '../../src/sim/core/entities';
import { step } from '../../src/sim/engine';
import type { SimEvent } from '../../src/sim/events';
import type { Entity, GameState } from '../../src/sim/types';
import { addBuilding, addUnit, context, data } from '../../src/sim/__tests__/fixtures';
import {
  COUNTDOWN,
  addBases,
  addRelic,
  arena,
  eventsOf,
} from '../../src/sim/__tests__/victory/fixtures';

const LONG_TEST_MS = 180000;

function standard(): GameState {
  const state = arena({ players: 2, mode: 'standard' });
  addBases(state);
  return state;
}

function play(state: GameState, ticks: number, stop: () => boolean = () => false): SimEvent[] {
  const ctx = context();
  const events: SimEvent[] = [];
  for (let tick = 0; tick < ticks && !stop(); tick++) {
    events.push(...step(state, [], ctx));
  }
  return events;
}

function playToEnd(state: GameState): SimEvent[] {
  return play(state, COUNTDOWN + 50, () => state.outcome !== null);
}

function expectVictory(state: GameState, events: readonly SimEvent[], reason: string, endTick: number): void {
  expect(state.outcome).toEqual({ winners: [0], reason, tick: endTick });
  const over = eventsOf(events, 'gameOver');
  expect(over).toHaveLength(1);
  expect(over[0].winners).toEqual([0]);
  expect(over[0].reason).toBe(reason);
  expect(over[0].players.map((player) => player.winner)).toEqual([true, false]);
}

describe('criterion 4: victory conditions', { timeout: LONG_TEST_MS }, () => {
  it('counts 2000 game years', () => {
    expect(data.game.victoryCountdownYears).toBe(2000);
    expect(COUNTDOWN).toBe(2000 * data.game.ticksPerGameYear);
  });

  it('conquest: destroying everything the enemy owns ends the game', () => {
    const state = arena({ players: 2, mode: 'conquest' });
    const [, enemyBase] = addBases(state);
    const lastVillager = addUnit(state, 'villager', 1, enemyBase.position.x + 4, enemyBase.position.y);
    lastVillager.standGround = true;
    const army: Entity[] = [];
    for (let index = 0; index < 10; index++) {
      army.push(addUnit(state, 'axeman', 0, enemyBase.position.x - 3 + index * 0.7, enemyBase.position.y + 4));
    }
    const ctx = context();
    const ids = army.map((unit) => unit.id);
    const events = step(
      state,
      [
        { type: 'attack', playerId: 0, entityIds: ids, targetId: lastVillager.id, queued: false },
        { type: 'attack', playerId: 0, entityIds: ids, targetId: enemyBase.id, queued: true },
      ],
      ctx,
    );
    events.push(...play(state, 8000, () => state.outcome !== null));
    expect(eventsOf(events, 'entityDied').map((event) => event.entityId).sort()).toEqual(
      [lastVillager.id, enemyBase.id].sort(),
    );
    expect(eventsOf(events, 'playerDefeated')).toEqual([
      { type: 'playerDefeated', playerId: 1, resigned: false },
    ]);
    expect(state.outcome?.winners).toEqual([0]);
    expect(state.outcome?.reason).toBe('conquest');
    expect(eventsOf(events, 'gameOver')[0].players[0].stats.buildingsRazed).toBe(1);
    expect(eventsOf(events, 'gameOver')[0].players[0].stats.unitsKilled).toBe(1);
  });

  it('conquest stays the only way to win in conquest mode', () => {
    const state = arena({ players: 2, mode: 'conquest' });
    addBases(state);
    addBuilding(state, 'wonder', 0, 22, 22);
    addRelic(state, 'ruin', 24, 34);
    addUnit(state, 'villager', 0, 26.5, 34.5);
    play(state, 50);
    expect(state.victoryTimers).toEqual([]);
    expect(state.outcome).toBeNull();
  });

  it('ruins: holding every ruin for 2000 years wins', () => {
    const state = standard();
    addRelic(state, 'ruin', 24, 24);
    addRelic(state, 'ruin', 24, 34);
    addUnit(state, 'villager', 0, 26.5, 24.5);
    addUnit(state, 'villager', 0, 26.5, 34.5);
    const events = playToEnd(state);
    expect(eventsOf(events, 'victoryTimerStarted')).toEqual([
      { type: 'victoryTimerStarted', kind: 'ruins', playerId: 0, endTick: COUNTDOWN },
    ]);
    expectVictory(state, events, 'ruins', COUNTDOWN);
  });

  it('artifacts: holding every artifact for 2000 years wins', () => {
    const state = standard();
    addRelic(state, 'artifact', 24.5, 24.5);
    addRelic(state, 'artifact', 24.5, 34.5);
    addUnit(state, 'villager', 0, 25.5, 24.5);
    addUnit(state, 'villager', 0, 25.5, 34.5);
    const events = playToEnd(state);
    expect(eventsOf(events, 'victoryTimerStarted')).toEqual([
      { type: 'victoryTimerStarted', kind: 'artifacts', playerId: 0, endTick: COUNTDOWN },
    ]);
    expectVictory(state, events, 'artifacts', COUNTDOWN);
  });

  it('wonder: a wonder standing for 2000 years wins', () => {
    const state = standard();
    addBuilding(state, 'wonder', 0, 22, 22);
    const events = playToEnd(state);
    expect(eventsOf(events, 'victoryTimerStarted')).toEqual([
      { type: 'victoryTimerStarted', kind: 'wonder', playerId: 0, endTick: COUNTDOWN },
    ]);
    expectVictory(state, events, 'wonder', COUNTDOWN);
  });
});

describe('criterion 4: the countdown resets when the condition is lost', { timeout: LONG_TEST_MS }, () => {
  const HELD = 9000;

  it('ruins', () => {
    const state = standard();
    addRelic(state, 'ruin', 24, 24);
    const contested = addRelic(state, 'ruin', 24, 34);
    addUnit(state, 'villager', 0, 26.5, 24.5);
    const keeper = addUnit(state, 'villager', 0, 26.5, 34.5);
    play(state, HELD);
    expect(state.victoryTimers).toHaveLength(1);

    removeEntity(state, keeper.id, data);
    const rival = addUnit(state, 'villager', 1, 21.5, 34.5);
    const lost = play(state, 1);
    expect(contested.owner).toBe(1);
    expect(eventsOf(lost, 'victoryTimerReset')).toEqual([
      { type: 'victoryTimerReset', kind: 'ruins', playerId: 0 },
    ]);
    expect(state.victoryTimers).toEqual([]);

    removeEntity(state, rival.id, data);
    addUnit(state, 'villager', 0, 26.5, 34.5);
    const restart = state.tick;
    const regained = play(state, 1);
    expect(eventsOf(regained, 'victoryTimerStarted')).toEqual([
      { type: 'victoryTimerStarted', kind: 'ruins', playerId: 0, endTick: restart + COUNTDOWN },
    ]);
    play(state, COUNTDOWN - HELD + 5);
    expect(state.tick).toBeGreaterThan(COUNTDOWN);
    expect(state.outcome).toBeNull();
    const events = playToEnd(state);
    expectVictory(state, events, 'ruins', restart + COUNTDOWN);
  });

  it('artifacts', () => {
    const state = standard();
    addRelic(state, 'artifact', 24.5, 24.5);
    const contested = addRelic(state, 'artifact', 24.5, 34.5);
    addUnit(state, 'villager', 0, 25.5, 24.5);
    const guard = addUnit(state, 'villager', 0, 25.5, 34.5);
    play(state, HELD);
    expect(state.victoryTimers.map((timer) => timer.kind)).toEqual(['artifacts']);

    removeEntity(state, guard.id, data);
    const thief = addUnit(state, 'villager', 1, 23.5, 34.5);
    const lost = play(state, 1);
    expect(contested.owner).toBe(1);
    expect(eventsOf(lost, 'victoryTimerReset')).toEqual([
      { type: 'victoryTimerReset', kind: 'artifacts', playerId: 0 },
    ]);

    removeEntity(state, thief.id, data);
    play(state, 1);
    addUnit(state, 'villager', 0, contested.position.x + 1, contested.position.y);
    const restart = state.tick;
    const regained = play(state, 1);
    expect(contested.owner).toBe(0);
    expect(eventsOf(regained, 'victoryTimerStarted')).toEqual([
      { type: 'victoryTimerStarted', kind: 'artifacts', playerId: 0, endTick: restart + COUNTDOWN },
    ]);
    play(state, COUNTDOWN - HELD + 5);
    expect(state.outcome).toBeNull();
    const events = playToEnd(state);
    expectVictory(state, events, 'artifacts', restart + COUNTDOWN);
  });

  it('wonder', () => {
    const state = standard();
    const first = addBuilding(state, 'wonder', 0, 22, 22);
    play(state, HELD);
    const ctx = context();
    killEntity(state, first.id, ctx, 1);
    const lost = play(state, 1);
    expect(eventsOf(lost, 'victoryTimerReset')).toEqual([
      { type: 'victoryTimerReset', kind: 'wonder', playerId: 0 },
    ]);
    expect(state.victoryTimers).toEqual([]);
    play(state, COUNTDOWN - HELD + 5);
    expect(state.outcome).toBeNull();

    const second = addBuilding(state, 'wonder', 0, 22, 22);
    const restart = state.tick;
    const rebuilt = play(state, 1);
    expect(eventsOf(rebuilt, 'victoryTimerStarted')).toEqual([
      { type: 'victoryTimerStarted', kind: 'wonder', playerId: 0, endTick: restart + COUNTDOWN },
    ]);
    expect(state.victoryTimers[0].entityId).toBe(second.id);
    const events = playToEnd(state);
    expectVictory(state, events, 'wonder', restart + COUNTDOWN);
  });
});
