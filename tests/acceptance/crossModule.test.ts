import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eventSound } from '../../src/audio/mapping';
import en from '../../src/locales/en.json';
import ru from '../../src/locales/ru.json';
import type { Command } from '../../src/sim/commands';
import { killEntity, spawnEntity } from '../../src/sim/core/entities';
import { advanceSession, queueCommands, startSession } from '../../src/sim/core/session';
import { setEntityPosition } from '../../src/sim/core/spatial';
import { completeResearch } from '../../src/sim/effects/apply';
import { step } from '../../src/sim/engine';
import type { SimEvent, SimEventOf, SimEventType } from '../../src/sim/events';
import { STAT_KEYS } from '../../src/sim/playerStats';
import { getCarryCapacity, getFarmFood, getGatherRate, getUnitStats } from '../../src/sim/stats';
import { conversionChance } from '../../src/sim/systems/priests';
import type { Entity, GameState, PlayerSetup, Settings } from '../../src/sim/types';
import { GAIA_PLAYER_ID } from '../../src/sim/types';
import { addBuilding, addUnit, context, data, emptyState, run } from '../../src/sim/__tests__/fixtures';

function addResource(state: GameState, type: string, tileX: number, tileY: number): Entity {
  return spawnEntity(
    state,
    { kind: 'resource', type, owner: GAIA_PLAYER_ID, position: { x: tileX + 0.5, y: tileY + 0.5 } },
    data,
  );
}

function runCollecting(
  state: GameState,
  limit: number,
  done: () => boolean,
  commands: readonly Command[] = [],
): SimEvent[] {
  const ctx = context();
  const events: SimEvent[] = [];
  for (let tick = 0; tick < limit && !done(); tick++) {
    events.push(...step(state, tick === 0 ? commands : [], ctx));
  }
  return events;
}

describe('hunting chain', () => {
  it('turns a gather order on an animal into a kill, a carcass and delivered food', () => {
    const state = emptyState(32);
    addBuilding(state, 'town_center', 0, 4, 4);
    const hunters = [
      addUnit(state, 'villager', 0, 9.5, 5.5),
      addUnit(state, 'villager', 0, 9.5, 6.5),
      addUnit(state, 'villager', 0, 10.5, 5.5),
      addUnit(state, 'villager', 0, 10.5, 6.5),
    ];
    const prey = addUnit(state, 'alligator', GAIA_PLAYER_ID, 13.5, 5.5);
    const events = runCollecting(state, 8000, () => state.players[0].stats.foodGathered > 0, [
      {
        type: 'gather',
        playerId: 0,
        entityIds: hunters.map((hunter) => hunter.id),
        targetId: prey.id,
        queued: false,
      },
    ]);
    const death = events.find(
      (event): event is SimEventOf<'entityDied'> =>
        event.type === 'entityDied' && event.entityId === prey.id,
    );
    expect(death?.killerOwner).toBe(0);
    expect(events.some((event) => event.type === 'gatherStrike' && event.gatherKind === 'hunt')).toBe(true);
    expect(state.players[0].stats.foodGathered).toBeGreaterThan(0);
    expect(state.players[0].resources.food).toBe(state.players[0].stats.foodGathered);
  });
});

function mineGold(researched: readonly string[]): { gathered: number; largestLoad: number } {
  const state = emptyState(32);
  state.players[0].researched.push(...researched);
  addBuilding(state, 'storage_pit', 0, 4, 4);
  const mine = addResource(state, 'gold_mine', 9, 5);
  const miner = addUnit(state, 'villager', 0, 8.5, 5.5);
  const ctx = context();
  let largestLoad = 0;
  step(state, [{ type: 'gather', playerId: 0, entityIds: [miner.id], targetId: mine.id, queued: false }], ctx);
  for (let tick = 0; tick < 12000; tick++) {
    step(state, [], ctx);
    largestLoad = Math.max(largestLoad, miner.carry?.amount ?? 0);
  }
  return { gathered: state.players[0].stats.goldGathered, largestLoad };
}

