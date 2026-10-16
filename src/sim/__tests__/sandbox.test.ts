import { describe, expect, it } from 'vitest';
import { step } from '../engine';
import type { SimEvent } from '../events';
import { buildPlayerView } from '../snapshot';
import type { GameState } from '../types';
import { addBuilding, addUnit, context, data, emptyState, refreshFog } from './fixtures';

function sandboxState(playerCount = 3): GameState {
  const state = emptyState(48, playerCount);
  state.settings.sandbox = true;
  for (const player of state.players.slice(1)) {
    player.kind = 'ai';
    player.difficulty = 'moderate';
  }
  return state;
}

function rejected(events: readonly SimEvent[]): string[] {
  return events.flatMap((event) => (event.type === 'commandRejected' ? [event.command] : []));
}

describe('sandbox commands', () => {
  it('are rejected outside sandbox games and for non-human issuers', () => {
    const state = sandboxState();
    state.settings.sandbox = false;
    const grant = { type: 'sandboxResources', playerId: 0, targetPlayerId: 0, amount: 500 } as const;
    expect(rejected(step(state, [grant], context()))).toEqual(['sandboxResources']);
    expect(state.players[0].resources.food).toBe(0);

    state.settings.sandbox = true;
    expect(rejected(step(state, [{ ...grant, playerId: 1 }], context()))).toEqual(['sandboxResources']);
    expect(state.players[0].resources.food).toBe(0);
  });

  it('grants every resource and marks the tick the grant becomes visible', () => {
    const state = sandboxState();
    const events = step(
      state,
      [{ type: 'sandboxResources', playerId: 0, targetPlayerId: 1, amount: 1000 }],
      context(),
    );
    expect(rejected(events)).toEqual([]);
    expect(state.players[1].resources).toEqual({ food: 1000, wood: 1000, stone: 1000, gold: 1000 });
    expect(state.players[1].sandboxGrantTick).toBe(state.tick);
    expect(buildPlayerView(state, 1, data).self.sandboxGrantTick).toBe(state.tick);
    expect(buildPlayerView(state, 0, data).self.sandboxGrantTick).toBeUndefined();
  });

  it('sets, replaces and clears the directive of a computer player', () => {
    const state = sandboxState();
    const ctx = context();
    step(state, [{ type: 'sandboxAi', playerId: 0, targetPlayerId: 1, mode: 'passive', victimId: null }], ctx);
    expect(state.players[1].aiDirective).toEqual({ mode: 'passive', victimId: null });
    expect(buildPlayerView(state, 0, data).players[1].aiDirective).toEqual({ mode: 'passive', victimId: null });

    step(state, [{ type: 'sandboxAi', playerId: 0, targetPlayerId: 1, mode: 'off', victimId: null }], ctx);
    expect(state.players[1].aiDirective?.mode).toBe('off');

    step(state, [{ type: 'sandboxAi', playerId: 0, targetPlayerId: 1, mode: 'free', victimId: null }], ctx);
    expect(state.players[1].aiDirective).toBeUndefined();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('turns the attacker hostile toward the victim and exposes the victim position', () => {
    const state = sandboxState();
    state.players[1].diplomacy[2] = 'ally';
    addUnit(state, 'villager', 2, 30.5, 30.5);
    const base = addBuilding(state, 'town_center', 2, 38, 38);
    refreshFog(state);
    const events = step(
      state,
      [{ type: 'sandboxAi', playerId: 0, targetPlayerId: 1, mode: 'attack', victimId: 2 }],
      context(),
    );
    expect(events).toContainEqual({ type: 'stanceChanged', playerId: 1, targetPlayerId: 2, stance: 'enemy' });
    expect(state.players[1].diplomacy[2]).toBe('enemy');
    expect(state.players[1].aiDirective).toEqual({ mode: 'attack', victimId: 2 });
    expect(buildPlayerView(state, 1, data).self.directiveTarget).toEqual(base.position);
    expect(buildPlayerView(state, 2, data).self.directiveTarget).toBeUndefined();
  });

  it('frozen: stops every unit and refunds queued training and research', () => {
    const state = sandboxState();
    const ctx = context();
    const stock = { food: 1000, wood: 1000, stone: 1000, gold: 1000 };
    state.players[1].resources = { ...stock };
    state.players[1].housing = 10;
    const base = addBuilding(state, 'town_center', 1, 20, 20);
    const granary = addBuilding(state, 'granary', 1, 26, 20);
    const worker = addUnit(state, 'villager', 1, 24.5, 24.5);
    const bystander = addUnit(state, 'villager', 2, 40.5, 40.5);
    const march = { x: 5.5, y: 5.5 };
    const technology = Object.values(data.technologies).find((entry) => entry.building === 'granary');
    const setup = step(
      state,
      [
        { type: 'move', playerId: 1, entityIds: [worker.id], target: march, queued: false },
        { type: 'move', playerId: 2, entityIds: [bystander.id], target: march, queued: false },
        { type: 'train', playerId: 1, buildingId: base.id, unit: 'villager', count: 2 },
      ],
      ctx,
    );
    expect(rejected(setup)).toEqual([]);
    expect(technology).toBeDefined();
    granary.research = { technology: technology?.id ?? '', progress: 0, paid: { food: 50 } };
    state.players[1].resources.food -= 50;
    expect(worker.orders).toHaveLength(1);
    expect(base.queue).toHaveLength(2);
    expect(state.players[1].resources.food).toBeLessThan(900);

    const events = step(
      state,
      [{ type: 'sandboxAi', playerId: 0, targetPlayerId: 1, mode: 'frozen', victimId: null }],
      ctx,
    );
    expect(rejected(events)).toEqual([]);
    expect(state.players[1].aiDirective).toEqual({ mode: 'frozen', victimId: null });
    expect(worker.orders).toEqual([]);
    expect(base.queue).toEqual([]);
    expect(granary.research).toBeNull();
    expect(state.players[1].resources).toEqual(stock);
    expect(bystander.orders).toHaveLength(1);

    state.players[2].kind = 'ai';
    const other = step(
      state,
      [{ type: 'sandboxAi', playerId: 0, targetPlayerId: 2, mode: 'frozen', victimId: null }],
      ctx,
    );
    expect(rejected(other)).toEqual([]);
    expect(bystander.orders).toEqual([]);
  });

  it('rejects directives for humans, unknown victims and self-attacks', () => {
    const state = sandboxState();
    const ctx = context();
    const attempts = [
      { type: 'sandboxAi', playerId: 0, targetPlayerId: 0, mode: 'off', victimId: null },
      { type: 'sandboxAi', playerId: 0, targetPlayerId: 1, mode: 'attack', victimId: null },
      { type: 'sandboxAi', playerId: 0, targetPlayerId: 1, mode: 'attack', victimId: 1 },
      { type: 'sandboxAi', playerId: 0, targetPlayerId: 1, mode: 'attack', victimId: 7 },
      { type: 'sandboxAi', playerId: 0, targetPlayerId: 9, mode: 'off', victimId: null },
    ] as const;
    for (const attempt of attempts) {
      expect(rejected(step(state, [attempt], ctx))).toEqual(['sandboxAi']);
    }
    expect(state.players.every((player) => player.aiDirective === undefined)).toBe(true);
  });
});

describe('noFog', () => {
  it('shows the whole map and every unit to human players only', () => {
    const state = sandboxState(2);
    state.settings.noFog = true;
    addUnit(state, 'villager', 0, 5.5, 5.5);
    const far = addUnit(state, 'villager', 1, 40.5, 40.5);
    refreshFog(state);
    const human = state.players[0];
    expect(human.visible.every((count) => count > 0)).toBe(true);
    expect(human.explored.every((flag) => flag === 1)).toBe(true);
    expect(buildPlayerView(state, 0, data).entities.map((entity) => entity.id)).toContain(far.id);

    const computer = state.players[1];
    expect(computer.visible[5 * 48 + 5]).toBe(0);
    expect(computer.explored[5 * 48 + 5]).toBe(0);
    expect(buildPlayerView(state, 1, data).entities.map((entity) => entity.id)).toEqual([far.id]);

    step(state, [], context());
    expect(human.visible.every((count) => count > 0)).toBe(true);
  });
});
