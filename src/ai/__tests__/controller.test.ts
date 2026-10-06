import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../data';
import type { AiDifficulty } from '../../data/types';
import { AI_DIFFICULTIES } from '../../data/types';
import type { Command } from '../../sim/commands';
import type { Session } from '../../sim/core/session';
import { advanceSession, createSession, saveSession, startSession } from '../../sim/core/session';
import type { SerializedGame } from '../../sim/protocol';
import { deserialize } from '../../sim/serialize';
import { buildPlayerView } from '../../sim/snapshot';
import type { PlayerSetup, Settings } from '../../sim/types';
import { createAi } from '../index';
import { resolveParams } from '../params';

const data = loadGameData();

const settings: Settings = {
  mapType: 'inland',
  mapSize: 'tiny',
  victoryMode: 'conquest',
  populationLimit: 50,
  startingAge: 'stone',
  revealMap: false,
  lockTeams: true,
  speed: 'normal',
};

function setups(levels: readonly AiDifficulty[]): PlayerSetup[] {
  const civilizations = ['assyrian', 'greek', 'egyptian', 'yamato'];
  return levels.map((difficulty, id) => ({
    id,
    kind: 'ai',
    civilization: civilizations[id % civilizations.length],
    team: null,
    color: id,
    difficulty,
  }));
}

function play(session: Session, ticks: number): void {
  for (let i = 0; i < ticks; i++) {
    advanceSession(session);
  }
}

describe('ai controller', () => {
  it('reads every tuning parameter of every level from ai.json', () => {
    const keys = Object.keys(resolveParams(data.aiLevels.moderate)).sort();
    for (const level of data.ai.levels) {
      expect(Object.keys(level.params).sort()).toEqual(keys);
    }
  });

  it('orders the levels by speed, economy, aggressiveness and micro quality', () => {
    const levels = AI_DIFFICULTIES.map((id) => data.aiLevels[id]);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].decisionIntervalTicks).toBeLessThan(levels[i - 1].decisionIntervalTicks);
      expect(levels[i].maxVillagers).toBeGreaterThan(levels[i - 1].maxVillagers);
      expect(levels[i].aggressiveness).toBeGreaterThan(levels[i - 1].aggressiveness);
      expect(levels[i].microQuality).toBeGreaterThan(levels[i - 1].microQuality);
    }
    for (const level of levels) {
      const bonus = Object.values(level.resourceBonus).reduce((sum, value) => sum + value, 0);
      expect(bonus > 0).toBe(level.id === 'hardest');
    }
  });

  it('decides only on its own ticks and spreads players over the interval', () => {
    const session = startSession(settings, setups(['hardest', 'hardest', 'hardest', 'hardest']), 5, data);
    const interval = data.aiLevels.hardest.decisionIntervalTicks;
    const active: number[][] = [[], [], [], []];
    for (let tick = 0; tick < interval * 3; tick++) {
      for (const ai of session.ais) {
        const view = buildPlayerView(session.state, ai.playerId, data);
        if (ai.think(view, tick).length > 0) {
          active[ai.playerId].push(tick % interval);
        }
      }
    }
    const phases = active.map((ticks) => [...new Set(ticks)]);
    for (const phase of phases) {
      expect(phase).toHaveLength(1);
      expect(phase[0]).not.toBe(0);
    }
    expect(new Set(phases.map((phase) => phase[0])).size).toBe(4);
  });

  it('issues only commands for its own player', () => {
    const session = startSession(settings, setups(['hard', 'hard']), 3, data);
    const seen: Command[] = [];
    for (let i = 0; i < 400; i++) {
      for (const ai of session.ais) {
        const commands = ai.think(buildPlayerView(session.state, ai.playerId, data), session.state.tick);
        for (const command of commands) {
          expect(command.playerId).toBe(ai.playerId);
          seen.push(command);
        }
      }
      advanceSession(session);
    }
    expect(seen.length).toBeGreaterThan(0);
  });

  it('produces identical games for identical parameters', () => {
    const run = (): string => {
      const session = startSession(settings, setups(['hardest', 'moderate']), 11, data);
      play(session, 2500);
      return JSON.stringify(saveSession(session));
    };
    expect(run()).toBe(run());
  }, 60000);

  it('restores an identical controller from its serialized state', () => {
    const original = startSession(settings, setups(['hardest', 'hard']), 7, data);
    play(original, 1500);
    const saved = JSON.parse(JSON.stringify(saveSession(original))) as unknown;
    const restored = createSession(deserialize(saved as SerializedGame), data);
    expect(restored.ais.map((ai) => ai.serialize())).toEqual(original.ais.map((ai) => ai.serialize()));
    play(original, 1500);
    play(restored, 1500);
    expect(JSON.stringify(saveSession(restored))).toBe(JSON.stringify(saveSession(original)));
  }, 60000);

  it('starts from a fresh state when the saved state is not recognised', () => {
    const fresh = createAi(1, 'easy', data).serialize();
    expect(createAi(1, 'easy', data, { difficulty: 'easy' }).serialize()).toEqual(fresh);
    expect(createAi(1, 'easy', data, null).serialize()).toEqual(fresh);
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(fresh);
  });

  it('develops an economy and reaches the Tool Age in a headless game', () => {
    const session = startSession(settings, setups(['hardest', 'hardest']), 1, data);
    play(session, 6000);
    for (const player of session.state.players) {
      const own = Object.values(session.state.entities).filter((entity) => entity.owner === player.id);
      expect(own.filter((entity) => entity.type === 'villager').length).toBeGreaterThan(7);
      expect(own.filter((entity) => entity.type === 'house').length).toBeGreaterThan(1);
      expect(player.stats.toolAgeTick).toBeGreaterThan(0);
      expect(player.stats.foodGathered).toBeGreaterThan(250);
      expect(player.stats.woodGathered).toBeGreaterThan(100);
    }
  }, 60000);
});
