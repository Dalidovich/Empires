import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../../../sim/events';
import { GameMood, TENSION_HALF_LIFE } from '../mood';

const position = { x: 1, y: 1 };

function underAttack(playerId = 0): SimEvent {
  return { type: 'underAttack', playerId, attackerOwner: 1, position };
}

function died(owner: number, killerOwner: number | null, entityKind: 'unit' | 'building' | 'resource' = 'unit'): SimEvent {
  return { type: 'entityDied', entityId: 1, entityKind, entityType: 'clubman', owner, killerOwner, position };
}

describe('game mood', () => {
  it('stays calm without combat', () => {
    const mood = new GameMood();
    mood.observe(
      [
        { type: 'attackHit', attackerId: 1, attackerType: 'villager', targetId: 2, position },
        { type: 'gatherStrike', entityId: 1, gatherKind: 'wood', position },
        underAttack(1),
        died(1, 2),
        died(-1, 0),
        died(0, null),
        died(0, 1, 'resource'),
      ],
      0,
      1,
    );
    expect(mood.current(1)).toBe('calm');
  });

  it('escalates with attacks and casualties of the player', () => {
    const mood = new GameMood();
    mood.observe([died(1, 0)], 0, 1);
    expect(mood.current(1)).toBe('tension');
    mood.observe([underAttack()], 0, 2);
    expect(mood.current(2)).toBe('battle');
  });

  it('calms down over time with hysteresis', () => {
    const mood = new GameMood();
    mood.observe([underAttack(), underAttack()], 0, 0);
    expect(mood.current(0)).toBe('battle');
    expect(mood.current(TENSION_HALF_LIFE)).toBe('battle');
    expect(mood.current(TENSION_HALF_LIFE * 2)).toBe('tension');
    expect(mood.current(TENSION_HALF_LIFE * 3)).toBe('tension');
    expect(mood.current(TENSION_HALF_LIFE * 5)).toBe('calm');
  });

  it('caps the tension so a long fight still fades', () => {
    const mood = new GameMood();
    mood.observe(Array.from({ length: 100 }, () => underAttack()), 0, 0);
    expect(mood.current(TENSION_HALF_LIFE * 5)).toBe('calm');
  });

  it('resets', () => {
    const mood = new GameMood();
    mood.observe([underAttack(), underAttack()], 0, 5);
    mood.reset();
    expect(mood.current(5)).toBe('calm');
  });
});