describe('technology and civilization effects', () => {
  it('reach gathering: rate and carry capacity', () => {
    const base = mineGold([]);
    const boosted = mineGold(['gold_mining', 'coinage']);
    expect(base.largestLoad).toBe(data.resources.carryCapacity.gold);
    expect(boosted.largestLoad).toBe(data.resources.carryCapacity.gold + 3);
    expect(boosted.gathered).toBeGreaterThan(base.gathered * 1.15);

    const state = emptyState(16);
    state.players[0].civilization = 'egyptian';
    state.players[1].civilization = 'phoenician';
    expect(getGatherRate(state, 0, 'gold', data)).toBeCloseTo(data.resources.gatherRates.gold * 1.2, 6);
    expect(getCarryCapacity(state, 1, 'wood', data)).toBe(data.resources.carryCapacity.wood + 2);
  });

  it('reach farms: food stock of new and existing farms', () => {
    const state = emptyState(32);
    state.players[0].civilization = 'sumerian';
    const ctx = context();
    const ownFarm = addBuilding(state, 'farm', 0, 4, 4);
    const otherFarm = addBuilding(state, 'farm', 1, 12, 12);
    run(state, ctx, 1);
    expect(getFarmFood(state, 0, data)).toBe(data.resources.farmFood * 2);
    expect(ownFarm.amount).toBe(data.resources.farmFood * 2);
    expect(otherFarm.amount).toBe(data.resources.farmFood);
    completeResearch(state, 0, 'domestication', ctx, { x: 0, y: 0 });
    expect(ownFarm.amount).toBe((data.resources.farmFood + 75) * 2);
    expect(otherFarm.amount).toBe(data.resources.farmFood);
  });

  it('reach combat: damage of one melee hit', () => {
    const state = emptyState(32);
    const ctx = context();
    completeResearch(state, 0, 'toolworking', ctx, { x: 0, y: 0 });
    const attacker = addUnit(state, 'axeman', 0, 10.5, 10.5);
    const victim = addUnit(state, 'clubman', 1, 11.3, 10.5);
    victim.standGround = true;
    const stats = getUnitStats(state, 0, 'axeman', data);
    expect(stats.attack).toBe(data.units.axeman.attack + 2);
    const events = runCollecting(
      state,
      200,
      () => victim.hp < data.units.clubman.hp,
      [{ type: 'attack', playerId: 0, entityIds: [attacker.id], targetId: victim.id, queued: false }],
    );
    expect(events.some((event) => event.type === 'attackHit' && event.attackerId === attacker.id)).toBe(true);
    expect(victim.hp).toBe(data.units.clubman.hp - (stats.attack - data.units.clubman.armor));
  });

  it('reach priests: conversion chance and faith recharge', () => {
    const state = emptyState(32);
    state.players[0].civilization = 'babylonian';
    const ctx = context();
    const fast = addUnit(state, 'priest', 0, 5.5, 5.5);
    const slow = addUnit(state, 'priest', 1, 25.5, 25.5);
    const target = addUnit(state, 'clubman', 1, 26.5, 25.5);
    run(state, ctx, 1);
    fast.faith = 0;
    slow.faith = 0;
    run(state, ctx, 200);
    const { faithMax, faithRechargeRate } = data.game.conversion;
    const baseTime = faithMax / faithRechargeRate;
    expect(slow.faith).toBeCloseTo((200 / data.game.tickRate) * faithRechargeRate, 4);
    expect(fast.faith).toBeCloseTo((200 / data.game.tickRate) * (faithMax / (baseTime - 12)), 4);

    const before = conversionChance(state, fast, target, data);
    completeResearch(state, 0, 'astrology', ctx, { x: 0, y: 0 });
    expect(conversionChance(state, fast, target, data)).toBeCloseTo(before * 1.3, 6);
  });

  it('reach visibility: Writing shares exploration between mutual allies', () => {
    const shared = (withWriting: boolean): number => {
      const state = emptyState(32, 2, 'ally');
      const ctx = context();
      addUnit(state, 'villager', 0, 3.5, 3.5);
      const tile = 30 * 32 + 30;
      run(state, ctx, 1);
      state.players[1].explored[tile] = 1;
      if (withWriting) {
        completeResearch(state, 0, 'writing', ctx, { x: 0, y: 0 });
      }
      run(state, ctx, 45);
      return state.players[0].explored[tile];
    };
    expect(shared(false)).toBe(0);
    expect(shared(true)).toBe(1);
  });

  it('reach tribute: Coinage removes the tax', () => {
    const state = emptyState(16);
    const ctx = context();
    state.players[0].resources.gold = 1000;
    const tribute: Command = { type: 'tribute', playerId: 0, targetPlayerId: 1, resource: 'gold', amount: 100 };
    run(state, ctx, 1, [tribute]);
    const taxed = 100 + Math.round(100 * data.game.tributeTax);
    expect(state.players[0].resources.gold).toBe(1000 - taxed);
    expect(state.players[1].resources.gold).toBe(100);
    completeResearch(state, 0, 'coinage', ctx, { x: 0, y: 0 });
    run(state, ctx, 1, [tribute]);
    expect(state.players[0].resources.gold).toBe(1000 - taxed - 100);
    expect(state.players[1].resources.gold).toBe(200);
    expect(state.players[0].stats.tributeSent).toBe(200);
    expect(state.players[1].stats.tributeReceived).toBe(200);
  });
});

