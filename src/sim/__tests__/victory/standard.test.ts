import { describe, expect, it } from 'vitest';
import { removeEntity } from '../../core/entities';
import { distance } from '../../core/geometry';
import { setEntityPosition } from '../../core/spatial';
import { buildPlayerView } from '../../snapshot';
import type { GameState } from '../../types';
import { GAIA_PLAYER_ID } from '../../types';
import { addBuilding, addUnit, context, data, run, runUntil } from '../fixtures';
import { COUNTDOWN, addBases, addRelic, ally, arena, eventsOf } from './fixtures';

function standard(players = 2): GameState {
  const state = arena({ players, mode: 'standard' });
  addBases(state);
  return state;
}

function skipToLastTick(state: GameState): void {
  state.tick = Math.min(...state.victoryTimers.map((timer) => timer.endTick)) - 1;
}

describe('countdown length', () => {
  it('is 2000 game years, ten minutes at normal speed', () => {
    const { tickRate, speedMultipliers, ticksPerGameYear } = data.game;
    expect(COUNTDOWN).toBe(2000 * ticksPerGameYear);
    expect(COUNTDOWN / (tickRate * speedMultipliers.normal)).toBeCloseTo(600, 0);
  });
});

describe('ruins', () => {
  it('belong to the player whose unit was next to them last', () => {
    const state = standard();
    const ctx = context();
    const ruin = addRelic(state, 'ruin', 24, 24);
    addRelic(state, 'ruin', 40, 40);
    const scout = addUnit(state, 'villager', 0, 26.5, 24.5);
    const events = run(state, ctx, 1);
    expect(ruin.owner).toBe(0);
    expect(eventsOf(events, 'relicCaptured')).toEqual([
      {
        type: 'relicCaptured',
        entityId: ruin.id,
        entityType: 'ruin',
        playerId: 0,
        position: { x: 24, y: 24 },
      },
    ]);

    setEntityPosition(state, scout, 26.5, 40.5);
    run(state, ctx, 2);
    expect(ruin.owner).toBe(0);

    const rival = addUnit(state, 'villager', 1, 21.5, 24.5);
    run(state, ctx, 1);
    expect(ruin.owner).toBe(1);
    setEntityPosition(state, rival, 10.5, 30.5);
    run(state, ctx, 2);
    expect(ruin.owner).toBe(1);
  });

  it('stay with the owner while its unit is present and ignore allied visitors', () => {
    const state = standard(3);
    const ctx = context();
    ally(state, 0, 2);
    const ruin = addRelic(state, 'ruin', 24, 24);
    const keeper = addUnit(state, 'villager', 0, 26.5, 24.5);
    run(state, ctx, 1);
    addUnit(state, 'villager', 1, 21.5, 24.5);
    addUnit(state, 'villager', 2, 24.5, 26.5);
    run(state, ctx, 1);
    expect(ruin.owner).toBe(0);
    removeEntity(state, keeper.id, data);
    run(state, ctx, 1);
    expect(ruin.owner).toBe(1);
  });

  it('win the game after all of them are held for 2000 years', () => {
    const state = standard();
    const ctx = context();
    addRelic(state, 'ruin', 24, 24);
    addRelic(state, 'ruin', 24, 34);
    addUnit(state, 'villager', 0, 26.5, 24.5);
    expect(eventsOf(run(state, ctx, 1), 'victoryTimerStarted')).toEqual([]);
    expect(state.victoryTimers).toEqual([]);

    addUnit(state, 'villager', 0, 26.5, 34.5);
    const startTick = state.tick;
    const started = eventsOf(run(state, ctx, 1), 'victoryTimerStarted');
    const endTick = startTick + COUNTDOWN;
    expect(started).toEqual([{ type: 'victoryTimerStarted', kind: 'ruins', playerId: 0, endTick }]);
    const timer = { kind: 'ruins', playerId: 0, entityId: null, startTick, endTick };
    expect(buildPlayerView(state, 0, data).victoryTimers).toEqual([timer]);
    expect(buildPlayerView(state, 1, data).victoryTimers).toEqual([timer]);

    runUntil(state, ctx, COUNTDOWN - 1, () => state.outcome !== null);
    expect(state.outcome).toBeNull();
    expect(state.tick).toBe(endTick);
    const events = run(state, ctx, 1);
    expect(state.outcome).toEqual({ winners: [0], reason: 'ruins', tick: endTick });
    expect(eventsOf(events, 'gameOver')[0].reason).toBe('ruins');
  });

  it('reset the countdown when one of them is lost', () => {
    const state = standard();
    const ctx = context();
    addRelic(state, 'ruin', 24, 24);
    const second = addRelic(state, 'ruin', 24, 34);
    addUnit(state, 'villager', 0, 26.5, 24.5);
    const keeper = addUnit(state, 'villager', 0, 26.5, 34.5);
    run(state, ctx, 100);
    expect(state.victoryTimers).toHaveLength(1);

    setEntityPosition(state, keeper, 40.5, 40.5);
    const rival = addUnit(state, 'villager', 1, 21.5, 34.5);
    const events = run(state, ctx, 1);
    expect(second.owner).toBe(1);
    expect(eventsOf(events, 'victoryTimerReset')).toEqual([
      { type: 'victoryTimerReset', kind: 'ruins', playerId: 0 },
    ]);
    expect(state.victoryTimers).toEqual([]);

    removeEntity(state, rival.id, data);
    setEntityPosition(state, keeper, 26.5, 34.5);
    const restartTick = state.tick;
    run(state, ctx, 1);
    expect(state.victoryTimers).toHaveLength(1);
    expect(state.victoryTimers[0].startTick).toBe(restartTick);
    expect(state.victoryTimers[0].endTick).toBe(restartTick + COUNTDOWN);
  });
});

