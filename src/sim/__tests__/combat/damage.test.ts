import { describe, expect, it } from 'vitest';
import { combatProfile, strikeDamage, strikeOf } from '../../systems/combat';
import type { Entity, GameState } from '../../types';
import { addBuilding, addUnit, context, data, run, runUntil } from '../fixtures';
import { attackCommand, battlefield, eventsOf, raise, research, seconds } from './fixtures';

function damageBetween(state: GameState, attacker: Entity, target: Entity, elevation = 1): number {
  const attack = combatProfile(state, attacker, data);
  const defence = combatProfile(state, target, data);
  if (!attack || !defence) {
    throw new Error('missing combat profile');
  }
  return strikeDamage(strikeOf(state, attacker, attack, data), defence, elevation);
}

describe('damage formula', () => {
  it('subtracts melee armor and never drops below one', () => {
    const state = battlefield();
    const clubman = addUnit(state, 'clubman', 0, 5.5, 5.5);
    const swordsman = addUnit(state, 'short_swordsman', 1, 8.5, 5.5);
    const centurion = addUnit(state, 'centurion', 1, 11.5, 5.5);
    expect(damageBetween(state, clubman, swordsman)).toBe(2);
    expect(damageBetween(state, clubman, centurion)).toBe(1);
    expect(damageBetween(state, centurion, clubman)).toBe(30);
  });

  it('uses pierce armor against ranged attacks', () => {
    const state = battlefield();
    const bowman = addUnit(state, 'bowman', 0, 5.5, 5.5);
    const clubman = addUnit(state, 'clubman', 0, 5.5, 8.5);
    const horseArcher = addUnit(state, 'horse_archer', 1, 8.5, 5.5);
    expect(damageBetween(state, bowman, horseArcher)).toBe(1);
    expect(damageBetween(state, clubman, horseArcher)).toBe(3);
  });

  it('adds the cavalry bonus against barracks infantry only', () => {
    const state = battlefield();
    const cavalry = addUnit(state, 'cavalry', 0, 5.5, 5.5);
    const clubman = addUnit(state, 'clubman', 1, 8.5, 5.5);
    const hoplite = addUnit(state, 'hoplite', 1, 11.5, 5.5);
    expect(damageBetween(state, cavalry, clubman)).toBe(13);
    expect(damageBetween(state, cavalry, hoplite)).toBe(3);
  });

  it('multiplies chariot damage against priests', () => {
    const state = battlefield();
    const chariot = addUnit(state, 'chariot', 0, 5.5, 5.5);
    const chariotArcher = addUnit(state, 'chariot_archer', 0, 5.5, 8.5);
    const priest = addUnit(state, 'priest', 1, 8.5, 5.5);
    const villager = addUnit(state, 'villager', 1, 11.5, 5.5);
    expect(damageBetween(state, chariot, priest)).toBe(14);
    expect(damageBetween(state, chariotArcher, priest)).toBe(12);
    expect(damageBetween(state, chariot, villager)).toBe(7);
  });

  it('applies the elevation multipliers from game data', () => {
    const state = battlefield();
    const axeman = addUnit(state, 'axeman', 0, 5.5, 5.5);
    const villager = addUnit(state, 'villager', 1, 8.5, 5.5);
    const { highGroundMultiplier, lowGroundMultiplier } = data.game.elevation;
    expect(damageBetween(state, axeman, villager, highGroundMultiplier)).toBe(
      Math.round(5 * highGroundMultiplier),
    );
    expect(damageBetween(state, axeman, villager, lowGroundMultiplier)).toBe(
      Math.round(5 * lowGroundMultiplier),
    );
  });
});