describe('rally point on a resource', () => {
  it('sends the trained villager to gather it', () => {
    const state = emptyState(32);
    const center = addBuilding(state, 'town_center', 0, 4, 4);
    const tree = addResource(state, 'tree', 10, 5);
    state.players[0].resources.food = 50;
    const events = runCollecting(state, 3000, () => state.players[0].stats.woodGathered > 0, [
      {
        type: 'setRallyPoint',
        playerId: 0,
        buildingIds: [center.id],
        position: { x: tree.position.x, y: tree.position.y },
        targetId: tree.id,
      },
      { type: 'train', playerId: 0, buildingId: center.id, unit: 'villager', count: 1 },
    ]);
    const trained = events.find((event): event is SimEventOf<'unitTrained'> => event.type === 'unitTrained');
    expect(trained?.unitType).toBe('villager');
    expect(state.players[0].stats.unitsTrained).toBe(1);
    expect(state.players[0].stats.woodGathered).toBeGreaterThan(0);
    expect(state.players[0].resources.wood).toBe(state.players[0].stats.woodGathered);
  });
});

describe('wonder', () => {
  it('starts the victory countdown when built and resets it when destroyed', () => {
    const state = emptyState(48);
    state.settings.victoryMode = 'standard';
    const ctx = context();
    for (const player of state.players) {
      player.kind = 'ai';
      player.explored.fill(1);
      addBuilding(state, 'town_center', player.id, 4 + player.id * 30, 4);
    }
    const builder = state.players[0];
    builder.age = 'iron';
    builder.resources = { food: 5000, wood: 5000, stone: 5000, gold: 5000 };
    const workers = Array.from({ length: 24 }, (_, index) => addUnit(state, 'villager', 0, 18.5 + index, 28.5));
    const built = runCollecting(state, 25000, () => state.victoryTimers.length > 0, [
      {
        type: 'placeBuilding',
        playerId: 0,
        entityIds: workers.map((worker) => worker.id),
        building: 'wonder',
        tile: { x: 20, y: 20 },
        queued: false,
      },
    ]);
    expect(built.filter((event) => event.type === 'commandRejected')).toEqual([]);
    const wonder = Object.values(state.entities).find((entity) => entity.type === 'wonder');
    expect(wonder?.buildProgress).toBe(1);
    expect(state.players[0].stats.buildingsBuilt).toBe(1);
    const started = built.find(
      (event): event is SimEventOf<'victoryTimerStarted'> => event.type === 'victoryTimerStarted',
    );
    expect(started).toMatchObject({ kind: 'wonder', playerId: 0 });
    expect(state.victoryTimers).toEqual([
      expect.objectContaining({ kind: 'wonder', playerId: 0, entityId: wonder?.id }),
    ]);

    killEntity(state, wonder?.id ?? 0, ctx, 1);
    const after = run(state, ctx, 1);
    expect(after).toContainEqual({ type: 'victoryTimerReset', kind: 'wonder', playerId: 0 });
    expect(state.victoryTimers).toEqual([]);
    expect(state.players[1].stats.buildingsRazed).toBe(1);
  }, 30000);
});

const DUEL_SETTINGS: Settings = {
  mapType: 'inland',
  mapSize: 'tiny',
  victoryMode: 'conquest',
  populationLimit: 50,
  startingAge: 'stone',
  revealMap: true,
  lockTeams: false,
  speed: 'normal',
};

function duel(team: number | null): PlayerSetup[] {
  return [
    { id: 0, kind: 'human', civilization: 'assyrian', team, color: 0x2f6fde, difficulty: null },
    { id: 1, kind: 'ai', civilization: 'greek', team, color: 0xd9412f, difficulty: 'hard' },
  ];
}

