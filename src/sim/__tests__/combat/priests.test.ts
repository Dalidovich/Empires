import { describe, expect, it } from 'vitest';
import type { Command } from '../../commands';
import { seedRng } from '../../rng';
import { combatProfile } from '../../systems/combat';
import { canConvert, conversionChance } from '../../systems/priests';
import type { Entity, GameState } from '../../types';
import { addBuilding, addUnit, context, data, run, runUntil } from '../fixtures';
import { battlefield, eventsOf, research, seconds } from './fixtures';

const ATTEMPT_TICKS = seconds(data.game.conversion.attemptInterval);
const FREE_ATTEMPTS = data.game.conversion.guaranteedFailures;

function convertCommand(priest: Entity, target: Entity): Command {
  return {
    type: 'convert',
    playerId: priest.owner,
    entityIds: [priest.id],
    targetId: target.id,
    queued: false,
  };
}

function healCommand(priest: Entity, target: Entity): Command {
  return {
    type: 'heal',
    playerId: priest.owner,
    entityIds: [priest.id],
    targetId: target.id,
    queued: false,
  };
}

function duel(seed = 1): { state: GameState; priest: Entity; target: Entity } {
  const state = battlefield();
  state.rngState = seedRng(seed);
  const priest = addUnit(state, 'priest', 0, 10.5, 10.5);
  const target = addUnit(state, 'villager', 1, 17.5, 10.5);
  return { state, priest, target };
}

function conversionTick(seed: number, technologies: string[] = []): number {
  const { state, priest, target } = duel(seed);
  research(state, 0, ...technologies);
  const ctx = context();
  run(state, ctx, 1, [convertCommand(priest, target)]);
  runUntil(state, ctx, 4000, () => target.owner === 0);
  return state.tick;
}

describe('conversion attempts', () => {
  it('always fail for the first three attempts', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { state, priest, target } = duel(seed);
      const ctx = context();
      run(state, ctx, ATTEMPT_TICKS * (FREE_ATTEMPTS + 1) - 1, [convertCommand(priest, target)]);
      expect(target.owner).toBe(1);
      expect(priest.state).toBe('converting');
    }
  });

  it('succeed only on attempt boundaries after the guaranteed failures', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const tick = conversionTick(seed);
      expect(tick % ATTEMPT_TICKS).toBe(0);
      expect(tick / ATTEMPT_TICKS).toBeGreaterThan(FREE_ATTEMPTS);
    }
  });

  it('succeed on the fourth attempt at roughly the configured rate', () => {
    const seeds = 200;
    const convertedOnFourth = (seed: number, technologies: string[]): boolean => {
      const { state, priest, target } = duel(seed);
      research(state, 0, ...technologies);
      run(state, context(), ATTEMPT_TICKS * (FREE_ATTEMPTS + 1), [convertCommand(priest, target)]);
      return target.owner === 0;
    };
    let base = 0;
    let boosted = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      base += convertedOnFourth(seed, []) ? 1 : 0;
      boosted += convertedOnFourth(seed, ['astrology']) ? 1 : 0;
    }
    expect(base / seeds).toBeGreaterThan(0.22);
    expect(base / seeds).toBeLessThan(0.38);
    expect(boosted).toBeGreaterThan(base);
    expect(boosted / seeds).toBeLessThan(0.48);
  }, 30000);

  it('are deterministic for a given seed', () => {
    expect(conversionTick(7)).toBe(conversionTick(7));
  });

  it('read the chance from the stats layer and respect chariot resistance', () => {
    const { state, priest, target } = duel();
    const chariot = addUnit(state, 'chariot', 1, 17.5, 14.5);
    expect(conversionChance(state, priest, target, data)).toBeCloseTo(0.3, 5);
    expect(conversionChance(state, priest, chariot, data)).toBeCloseTo(0.15, 5);
    research(state, 0, 'astrology');
    expect(conversionChance(state, priest, target, data)).toBeCloseTo(0.39, 5);
  });

  it('walk into range first', () => {
    const state = battlefield(48);
    const ctx = context();
    const priest = addUnit(state, 'priest', 0, 5.5, 10.5);
    const target = addUnit(state, 'villager', 1, 30.5, 10.5);
    run(state, ctx, 2, [convertCommand(priest, target)]);
    expect(priest.state).toBe('moving');
    runUntil(state, ctx, 4000, () => target.owner === 0);
    expect(target.owner).toBe(0);
    expect(priest.position.x).toBeGreaterThan(19);
    expect(priest.position.x).toBeLessThan(22);
  });
});