describe('melee attacks', () => {
  it('hits on the attack interval and reports events', () => {
    const state = battlefield();
    const ctx = context();
    const clubman = addUnit(state, 'clubman', 0, 10.5, 10.5);
    const villager = addUnit(state, 'villager', 1, 11.3, 10.5);
    const first = run(state, ctx, 1, [attackCommand(0, [clubman], villager)]);
    expect(villager.hp).toBe(22);
    expect(clubman.state).toBe('attacking');
    expect(eventsOf(first, 'attackHit')).toHaveLength(1);
    expect(eventsOf(first, 'underAttack')).toEqual([
      { type: 'underAttack', playerId: 1, attackerOwner: 0, position: { x: 11.3, y: 10.5 } },
    ]);
    run(state, ctx, seconds(1.5) - 1);
    expect(villager.hp).toBe(22);
    run(state, ctx, 1);
    expect(villager.hp).toBe(19);
  });

  it('walks to the target before striking', () => {
    const state = battlefield();
    const ctx = context();
    const clubman = addUnit(state, 'clubman', 0, 5.5, 10.5);
    const villager = addUnit(state, 'villager', 1, 12.5, 10.5);
    run(state, ctx, 1, [attackCommand(0, [clubman], villager)]);
    expect(clubman.state).toBe('moving');
    expect(villager.hp).toBe(25);
    const ticks = runUntil(state, ctx, 400, () => villager.hp < 25);
    expect(ticks).toBeLessThan(400);
    expect(clubman.position.x).toBeGreaterThan(11);
  });

  it('deals more damage downhill and less uphill', () => {
    const state = battlefield();
    const ctx = context();
    raise(state, 10, 10, 2);
    raise(state, 20, 20, 2);
    const high = addUnit(state, 'axeman', 0, 10.5, 10.5);
    const lowVictim = addUnit(state, 'villager', 1, 11.3, 10.5);
    const low = addUnit(state, 'axeman', 0, 19.7, 20.5);
    const highVictim = addUnit(state, 'villager', 1, 20.5, 20.5);
    run(state, ctx, 1, [attackCommand(0, [high], lowVictim), attackCommand(0, [low], highVictim)]);
    expect(lowVictim.hp).toBe(25 - Math.round(5 * data.game.elevation.highGroundMultiplier));
    expect(highVictim.hp).toBe(25 - Math.round(5 * data.game.elevation.lowGroundMultiplier));
  });

  it('records kills and losses and finishes the order when the target dies', () => {
    const state = battlefield();
    const ctx = context();
    const centurion = addUnit(state, 'centurion', 0, 10.5, 10.5);
    const villager = addUnit(state, 'villager', 1, 11.3, 10.5);
    const events = run(state, ctx, 2, [attackCommand(0, [centurion], villager)]);
    expect(state.entities[villager.id]).toBeUndefined();
    expect(eventsOf(events, 'entityDied')[0]).toMatchObject({ entityId: villager.id, killerOwner: 0 });
    expect(state.players[0].stats.unitsKilled).toBe(1);
    expect(state.players[1].stats.unitsLost).toBe(1);
    expect(centurion.orders).toHaveLength(0);
    expect(centurion.state).toBe('idle');
  });

  it('counts razed buildings', () => {
    const state = battlefield();
    const ctx = context();
    const centurion = addUnit(state, 'centurion', 0, 9.5, 11.0);
    const house = addBuilding(state, 'house', 1, 10, 10);
    run(state, ctx, 1, [attackCommand(0, [centurion], house)]);
    runUntil(state, ctx, 400, () => state.entities[house.id] === undefined);
    expect(state.entities[house.id]).toBeUndefined();
    expect(state.players[0].stats.buildingsRazed).toBe(1);
    expect(state.players[1].stats.buildingsLost).toBe(1);
  });

  it('tramples every adjacent enemy unit but spares friends', () => {
    const state = battlefield();
    const ctx = context();
    const elephant = addUnit(state, 'war_elephant', 0, 10.5, 10.5);
    const target = addUnit(state, 'villager', 1, 11.6, 10.5);
    const neighbour = addUnit(state, 'villager', 1, 10.5, 11.6);
    const distant = addUnit(state, 'villager', 1, 14.5, 10.5);
    const friend = addUnit(state, 'villager', 0, 9.4, 10.5);
    run(state, ctx, 1, [attackCommand(0, [elephant], target)]);
    expect(target.hp).toBe(10);
    expect(neighbour.hp).toBe(10);
    expect(distant.hp).toBe(25);
    expect(friend.hp).toBe(25);
  });

  it('lets villagers damage walls and towers properly only with the flag', () => {
    const state = battlefield();
    const ctx = context();
    const villager = addUnit(state, 'villager', 0, 9.5, 10.5);
    const wall = addBuilding(state, 'small_wall', 1, 10, 10);
    const clubman = addUnit(state, 'clubman', 0, 9.5, 20.5);
    const otherWall = addBuilding(state, 'small_wall', 1, 10, 20);
    run(state, ctx, 1, [attackCommand(0, [villager], wall), attackCommand(0, [clubman], otherWall)]);
    expect(wall.hp).toBe(199);
    expect(otherWall.hp).toBe(197);
    research(state, 0, 'siegecraft');
    run(state, ctx, seconds(1.5));
    expect(wall.hp).toBe(196);
  });

  it('throttles under-attack alerts per area', () => {
    const state = battlefield(48);
    const ctx = context();
    const first = addUnit(state, 'clubman', 0, 10.5, 10.5);
    const second = addUnit(state, 'clubman', 0, 10.5, 12.5);
    const remote = addUnit(state, 'clubman', 0, 40.5, 40.5);
    const victims = [
      addUnit(state, 'villager', 1, 11.3, 10.5),
      addUnit(state, 'villager', 1, 11.3, 12.5),
      addUnit(state, 'villager', 1, 41.3, 40.5),
    ];
    const events = run(state, ctx, seconds(4), [
      attackCommand(0, [first], victims[0]),
      attackCommand(0, [second], victims[1]),
      attackCommand(0, [remote], victims[2]),
    ]);
    expect(eventsOf(events, 'attackHit').length).toBeGreaterThanOrEqual(6);
    expect(eventsOf(events, 'underAttack')).toHaveLength(2);
  });

  it('rejects attacks on own and allied entities and by unarmed units', () => {
    const state = battlefield(32, 'ally', 3);
    const ctx = context();
    state.players[0].diplomacy[2] = 'enemy';
    const clubman = addUnit(state, 'clubman', 0, 10.5, 10.5);
    const priest = addUnit(state, 'priest', 0, 10.5, 14.5);
    const own = addUnit(state, 'villager', 0, 12.5, 10.5);
    const allied = addUnit(state, 'villager', 1, 14.5, 10.5);
    const hostile = addUnit(state, 'villager', 2, 16.5, 10.5);
    const events = run(state, ctx, 1, [
      attackCommand(0, [clubman], own),
      attackCommand(0, [clubman], allied),
      attackCommand(0, [priest], hostile),
      attackCommand(0, [hostile], own),
    ]);
    expect(eventsOf(events, 'commandRejected').map((event) => event.reason)).toEqual([
      'invalid',
      'invalid',
      'invalid',
      'not_owner',
    ]);
    expect(clubman.orders).toHaveLength(0);
    expect(priest.orders).toHaveLength(0);
  });
});
