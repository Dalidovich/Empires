import { describe, expect, it } from 'vitest';
import { tributeTax } from '../../systems/tribute';
import { context, data, emptyState, run } from '../fixtures';

describe('tribute', () => {
  it('charges the sender a 25% tax on top of the portion', () => {
    const state = emptyState(16);
    const ctx = context();
    state.players[0].resources.wood = 500;
    const amount = data.game.tributeAmount;
    const events = run(state, ctx, 1, [
      { type: 'tribute', playerId: 0, targetPlayerId: 1, resource: 'wood', amount },
    ]);
    expect(data.game.tributeTax).toBe(0.25);
    expect(tributeTax(state, 0, amount, data)).toBe(25);
    expect(state.players[0].resources.wood).toBe(500 - amount - 25);
    expect(state.players[1].resources.wood).toBe(amount);
    expect(state.players[0].stats.tributeSent).toBe(amount);
    expect(state.players[1].stats.tributeReceived).toBe(amount);
    expect(events).toContainEqual({
      type: 'tribute',
      fromPlayerId: 0,
      toPlayerId: 1,
      resource: 'wood',
      amount,
    });
  });

  it('drops the tax when the no-tribute-tax flag is set', () => {
    const state = emptyState(16);
    const ctx = context();
    state.players[0].resources.gold = 100;
    state.players[0].modifiers.flags.no_tribute_tax = true;
    run(state, ctx, 1, [
      { type: 'tribute', playerId: 0, targetPlayerId: 1, resource: 'gold', amount: 100 },
    ]);
    expect(tributeTax(state, 0, 100, data)).toBe(0);
    expect(state.players[0].resources.gold).toBe(0);
    expect(state.players[1].resources.gold).toBe(100);
  });

  it('rejects a portion the sender cannot afford with the tax', () => {
    const state = emptyState(16);
    const ctx = context();
    state.players[0].resources.food = 120;
    const events = run(state, ctx, 1, [
      { type: 'tribute', playerId: 0, targetPlayerId: 1, resource: 'food', amount: 100 },
    ]);
    expect(events).toContainEqual({
      type: 'commandRejected',
      playerId: 0,
      command: 'tribute',
      reason: 'resources',
    });
    expect(state.players[0].resources.food).toBe(120);
    expect(state.players[1].resources.food).toBe(0);
  });

  it('rejects invalid recipients and amounts', () => {
    const state = emptyState(16, 3);
    const ctx = context();
    state.players[0].resources.food = 1000;
    state.players[2].defeated = true;
    const events = run(state, ctx, 1, [
      { type: 'tribute', playerId: 0, targetPlayerId: 0, resource: 'food', amount: 100 },
      { type: 'tribute', playerId: 0, targetPlayerId: 7, resource: 'food', amount: 100 },
      { type: 'tribute', playerId: 0, targetPlayerId: 2, resource: 'food', amount: 100 },
      { type: 'tribute', playerId: 0, targetPlayerId: 1, resource: 'food', amount: 0 },
      { type: 'tribute', playerId: 0, targetPlayerId: 1, resource: 'food', amount: Number.NaN },
    ]);
    expect(events.filter((event) => event.type === 'commandRejected')).toHaveLength(5);
    expect(state.players[0].resources.food).toBe(1000);
  });
});