describe('conversion result', () => {
  it('changes the owner, reports the event and counts the conversion', () => {
    const { state, priest, target } = duel();
    const ctx = context();
    target.orders.push({ type: 'move', target: { x: 17.5, y: 10.5 } });
    const events = run(state, ctx, 1, [convertCommand(priest, target)]);
    while (target.owner !== 0 && state.tick < 4000) {
      events.push(...run(state, ctx, 1));
    }
    expect(target.owner).toBe(0);
    expect(target.statsOwner).toBe(1);
    expect(target.orders).toHaveLength(0);
    expect(eventsOf(events, 'unitConverted')).toEqual([
      {
        type: 'unitConverted',
        entityId: target.id,
        fromPlayerId: 1,
        toPlayerId: 0,
        position: { x: target.position.x, y: target.position.y },
      },
    ]);
    expect(state.players[0].stats.conversions).toBe(1);
    expect(priest.orders).toHaveLength(0);
    expect(priest.faith).toBeLessThan(1);
  });

  it('empties the faith, which recharges at the configured rate', () => {
    const { state, priest, target } = duel();
    const ctx = context();
    run(state, ctx, 1, [convertCommand(priest, target)]);
    runUntil(state, ctx, 4000, () => target.owner === 0);
    const converted = state.tick;
    run(state, ctx, seconds(10));
    const elapsed = (state.tick - converted) / data.game.tickRate;
    expect(priest.faith).toBeCloseTo(elapsed * data.game.conversion.faithRechargeRate, 0);
    run(state, ctx, seconds(45));
    expect(priest.faith).toBe(data.game.conversion.faithMax);
  });

  it('recharges faster with fanaticism', () => {
    const { state, priest, target } = duel();
    const ctx = context();
    research(state, 0, 'fanaticism');
    run(state, ctx, 1, [convertCommand(priest, target)]);
    runUntil(state, ctx, 4000, () => target.owner === 0);
    run(state, ctx, seconds(10));
    expect(priest.faith).toBeGreaterThan(29);
    expect(priest.faith).toBeLessThan(32);
  });

  it('blocks further conversions until the faith is full', () => {
    const { state, priest, target } = duel();
    const ctx = context();
    const second = addUnit(state, 'villager', 1, 17.5, 13.5);
    run(state, ctx, 1, [convertCommand(priest, target)]);
    runUntil(state, ctx, 4000, () => target.owner === 0);
    const converted = state.tick;
    run(state, ctx, 1, [convertCommand(priest, second)]);
    const rechargeTicks = seconds(
      data.game.conversion.faithMax / data.game.conversion.faithRechargeRate,
    );
    run(state, ctx, rechargeTicks - 5);
    expect(second.owner).toBe(1);
    expect(priest.conversionProgress).toBe(0);
    runUntil(state, ctx, 4000, () => second.owner === 0);
    expect(second.owner).toBe(0);
    expect(state.tick - converted).toBeGreaterThanOrEqual(
      rechargeTicks + ATTEMPT_TICKS * (FREE_ATTEMPTS + 1) - 2,
    );
  });

  it('keeps the previous owner stats and upgrades as of the conversion', () => {
    const state = battlefield();
    const ctx = context();
    research(state, 1, 'toolworking');
    const priest = addUnit(state, 'priest', 0, 10.5, 10.5);
    const target = addUnit(state, 'clubman', 1, 18.5, 10.5);
    const native = addUnit(state, 'clubman', 0, 5.5, 5.5);
    run(state, ctx, 1, [convertCommand(priest, target)]);
    runUntil(state, ctx, 4000, () => target.owner === 0);
    expect(target.owner).toBe(0);
    expect(combatProfile(state, target, data)?.attack).toBe(5);
    expect(combatProfile(state, native, data)?.attack).toBe(3);
    research(state, 1, 'metalworking');
    research(state, 0, 'toolworking', 'leather_armor_infantry');
    run(state, ctx, 2);
    expect(combatProfile(state, target, data)?.attack).toBe(5);
    expect(combatProfile(state, target, data)?.armor).toBe(0);
    expect(combatProfile(state, native, data)?.attack).toBe(5);
    expect(combatProfile(state, native, data)?.armor).toBe(2);
  });
});

