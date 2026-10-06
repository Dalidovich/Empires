import { describe, expect, it } from 'vitest';
import type { Command } from '../commands';
import { distance } from '../core/geometry';
import { step } from '../engine';
import { buildPlayerView } from '../snapshot';
import { addTree, addUnit, context, data, emptyState } from './fixtures';

const SIZE = 200;
const UNITS = 1600;
const GROUPS = 8;
const TICKS = 300;

describe('load', () => {
  it('moves 1600 units on a 200x200 map within the tick budget', () => {
    const state = emptyState(SIZE, GROUPS);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const inCorner = (x < 40 || x >= SIZE - 40) && (y < 40 || y >= SIZE - 40);
        if (!inCorner && (x * 7 + y * 13) % 23 === 0) {
          addTree(state, x, y);
        }
      }
    }
    const corners = [
      { x: 5, y: 5 },
      { x: SIZE - 25, y: 5 },
      { x: 5, y: SIZE - 25 },
      { x: SIZE - 25, y: SIZE - 25 },
    ];
    const commands: Command[] = [];
    const groups: { ids: number[]; target: { x: number; y: number } }[] = [];
    const perGroup = UNITS / GROUPS;
    for (let group = 0; group < GROUPS; group++) {
      const corner = corners[group % 4];
      const offset = group < 4 ? 0 : 12;
      const ids: number[] = [];
      for (let i = 0; i < perGroup; i++) {
        const unit = addUnit(
          state,
          'villager',
          group,
          corner.x + (i % 20) + 0.5,
          corner.y + offset + Math.floor(i / 20) + 0.5,
        );
        ids.push(unit.id);
      }
      const opposite = corners[3 - (group % 4)];
      const target = { x: opposite.x + 10.5, y: opposite.y + offset + 5.5 };
      groups.push({ ids, target });
      commands.push({ type: 'move', playerId: group, entityIds: ids, target, queued: false });
    }
    const ctx = context();
    const startPositions = groups.map((group) => ({ ...state.entities[group.ids[0]].position }));

    let worst = 0;
    const started = performance.now();
    for (let tick = 0; tick < TICKS; tick++) {
      const before = performance.now();
      step(state, tick === 0 ? commands : [], ctx);
      worst = Math.max(worst, performance.now() - before);
    }
    const average = (performance.now() - started) / TICKS;

    const moving = Object.values(state.entities).filter((entity) => entity.state === 'moving');
    expect(moving.length).toBeGreaterThan(UNITS * 0.9);
    groups.forEach((group, index) => {
      const lead = state.entities[group.ids[0]];
      expect(distance(lead.position, startPositions[index])).toBeGreaterThan(10);
    });
    expect(average).toBeLessThan(25);
    expect(worst).toBeLessThan(250);

    const viewStarted = performance.now();
    const view = buildPlayerView(state, 0, data);
    expect(performance.now() - viewStarted).toBeLessThan(25);
    expect(view.entities.length).toBeGreaterThanOrEqual(perGroup);
  }, 60000);
});