describe('artifacts', () => {
  it('are captured by an approaching unit and follow it', () => {
    const state = standard();
    const ctx = context();
    const artifact = addRelic(state, 'artifact', 24.5, 24.5);
    const carrier = addUnit(state, 'villager', 0, 25.5, 24.5);
    const events = run(state, ctx, 1);
    expect(artifact.owner).toBe(0);
    expect(artifact.heldBy).toBe(carrier.id);
    expect(eventsOf(events, 'relicCaptured')).toHaveLength(1);

    run(state, ctx, 1, [
      {
        type: 'move',
        playerId: 0,
        entityIds: [carrier.id],
        target: { x: 36.5, y: 24.5 },
        queued: false,
      },
    ]);
    runUntil(state, ctx, 1200, () => artifact.position.x > 34);
    expect(artifact.position.x).toBeGreaterThan(34);
    run(state, ctx, 60);
    expect(distance(artifact.position, carrier.position)).toBeLessThan(2.5);
    expect(artifact.owner).toBe(0);
  });

  it('change hands only when an enemy finds them unguarded', () => {
    const state = standard(3);
    const ctx = context();
    state.players[2].diplomacy[0] = 'neutral';
    const artifact = addRelic(state, 'artifact', 24.5, 24.5);
    const guard = addUnit(state, 'villager', 0, 25.5, 24.5);
    run(state, ctx, 1);
    const raider = addUnit(state, 'villager', 1, 23.5, 24.5);
    run(state, ctx, 1);
    expect(artifact.owner).toBe(0);

    removeEntity(state, raider.id, data);
    removeEntity(state, guard.id, data);
    run(state, ctx, 1);
    expect(artifact.owner).toBe(0);
    expect(artifact.heldBy).toBeNull();

    addUnit(state, 'villager', 2, 23.5, 24.5);
    run(state, ctx, 1);
    expect(artifact.owner).toBe(0);

    const thief = addUnit(state, 'villager', 1, 24.5, 25.5);
    run(state, ctx, 1);
    expect(artifact.owner).toBe(1);
    expect(artifact.heldBy).toBe(thief.id);
  });

  it('win the game after all of them are held for 2000 years', () => {
    const state = standard();
    const ctx = context();
    addRelic(state, 'artifact', 24.5, 24.5);
    addRelic(state, 'artifact', 24.5, 34.5);
    addUnit(state, 'villager', 1, 25.5, 24.5);
    addUnit(state, 'villager', 1, 25.5, 34.5);
    const started = eventsOf(run(state, ctx, 1), 'victoryTimerStarted');
    expect(started).toEqual([
      { type: 'victoryTimerStarted', kind: 'artifacts', playerId: 1, endTick: COUNTDOWN },
    ]);
    runUntil(state, ctx, COUNTDOWN + 10, () => state.outcome !== null);
    expect(state.outcome).toEqual({ winners: [1], reason: 'artifacts', tick: COUNTDOWN });
  });

  it('reset the countdown when one of them is stolen', () => {
    const state = standard();
    const ctx = context();
    addRelic(state, 'artifact', 24.5, 24.5);
    const second = addRelic(state, 'artifact', 24.5, 34.5);
    addUnit(state, 'villager', 0, 25.5, 24.5);
    const guard = addUnit(state, 'villager', 0, 25.5, 34.5);
    run(state, ctx, 50);
    expect(state.victoryTimers.map((timer) => timer.kind)).toEqual(['artifacts']);
    removeEntity(state, guard.id, data);
    addUnit(state, 'villager', 1, 23.5, 34.5);
    const events = run(state, ctx, 1);
    expect(second.owner).toBe(1);
    expect(eventsOf(events, 'victoryTimerReset')).toEqual([
      { type: 'victoryTimerReset', kind: 'artifacts', playerId: 0 },
    ]);
    expect(state.victoryTimers).toEqual([]);
  });
});