describe('AI stance reactions', () => {
  it('turns hostile toward an ally that attacks it', () => {
    const session = startSession(DUEL_SETTINGS, duel(1), 3, data, () => {});
    const { state } = session;
    expect(state.players[1].diplomacy[0]).toBe('ally');
    const own = Object.values(state.entities).filter(
      (entity) => entity.owner === 0 && entity.type === 'villager',
    );
    const victim = Object.values(state.entities).find(
      (entity) => entity.owner === 1 && entity.type === 'town_center',
    );
    expect(victim).toBeDefined();
    if (!victim) {
      return;
    }
    own.forEach((unit, index) =>
      setEntityPosition(state, unit, victim.position.x - 3 + index, victim.position.y + 3),
    );
    queueCommands(session, [
      { type: 'setStance', playerId: 0, targetPlayerId: 1, stance: 'enemy' },
      { type: 'attack', playerId: 0, entityIds: own.map((unit) => unit.id), targetId: victim.id, queued: false },
    ]);
    for (let tick = 0; tick < 3000 && state.players[1].diplomacy[0] !== 'enemy'; tick++) {
      advanceSession(session);
    }
    expect(state.players[1].diplomacy[0]).toBe('enemy');
  });

  it('warms up to a player that sends tribute', () => {
    const session = startSession(DUEL_SETTINGS, duel(null), 3, data, () => {});
    const { state } = session;
    expect(state.players[1].diplomacy[0]).toBe('enemy');
    const step = data.aiLevels.hard.params.tributePerStanceStep;
    state.players[0].resources.food = step * 4;
    advanceSession(session);
    queueCommands(session, [
      { type: 'tribute', playerId: 0, targetPlayerId: 1, resource: 'food', amount: step },
    ]);
    for (let tick = 0; tick < 2000 && state.players[1].diplomacy[0] === 'enemy'; tick++) {
      advanceSession(session);
    }
    expect(state.players[1].diplomacy[0]).toBe('neutral');
  });
});

describe('stat counters', () => {
  it('are all initialised and carried into the game over summary', () => {
    const state = emptyState(48);
    state.players.forEach((player) => {
      player.kind = 'ai';
    });
    addBuilding(state, 'town_center', 0, 4, 4);
    const doomed = addBuilding(state, 'town_center', 1, 30, 30);
    const ctx = context();
    run(state, ctx, 1);
    state.players[0].stats.woodGathered = 123;
    killEntity(state, doomed.id, ctx, 0);
    const events = run(state, ctx, 2);
    const over = events.find((event): event is SimEventOf<'gameOver'> => event.type === 'gameOver');
    expect(over?.winners).toEqual([0]);
    for (const summary of over?.players ?? []) {
      expect(Object.keys(summary.stats).sort()).toEqual([...STAT_KEYS].sort());
      expect(summary.stats).toEqual(state.players[summary.playerId].stats);
      expect(summary.score).toBe(summary.stats.score);
    }
    expect(over?.players[0].stats.woodGathered).toBe(123);
    expect(over?.players[0].stats.buildingsRazed).toBe(1);
    expect(over?.players[1].stats.buildingsLost).toBe(1);
  });
});

describe('locale coverage of data ids', () => {
  it('names every unit, building, technology and civilization in both languages', () => {
    const expected: string[] = [];
    for (const id of Object.keys(data.units)) {
      expected.push(`unit.${id}.name`);
    }
    for (const id of Object.keys(data.buildings)) {
      expected.push(`building.${id}.name`);
    }
    for (const id of Object.keys(data.technologies)) {
      expected.push(`tech.${id}.name`, `tech.${id}.desc`);
    }
    for (const id of Object.keys(data.civilizations)) {
      expected.push(`civ.${id}.name`, `civ.${id}.bonuses`);
    }
    for (const id of Object.keys(data.resourceSources)) {
      expected.push(`resource.${id}`);
    }
    for (const id of [...Object.keys(data.mapTypes), ...Object.keys(data.mapSizes)]) {
      expected.push(`map.${id}`);
    }
    const english: Record<string, string> = en;
    const russian: Record<string, string> = ru;
    expect(expected.filter((key) => !english[key])).toEqual([]);
    expect(expected.filter((key) => !russian[key])).toEqual([]);
    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort());
  });
});

const position = { x: 1, y: 1 };