describe('conversion restrictions', () => {
  it('needs monotheism for priests and buildings', () => {
    const state = battlefield(40);
    const ctx = context();
    const priest = addUnit(state, 'priest', 0, 10.5, 10.5);
    const rival = addUnit(state, 'priest', 1, 17.5, 10.5);
    const house = addBuilding(state, 'house', 1, 17, 14);
    expect(canConvert(state, priest, rival, data)).toBe(false);
    expect(canConvert(state, priest, house, data)).toBe(false);
    const events = run(state, ctx, 1, [convertCommand(priest, rival), convertCommand(priest, house)]);
    expect(eventsOf(events, 'commandRejected').map((event) => event.reason)).toEqual([
      'unavailable',
      'unavailable',
    ]);
    research(state, 0, 'monotheism');
    expect(canConvert(state, priest, rival, data)).toBe(true);
    expect(canConvert(state, priest, house, data)).toBe(true);
    run(state, ctx, 1, [convertCommand(priest, house)]);
    runUntil(state, ctx, 4000, () => house.owner === 0);
    expect(house.owner).toBe(0);
  });

  it('never allows town centers, wonders, walls and towers', () => {
    const state = battlefield(48);
    const priest = addUnit(state, 'priest', 0, 5.5, 5.5);
    research(state, 0, 'monotheism');
    const protectedBuildings = [
      addBuilding(state, 'town_center', 1, 10, 10),
      addBuilding(state, 'wonder', 1, 20, 10),
      addBuilding(state, 'small_wall', 1, 30, 10),
      addBuilding(state, 'watch_tower', 1, 35, 10),
    ];
    for (const building of protectedBuildings) {
      expect(canConvert(state, priest, building, data)).toBe(false);
    }
  });

  it('never allows own, allied and gaia entities', () => {
    const state = battlefield(32, 'ally');
    const priest = addUnit(state, 'priest', 0, 5.5, 5.5);
    const own = addUnit(state, 'villager', 0, 8.5, 5.5);
    const allied = addUnit(state, 'villager', 1, 11.5, 5.5);
    const gazelle = addUnit(state, 'gazelle', -1, 14.5, 5.5);
    expect(canConvert(state, priest, own, data)).toBe(false);
    expect(canConvert(state, priest, allied, data)).toBe(false);
    expect(canConvert(state, priest, gazelle, data)).toBe(false);
  });
});

describe('automatic conversion', () => {
  it('targets an enemy unit in sight when the faith is full', () => {
    const { state, priest, target } = duel();
    const ctx = context();
    runUntil(state, ctx, seconds(5), () => priest.orders.length > 0);
    expect(priest.orders[0]).toEqual({ type: 'convert', targetId: target.id });
    runUntil(state, ctx, 4000, () => target.owner === 0);
    expect(target.owner).toBe(0);
  });

  it('waits for the faith to recharge', () => {
    const { state, priest, target } = duel();
    const ctx = context();
    priest.faith = 0;
    run(state, ctx, seconds(5));
    expect(priest.orders).toHaveLength(0);
    expect(target.owner).toBe(1);
  });

  it('holds position on stand ground when the enemy is out of range', () => {
    const state = battlefield();
    const ctx = context();
    const priest = addUnit(state, 'priest', 0, 4.5, 10.5);
    addUnit(state, 'villager', 1, 4.5 + data.units.priest.range + 2, 10.5);
    priest.standGround = true;
    run(state, ctx, seconds(5));
    expect(priest.orders).toHaveLength(0);
    expect(priest.position.x).toBe(4.5);
  });

  it('gives up on a target that leaves the leash and walks back', () => {
    const state = battlefield(48);
    const ctx = context();
    const priest = addUnit(state, 'priest', 0, 4.5, 10.5);
    const runner = addUnit(state, 'villager', 1, 4.5 + data.units.priest.lineOfSight - 1, 10.5);
    runUntil(state, ctx, seconds(5), () => priest.orders.length > 0);
    expect(priest.orders[0]).toEqual({ type: 'convert', targetId: runner.id });
    run(state, ctx, 1, [
      {
        type: 'move',
        playerId: 1,
        entityIds: [runner.id],
        target: { x: 44.5, y: 10.5 },
        queued: false,
      },
    ]);
    runUntil(state, ctx, seconds(120), () => runner.position.x > 40 && priest.orders.length === 0);
    expect(runner.owner).toBe(1);
    expect(Math.abs(priest.position.x - 4.5)).toBeLessThanOrEqual(1);
  });
});