describe('wonder', () => {
  it('wins the game after standing for 2000 years', () => {
    const state = standard();
    const ctx = context();
    const wonder = addBuilding(state, 'wonder', 0, 22, 22);
    const started = eventsOf(run(state, ctx, 1), 'victoryTimerStarted');
    expect(started).toEqual([
      { type: 'victoryTimerStarted', kind: 'wonder', playerId: 0, endTick: COUNTDOWN },
    ]);
    expect(state.victoryTimers).toEqual([
      { kind: 'wonder', playerId: 0, entityId: wonder.id, startTick: 0, endTick: COUNTDOWN },
    ]);
    runUntil(state, ctx, COUNTDOWN + 10, () => state.outcome !== null);
    expect(state.outcome).toEqual({ winners: [0], reason: 'wonder', tick: COUNTDOWN });
  });

  it('starts counting only when completed', () => {
    const state = standard();
    const ctx = context();
    const wonder = addBuilding(state, 'wonder', 0, 22, 22);
    wonder.buildProgress = 0.9;
    run(state, ctx, 5);
    expect(state.victoryTimers).toEqual([]);
    wonder.buildProgress = 1;
    run(state, ctx, 1);
    expect(state.victoryTimers).toHaveLength(1);
    expect(state.victoryTimers[0].startTick).toBe(5);
  });

  it('resets the countdown when destroyed', () => {
    const state = standard();
    const ctx = context();
    const wonder = addBuilding(state, 'wonder', 0, 22, 22);
    run(state, ctx, 200);
    removeEntity(state, wonder.id, data);
    const events = run(state, ctx, 1);
    expect(eventsOf(events, 'victoryTimerReset')).toEqual([
      { type: 'victoryTimerReset', kind: 'wonder', playerId: 0 },
    ]);
    expect(state.victoryTimers).toEqual([]);
    skipToLastTickOrStay(state);
    run(state, ctx, 5);
    expect(state.outcome).toBeNull();
  });

  it('runs separate countdowns for different players and the earliest one wins', () => {
    const state = standard(3);
    const ctx = context();
    addBuilding(state, 'wonder', 1, 22, 22);
    run(state, ctx, 30);
    addBuilding(state, 'wonder', 2, 30, 30);
    addRelic(state, 'ruin', 14, 30);
    addUnit(state, 'villager', 0, 16.5, 30.5);
    run(state, ctx, 1);
    expect(state.victoryTimers.map((timer) => [timer.kind, timer.playerId, timer.startTick])).toEqual([
      ['wonder', 1, 0],
      ['ruins', 0, 30],
      ['wonder', 2, 30],
    ]);
    skipToLastTick(state);
    run(state, ctx, 1);
    expect(state.outcome).toBeNull();
    run(state, ctx, 1);
    expect(state.outcome?.winners).toEqual([1]);
    expect(state.outcome?.reason).toBe('wonder');
  });

  it('is not a victory condition in conquest mode', () => {
    const state = arena({ players: 2, mode: 'conquest' });
    addBases(state);
    addBuilding(state, 'wonder', 0, 22, 22);
    const events = run(state, context(), 3);
    expect(eventsOf(events, 'victoryTimerStarted')).toEqual([]);
    expect(state.victoryTimers).toEqual([]);
  });
});

describe('allied victory', () => {
  it('counts a condition met by one player for all mutual allies', () => {
    const state = standard(4);
    const ctx = context();
    ally(state, 0, 1);
    state.players[2].diplomacy[0] = 'ally';
    addBuilding(state, 'wonder', 0, 22, 22);
    run(state, ctx, 1);
    skipToLastTick(state);
    const events = run(state, ctx, 2);
    expect(state.outcome?.reason).toBe('wonder');
    expect(state.outcome?.winners).toEqual([0, 1]);
    const over = eventsOf(events, 'gameOver')[0];
    expect(over.winners).toEqual([0, 1]);
    expect(over.players.filter((player) => player.winner).map((player) => player.playerId)).toEqual([
      0, 1,
    ]);
  });

  it('drops the countdown of a defeated player and frees its relics', () => {
    const state = standard(3);
    const ctx = context();
    const ruin = addRelic(state, 'ruin', 24, 24);
    addUnit(state, 'villager', 1, 26.5, 24.5);
    run(state, ctx, 1);
    expect(state.victoryTimers).toHaveLength(1);
    const events = run(state, ctx, 1, [{ type: 'resign', playerId: 1 }]);
    expect(ruin.owner).toBe(GAIA_PLAYER_ID);
    expect(state.victoryTimers).toEqual([]);
    expect(eventsOf(events, 'victoryTimerReset')).toHaveLength(1);
  });
});

function skipToLastTickOrStay(state: GameState): void {
  if (state.victoryTimers.length > 0) {
    skipToLastTick(state);
  } else {
    state.tick += COUNTDOWN;
  }
}
