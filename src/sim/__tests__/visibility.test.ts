import { describe, expect, it } from 'vitest';
import { removeEntity } from '../core/entities';
import { setEntityPosition } from '../core/spatial';
import { fogAt, isEntityVisible, isTileExplored, isTileVisible } from '../core/visibility';
import { createGame } from '../engine';
import { buildPlayerView } from '../snapshot';
import type { PlayerSetup } from '../types';
import { FOG } from '../types';
import {
  addBuilding,
  addTree,
  addUnit,
  baseSettings,
  context,
  data,
  emptyState,
  refreshFog,
  run,
} from './fixtures';

describe('visibility', () => {
  it('tracks unexplored, explored and visible tiles', () => {
    const state = emptyState(48);
    const scout = addUnit(state, 'villager', 0, 10.5, 10.5);
    refreshFog(state);
    const player = state.players[0];
    const near = 10 * 48 + 12;
    const far = 30 * 48 + 30;
    expect(fogAt(player, near)).toBe(FOG.visible);
    expect(fogAt(player, far)).toBe(FOG.unexplored);
    expect(isTileVisible(state, 0, 14, 10)).toBe(true);
    expect(isTileVisible(state, 0, 15, 10)).toBe(false);
    expect(isTileVisible(state, 1, 12, 10)).toBe(false);

    setEntityPosition(state, scout, 30.5, 30.5);
    refreshFog(state);
    expect(fogAt(player, near)).toBe(FOG.explored);
    expect(fogAt(player, far)).toBe(FOG.visible);
    expect(isTileExplored(state, 0, 12, 10)).toBe(true);
  });

  it('counts overlapping viewers per tile', () => {
    const state = emptyState(32);
    addUnit(state, 'villager', 0, 10.5, 10.5);
    addUnit(state, 'villager', 0, 11.5, 10.5);
    refreshFog(state);
    expect(state.players[0].visible[10 * 32 + 10]).toBe(2);
  });

  it('shows enemy units only on visible tiles', () => {
    const state = emptyState(48);
    const own = addUnit(state, 'villager', 0, 10.5, 10.5);
    const near = addUnit(state, 'villager', 1, 12.5, 10.5);
    const far = addUnit(state, 'villager', 1, 30.5, 30.5);
    refreshFog(state);
    const view = buildPlayerView(state, 0, data);
    const ids = view.entities.map((entity) => entity.id);
    expect(ids).toEqual([own.id, near.id]);
    expect(view.entities[0].own).not.toBeNull();
    expect(view.entities[1].own).toBeNull();
    expect(isEntityVisible(state, 0, far, data)).toBe(false);
    expect(isEntityVisible(state, 0, near, data)).toBe(true);
  });

  it('keeps the last known state of buildings on explored tiles', () => {
    const state = emptyState(48);
    const ctx = context();
    const scout = addUnit(state, 'villager', 0, 10.5, 10.5);
    const house = addBuilding(state, 'house', 1, 12, 10);
    run(state, ctx, 1);
    expect(buildPlayerView(state, 0, data).entities.find((e) => e.id === house.id)?.remembered).toBe(
      false,
    );

    setEntityPosition(state, scout, 40.5, 40.5);
    house.hp = 10;
    run(state, ctx, 1);
    const hidden = buildPlayerView(state, 0, data).entities.find((e) => e.id === house.id);
    expect(hidden?.remembered).toBe(true);
    expect(hidden?.hp).toBe(data.buildings.house.hp);
    expect(hidden?.own).toBeNull();

    removeEntity(state, house.id, data);
    run(state, ctx, 1);
    expect(buildPlayerView(state, 0, data).entities.some((e) => e.id === house.id)).toBe(true);

    setEntityPosition(state, scout, 10.5, 10.5);
    run(state, ctx, 1);
    expect(buildPlayerView(state, 0, data).entities.some((e) => e.id === house.id)).toBe(false);
    expect(state.players[0].remembered).toEqual({});
  });

  it('shows resources on explored tiles and hides them on unexplored ones', () => {
    const state = emptyState(48);
    const scout = addUnit(state, 'villager', 0, 10.5, 10.5);
    const seen = addTree(state, 12, 12);
    const unseen = addTree(state, 40, 40);
    refreshFog(state);
    setEntityPosition(state, scout, 10.5, 30.5);
    refreshFog(state);
    const ids = buildPlayerView(state, 0, data).entities.map((entity) => entity.id);
    expect(ids).toContain(seen.id);
    expect(ids).not.toContain(unseen.id);
  });

  it('shares vision with players who are set as allies', () => {
    const state = emptyState(48, 3);
    state.players[1].diplomacy[0] = 'ally';
    addUnit(state, 'villager', 1, 30.5, 30.5);
    const enemy = addUnit(state, 'villager', 2, 31.5, 30.5);
    refreshFog(state);
    expect(isTileVisible(state, 0, 30, 30)).toBe(true);
    expect(isTileVisible(state, 2, 30, 30)).toBe(true);
    expect(isTileVisible(state, 1, 5, 5)).toBe(false);
    expect(buildPlayerView(state, 0, data).entities.map((e) => e.id)).toContain(enemy.id);
    state.players[1].diplomacy[0] = 'enemy';
    refreshFog(state);
    expect(isTileVisible(state, 0, 30, 30)).toBe(false);
    expect(isTileExplored(state, 0, 30, 30)).toBe(true);
  });

  it('merges explored tiles of mutual allies when shared exploration is set', () => {
    const state = emptyState(48, 2, 'ally');
    const ctx = context();
    const scout = addUnit(state, 'villager', 1, 30.5, 30.5);
    run(state, ctx, 1);
    state.players[0].diplomacy[1] = 'enemy';
    state.players[1].diplomacy[0] = 'enemy';
    setEntityPosition(state, scout, 5.5, 40.5);
    run(state, ctx, 1);
    state.players[0].explored.fill(0);
    state.players[0].diplomacy[1] = 'ally';
    state.players[1].diplomacy[0] = 'ally';
    run(state, ctx, 20);
    expect(isTileExplored(state, 0, 30, 30)).toBe(false);
    state.players[0].sharedExploration = true;
    run(state, ctx, 20);
    expect(isTileExplored(state, 0, 30, 30)).toBe(true);
  });

  it('starts fully explored but not visible with the reveal map setting', () => {
    const players: PlayerSetup[] = [
      { id: 0, kind: 'human', civilization: 'greek', team: null, color: 1, difficulty: null },
      { id: 1, kind: 'human', civilization: 'greek', team: null, color: 2, difficulty: null },
    ];
    const state = createGame({ ...baseSettings, revealMap: true }, players, data, 3);
    const player = state.players[0];
    expect(player.explored.every((value) => value === 1)).toBe(true);
    const enemyCenter = Object.values(state.entities).find(
      (entity) => entity.owner === 1 && entity.kind === 'building',
    );
    expect(enemyCenter).toBeDefined();
    const view = buildPlayerView(state, 0, data);
    const remembered = view.entities.find((entity) => entity.id === enemyCenter?.id);
    expect(remembered?.remembered).toBe(true);
    expect(view.entities.some((entity) => entity.owner === 1 && entity.kind === 'unit')).toBe(false);
    expect(view.fog.visible.some((count) => count === 0)).toBe(true);

    const hidden = createGame(baseSettings, players, data, 3);
    expect(buildPlayerView(hidden, 0, data).entities.every((entity) => entity.owner !== 1)).toBe(true);
    expect(hidden.players[0].explored.some((value) => value === 0)).toBe(true);
    expect(hidden.players[0].visible.some((count) => count > 0)).toBe(true);
  });
});