const EVENT_SAMPLES: { [T in SimEventType]: SimEventOf<T> } = {
  attackHit: { type: 'attackHit', attackerId: 1, attackerType: 'axeman', targetId: 2, position },
  projectileLaunched: { type: 'projectileLaunched', sourceId: 1, sourceType: 'bowman', position },
  entityDied: {
    type: 'entityDied',
    entityId: 1,
    entityKind: 'unit',
    entityType: 'villager',
    owner: 0,
    killerOwner: 1,
    position,
  },
  gatherStrike: { type: 'gatherStrike', entityId: 1, gatherKind: 'wood', position },
  constructionStrike: { type: 'constructionStrike', entityId: 1, buildingId: 2, position },
  buildingPlaced: { type: 'buildingPlaced', playerId: 0, buildingId: 2, buildingType: 'house', position },
  buildingCompleted: { type: 'buildingCompleted', playerId: 0, buildingId: 2, buildingType: 'house', position },
  unitTrained: { type: 'unitTrained', playerId: 0, entityId: 3, unitType: 'villager', position },
  researchCompleted: { type: 'researchCompleted', playerId: 0, technology: 'wheel', position },
  ageAdvanced: { type: 'ageAdvanced', playerId: 0, age: 'tool' },
  underAttack: { type: 'underAttack', playerId: 0, attackerOwner: 1, position },
  unitConverted: { type: 'unitConverted', entityId: 1, fromPlayerId: 1, toPlayerId: 0, position },
  housingShort: { type: 'housingShort', playerId: 0 },
  populationLimit: { type: 'populationLimit', playerId: 0 },
  insufficientResources: { type: 'insufficientResources', playerId: 0, resource: 'food' },
  commandRejected: { type: 'commandRejected', playerId: 0, command: 'train', reason: 'resources' },
  tribute: { type: 'tribute', fromPlayerId: 1, toPlayerId: 0, resource: 'food', amount: 100 },
  stanceChanged: { type: 'stanceChanged', playerId: 1, targetPlayerId: 0, stance: 'ally' },
  tradeCompleted: { type: 'tradeCompleted', playerId: 0, entityId: 1, gold: 20, position },
  relicCaptured: { type: 'relicCaptured', entityId: 1, entityType: 'ruin', playerId: 0, position },
  victoryTimerStarted: { type: 'victoryTimerStarted', kind: 'wonder', playerId: 0, endTick: 100 },
  victoryTimerReset: { type: 'victoryTimerReset', kind: 'wonder', playerId: 0 },
  playerDefeated: { type: 'playerDefeated', playerId: 1, resigned: false },
  gameOver: { type: 'gameOver', winners: [0], reason: 'conquest', players: [] },
};

describe('simulation events', () => {
  const screen = readFileSync(join(process.cwd(), 'src', 'ui', 'game', 'gameScreen.ts'), 'utf8');
  const handler = screen.slice(screen.indexOf('private notifyEvent('), screen.indexOf('private async autosave('));
  const notified = new Set([...handler.matchAll(/case '(\w+)':/g)].map((match) => match[1]));

  it('are emitted by the simulation sources', () => {
    const sources = ['core/entities.ts', 'core/orders.ts', 'effects/apply.ts']
      .concat(
        [
          'combat',
          'construction',
          'diplomacy',
          'gathering',
          'priests',
          'production',
          'projectiles',
          'relics',
          'research',
          'score',
          'trade',
          'tribute',
          'victory',
        ].map((name) => `systems/${name}.ts`),
      )
      .map((file) => readFileSync(join(process.cwd(), 'src', 'sim', file), 'utf8'))
      .join('\n');
    const silent = (Object.keys(EVENT_SAMPLES) as SimEventType[]).filter(
      (type) => !sources.includes(`type: '${type}'`) && !sources.includes(`'${type}'`),
    );
    expect(silent).toEqual([]);
  });

  it('are each mapped to a sound or to an interface notification', () => {
    expect(handler.length).toBeGreaterThan(0);
    const unmapped = (Object.keys(EVENT_SAMPLES) as SimEventType[]).filter(
      (type) => eventSound(EVENT_SAMPLES[type], 0) === null && !notified.has(type),
    );
    expect(unmapped).toEqual([]);
  });

  it('cover every notification of the game screen specification', () => {
    for (const type of [
      'underAttack',
      'housingShort',
      'insufficientResources',
      'researchCompleted',
      'ageAdvanced',
      'victoryTimerStarted',
      'playerDefeated',
    ]) {
      expect(notified.has(type), type).toBe(true);
    }
  });

  it('cover every sound event of the sound specification', () => {
    for (const type of [
      'attackHit',
      'projectileLaunched',
      'entityDied',
      'gatherStrike',
      'constructionStrike',
      'buildingCompleted',
      'researchCompleted',
      'unitTrained',
      'underAttack',
      'ageAdvanced',
    ] as const) {
      expect(eventSound(EVENT_SAMPLES[type], 0), type).not.toBeNull();
    }
  });
});