describe('healing', () => {
  it('restores friendly units at the heal rate up to full health', () => {
    const state = battlefield();
    const ctx = context();
    const priest = addUnit(state, 'priest', 0, 10.5, 10.5);
    const clubman = addUnit(state, 'clubman', 0, 15.5, 10.5);
    clubman.hp = 10;
    run(state, ctx, seconds(5), [healCommand(priest, clubman)]);
    expect(priest.state).toBe('healing');
    expect(clubman.hp).toBe(10 + 5 * (data.units.priest.healRate ?? 0));
    run(state, ctx, seconds(10));
    expect(clubman.hp).toBe(40);
    expect(priest.orders).toHaveLength(0);
  });

  it('starts on its own for a wounded friendly unit in sight and returns afterwards', () => {
    const state = battlefield();
    const ctx = context();
    const priest = addUnit(state, 'priest', 0, 4.5, 10.5);
    const clubman = addUnit(state, 'clubman', 0, 4.5 + data.units.priest.lineOfSight - 1, 10.5);
    clubman.hp = 10;
    runUntil(state, ctx, seconds(10), () => priest.state === 'healing');
    expect(priest.orders[0]).toEqual({ type: 'heal', targetId: clubman.id });
    runUntil(state, ctx, seconds(60), () => clubman.hp === data.units.clubman.hp);
    expect(clubman.hp).toBe(data.units.clubman.hp);
    runUntil(
      state,
      ctx,
      seconds(60),
      () => priest.orders.length === 0 && Math.abs(priest.position.x - 4.5) <= 1,
    );
    expect(Math.abs(priest.position.x - 4.5)).toBeLessThanOrEqual(1);
    expect(priest.orders).toHaveLength(0);
  });

  it('is left to the controller for an AI player', () => {
    const state = battlefield();
    const ctx = context();
    state.players[0].kind = 'ai';
    const priest = addUnit(state, 'priest', 0, 10.5, 10.5);
    const clubman = addUnit(state, 'clubman', 0, 12.5, 10.5);
    const enemy = addUnit(state, 'villager', 1, 14.5, 10.5);
    clubman.hp = 10;
    run(state, ctx, seconds(3));
    expect(priest.orders).toHaveLength(0);
    expect(clubman.hp).toBe(10);
    expect(enemy.owner).toBe(1);
  });

  it('refuses ships, machines and enemies', () => {
    const state = battlefield();
    const ctx = context();
    const priest = addUnit(state, 'priest', 0, 10.5, 10.5);
    const machine = addUnit(state, 'stone_thrower', 0, 15.5, 10.5);
    const ship = addUnit(state, 'scout_ship', 0, 15.5, 14.5);
    const enemy = addUnit(state, 'villager', 1, 28.5, 28.5);
    machine.hp = 10;
    ship.hp = 10;
    enemy.hp = 10;
    const events = run(state, ctx, seconds(2), [
      healCommand(priest, machine),
      healCommand(priest, ship),
      healCommand(priest, enemy),
    ]);
    expect(eventsOf(events, 'commandRejected')).toHaveLength(3);
    expect(machine.hp).toBe(10);
    expect(ship.hp).toBe(10);
    expect(enemy.hp).toBe(10);
  });
});
