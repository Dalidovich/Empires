import { describe, expect, it } from 'vitest';
import { removeEntity } from '../../core/entities';
import { recordStat } from '../../playerStats';
import { GAIA_PLAYER_ID, TILE_FREE } from '../../types';
import { addBuilding, addUnit, context, data, run } from '../fixtures';
import { addBase, addBases, addGuard, addRelic, ally, arena, baseTile, eventsOf } from './fixtures';

describe('elimination', () => {
  it('defeats a player left with nothing but walls and towers', () => {
    const state = arena({ players: 3 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    const tile = baseTile(1);
    const wall = addBuilding(state, 'small_wall', 1, tile.x, tile.y + 6);
    const tower = addBuilding(state, 'watch_tower', 1, tile.x + 2, tile.y + 6);
    const villager = addGuard(state, 1);

    removeEntity(state, bases[1].id, data);
    expect(eventsOf(run(state, ctx, 2), 'playerDefeated')).toEqual([]);
    expect(state.players[1].defeated).toBe(false);

    removeEntity(state, villager.id, data);
    const events = run(state, ctx, 1);
    expect(eventsOf(events, 'playerDefeated')).toEqual([
      { type: 'playerDefeated', playerId: 1, resigned: false },
    ]);
    expect(state.players[1].defeated).toBe(true);
    expect(state.players[1].resigned).toBe(false);
    expect(state.entities[wall.id]).toBeDefined();
    expect(state.entities[tower.id]).toBeDefined();
    expect(state.outcome).toBeNull();
  });

  it('keeps a player alive on a single unit or a single building', () => {
    const state = arena({ players: 3 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    const villager = addGuard(state, 1);
    const house = addBuilding(state, 'house', 2, baseTile(2).x, baseTile(2).y + 6);
    removeEntity(state, bases[1].id, data);
    removeEntity(state, bases[2].id, data);
    run(state, ctx, 3);
    expect(state.players[1].defeated).toBe(false);
    expect(state.players[2].defeated).toBe(false);
    removeEntity(state, villager.id, data);
    removeEntity(state, house.id, data);
    run(state, ctx, 1);
    expect(state.players[1].defeated).toBe(true);
    expect(state.players[2].defeated).toBe(true);
  });

  it('does not count an unfinished building', () => {
    const state = arena({ players: 3 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    const tile = baseTile(1);
    const foundation = addBuilding(state, 'house', 1, tile.x, tile.y + 6);
    foundation.buildProgress = 0.5;
    removeEntity(state, bases[1].id, data);
    run(state, ctx, 1);
    expect(state.players[1].defeated).toBe(true);
  });

  it('ignores players that never had a town center', () => {
    const state = arena({ players: 2 });
    const ctx = context();
    addBase(state, 0);
    const lone = addUnit(state, 'villager', 1, 30.5, 30.5);
    run(state, ctx, 2);
    removeEntity(state, lone.id, data);
    run(state, ctx, 2);
    expect(state.players[1].defeated).toBe(false);
    expect(state.outcome).toBeNull();
  });

  it('returns ruins and artifacts of a defeated player to gaia', () => {
    const state = arena({ players: 3 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    const ruin = addRelic(state, 'ruin', 24, 24);
    ruin.owner = 1;
    removeEntity(state, bases[1].id, data);
    run(state, ctx, 1);
    expect(state.players[1].defeated).toBe(true);
    expect(ruin.owner).toBe(GAIA_PLAYER_ID);
  });
});

describe('conquest', () => {
  it('goes to the last surviving player with the summary table', () => {
    const state = arena({ players: 2 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    recordStat(state, 0, 'unitsKilled', 3);
    recordStat(state, 0, 'foodGathered', 250);
    removeEntity(state, bases[1].id, data);
    const tick = state.tick;
    const events = run(state, ctx, 1);
    expect(state.outcome).toEqual({ winners: [0], reason: 'conquest', tick });
    const over = eventsOf(events, 'gameOver');
    expect(over).toHaveLength(1);
    expect(over[0].winners).toEqual([0]);
    expect(over[0].reason).toBe('conquest');
    expect(over[0].players.map((player) => [player.playerId, player.winner])).toEqual([
      [0, true],
      [1, false],
    ]);
    expect(over[0].players[0].stats.unitsKilled).toBe(3);
    expect(over[0].players[0].stats.foodGathered).toBe(250);
    expect(over[0].players[0].score).toBe(state.players[0].stats.score);
    expect(over[0].players[0].score).toBeGreaterThan(over[0].players[1].score);
  });

  it('stops the simulation once the game is over', () => {
    const state = arena({ players: 2 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    removeEntity(state, bases[1].id, data);
    run(state, ctx, 1);
    const tick = state.tick;
    expect(run(state, ctx, 5)).toEqual([]);
    expect(state.tick).toBe(tick);
  });

  it('waits until every enemy of the alliance is eliminated', () => {
    const state = arena({ players: 4 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    ally(state, 0, 1);
    removeEntity(state, bases[2].id, data);
    run(state, ctx, 1);
    expect(state.players[2].defeated).toBe(true);
    expect(state.outcome).toBeNull();
    removeEntity(state, bases[3].id, data);
    run(state, ctx, 1);
    expect(state.outcome?.reason).toBe('conquest');
    expect(state.outcome?.winners).toEqual([0, 1]);
  });

  it('does not end while survivors are allied one-sidedly or neutral', () => {
    const state = arena({ players: 3 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    state.players[0].diplomacy[1] = 'ally';
    state.players[1].diplomacy[0] = 'neutral';
    removeEntity(state, bases[2].id, data);
    run(state, ctx, 3);
    expect(state.outcome).toBeNull();
    run(state, ctx, 1, [{ type: 'setStance', playerId: 1, targetPlayerId: 0, stance: 'ally' }]);
    expect(state.outcome?.winners).toEqual([0, 1]);
  });

  it('shares the victory with an eliminated ally but not with one who resigned', () => {
    const state = arena({ players: 4 });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    ally(state, 0, 1);
    ally(state, 0, 2);
    ally(state, 1, 2);
    removeEntity(state, bases[1].id, data);
    run(state, ctx, 1, [{ type: 'resign', playerId: 2 }]);
    expect(state.outcome).toBeNull();
    removeEntity(state, bases[3].id, data);
    run(state, ctx, 1);
    expect(state.outcome?.winners).toEqual([0, 1]);
  });

  it('does not end a game nobody has lost yet', () => {
    const state = arena({ players: 2 });
    addBases(state);
    ally(state, 0, 1);
    run(state, context(), 3);
    expect(state.outcome).toBeNull();
  });
});

describe('human defeat', () => {
  it('ends the game even though the other players still fight', () => {
    const state = arena({ players: 3, kinds: ['human', 'ai', 'ai'] });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    removeEntity(state, bases[0].id, data);
    const events = run(state, ctx, 1);
    expect(state.outcome?.reason).toBe('human_defeated');
    expect(state.outcome?.winners).toEqual([]);
    expect(eventsOf(events, 'gameOver')).toHaveLength(1);
  });

  it('is a conquest for the opponent in a duel', () => {
    const state = arena({ players: 2, kinds: ['human', 'ai'] });
    const ctx = context();
    const bases = addBases(state);
    run(state, ctx, 1);
    removeEntity(state, bases[0].id, data);
    run(state, ctx, 1);
    expect(state.outcome?.reason).toBe('conquest');
    expect(state.outcome?.winners).toEqual([1]);
  });
});

describe('resign', () => {
  it('removes every object of the player from the map', () => {
    const state = arena({ players: 3 });
    const ctx = context();
    addBases(state);
    const tile = baseTile(1);
    const wall = addBuilding(state, 'small_wall', 1, tile.x, tile.y + 6);
    const villager = addGuard(state, 1);
    const artifact = addRelic(state, 'artifact', 24.5, 24.5);
    artifact.owner = 1;
    artifact.heldBy = villager.id;
    run(state, ctx, 1);

    const events = run(state, ctx, 1, [{ type: 'resign', playerId: 1 }]);
    expect(eventsOf(events, 'playerDefeated')).toEqual([
      { type: 'playerDefeated', playerId: 1, resigned: true },
    ]);
    expect(state.players[1].defeated).toBe(true);
    expect(state.players[1].resigned).toBe(true);
    expect(Object.values(state.entities).filter((entity) => entity.owner === 1)).toEqual([]);
    expect(state.map.occupancy.includes(wall.id)).toBe(false);
    expect(state.map.occupancy[tile.y * state.map.size + tile.x]).toBe(TILE_FREE);
    expect(state.entities[artifact.id].owner).toBe(GAIA_PLAYER_ID);
    expect(state.entities[artifact.id].heldBy).toBeNull();
    expect(state.outcome).toBeNull();
  });

  it('hands a duel to the opponent', () => {
    const state = arena({ players: 2, kinds: ['human', 'ai'] });
    addBases(state);
    const events = run(state, context(), 1, [{ type: 'resign', playerId: 0 }]);
    expect(state.outcome?.reason).toBe('conquest');
    expect(state.outcome?.winners).toEqual([1]);
    expect(eventsOf(events, 'gameOver')[0].players[0].winner).toBe(false);
  });

  it('ignores further commands of the resigned player', () => {
    const state = arena({ players: 3 });
    const ctx = context();
    addBases(state);
    run(state, ctx, 1, [{ type: 'resign', playerId: 1 }]);
    const events = run(state, ctx, 1, [
      { type: 'resign', playerId: 1 },
      { type: 'setStance', playerId: 1, targetPlayerId: 0, stance: 'ally' },
    ]);
    expect(events).toEqual([]);
    expect(state.players[1].diplomacy[0]).toBe('enemy');
  });
});
