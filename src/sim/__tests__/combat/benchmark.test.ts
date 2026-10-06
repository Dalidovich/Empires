import { describe, expect, it } from 'vitest';
import type { Command } from '../../commands';
import { step } from '../../engine';
import { addUnit, context } from '../fixtures';
import { battlefield } from './fixtures';

const SIZE = 96;
const PER_SIDE = 400;
const ROWS = 20;
const TICKS = 600;
const ROSTER = ['clubman', 'axeman', 'bowman', 'short_swordsman', 'cavalry'];

describe('combat benchmark', () => {
  it('keeps the average tick under budget with 800 units fighting', () => {
    const state = battlefield(SIZE);
    const ctx = context();
    const commands: Command[] = [];
    for (let side = 0; side < 2; side++) {
      const ids: number[] = [];
      for (let i = 0; i < PER_SIDE; i++) {
        const column = Math.floor(i / ROWS);
        const row = i % ROWS;
        const x = side === 0 ? 38.5 - column : 57.5 + column;
        const unit = addUnit(state, ROSTER[i % ROSTER.length], side, x, 38.5 + row);
        ids.push(unit.id);
      }
      commands.push({
        type: 'attackMove',
        playerId: side,
        entityIds: ids,
        target: { x: side === 0 ? 70.5 : 25.5, y: 48.5 },
        queued: false,
      });
    }

    const started = performance.now();
    let fighting = 0;
    for (let tick = 0; tick < TICKS; tick++) {
      step(state, tick === 0 ? commands : [], ctx);
      if (tick % 20 === 0) {
        const engaged = Object.values(state.entities).filter(
          (entity) => entity.orders[0]?.type === 'attack',
        ).length;
        fighting = Math.max(fighting, engaged);
      }
    }
    const average = (performance.now() - started) / TICKS;

    const losses = state.players[0].stats.unitsLost + state.players[1].stats.unitsLost;
    expect(fighting).toBeGreaterThan(PER_SIDE / 2);
    expect(losses).toBeGreaterThan(50);
    expect(average).toBeLessThan(25);
  }, 60000);
});
