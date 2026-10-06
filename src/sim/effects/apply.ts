import type { GameData } from '../../data/types';
import { occupyFootprint, releaseFootprint } from '../core/entities';
import type { StatKey } from '../playerStats';
import { recordStat } from '../playerStats';
import type { StepContext } from '../system';
import type { Entity, EntityId, GameState, JsonValue, Player, Vec2 } from '../types';
import type { PlayerModifierSet } from './modifiers';
import {
  ageIndex,
  modifiedBuilding,
  modifiedUnit,
  modifiersOf,
  restrictionsOf,
  upgradedBuildingType,
  upgradedUnitType,
} from './modifiers';

interface ModifierMarker {
  civilization: string;
  researched: number;
}

const AGE_STAT: Partial<Record<string, StatKey>> = {
  tool: 'toolAgeTick',
  bronze: 'bronzeAgeTick',
  iron: 'ironAgeTick',
};

function markerOf(player: Player): ModifierMarker | null {
  const marker = player.modifiers.state;
  if (marker === null || typeof marker !== 'object' || Array.isArray(marker)) {
    return null;
  }
  return marker as unknown as ModifierMarker;
}

function usesOwnStats(entity: Entity, player: Player): boolean {
  return entity.owner === player.id && (entity.statsOwner === null || entity.statsOwner === player.id);
}

function maxHpOf(modifiers: PlayerModifierSet, entity: Entity, data: GameData): number | null {
  if (entity.kind === 'unit') {
    const def = data.units[entity.type];
    return def ? modifiedUnit(modifiers, def).hp : null;
  }
  if (entity.kind === 'building') {
    const def = data.buildings[entity.type];
    return def ? modifiedBuilding(modifiers, def).hp : null;
  }
  return null;
}

function baseHpOf(entity: Entity, data: GameData): number | null {
  if (entity.kind === 'unit') {
    return data.units[entity.type]?.hp ?? null;
  }
  if (entity.kind === 'building') {
    return data.buildings[entity.type]?.hp ?? null;
  }
  return null;
}

function isFoundation(entity: Entity): boolean {
  return entity.kind === 'building' && entity.buildProgress !== null && entity.buildProgress < 1;
}

function raiseInitialHp(state: GameState, player: Player, data: GameData): void {
  const modifiers = modifiersOf(player, data);
  for (const entity of Object.values(state.entities)) {
    if (!usesOwnStats(entity, player) || isFoundation(entity)) {
      continue;
    }
    const base = baseHpOf(entity, data);
    const max = maxHpOf(modifiers, entity, data);
    if (base !== null && max !== null && max !== base && entity.hp === base) {
      entity.hp = max;
    }
  }
}

function syncPlayer(state: GameState, player: Player, data: GameData): void {
  const marker = markerOf(player);
  if (
    marker &&
    marker.civilization === player.civilization &&
    marker.researched === player.researched.length
  ) {
    return;
  }
  const modifiers = modifiersOf(player, data);
  for (const flag of Object.keys(modifiers.flags) as (keyof typeof modifiers.flags)[]) {
    if (modifiers.flags[flag]) {
      player.modifiers.flags[flag] = true;
    }
  }
  if (modifiers.flags.shared_exploration) {
    player.sharedExploration = true;
  }
  if (modifiers.age !== null && ageIndex(modifiers.age) > ageIndex(player.age)) {
    player.age = modifiers.age;
  }
  if (marker === null) {
    raiseInitialHp(state, player, data);
  }
  const next: ModifierMarker = {
    civilization: player.civilization,
    researched: player.researched.length,
  };
  player.modifiers.state = next as unknown as JsonValue;
}

export function syncPlayerModifiers(state: GameState, data: GameData): void {
  for (const player of state.players) {
    syncPlayer(state, player, data);
  }
}

function grantedTechnologies(player: Player, data: GameData): string[] {
  const disabled = restrictionsOf(player, data)?.disabledTechs ?? [];
  const ordered = Object.values(data.technologies)
    .map((def, index) => ({ def, index }))
    .sort((a, b) => ageIndex(a.def.age) - ageIndex(b.def.age) || a.index - b.index);
  const granted: string[] = [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const { def } of ordered) {
      if (granted.includes(def.id) || disabled.includes(def.id)) {
        continue;
      }
      if (def.requires.every((required) => granted.includes(required))) {
        granted.push(def.id);
        grew = true;
      }
    }
  }
  return granted;
}

export function grantAllTechnologies(state: GameState, data: GameData): void {
  for (const player of state.players) {
    player.researched = grantedTechnologies(player, data);
  }
  syncPlayerModifiers(state, data);
}

function retype(state: GameState, entity: Entity, type: string, data: GameData): void {
  if (entity.kind !== 'building') {
    entity.type = type;
    return;
  }
  const resized = data.buildings[entity.type]?.size !== data.buildings[type]?.size;
  if (resized) {
    releaseFootprint(state, entity, data);
  }
  entity.type = type;
  if (resized) {
    occupyFootprint(state, entity, data);
  }
}

function applyUpgrades(
  state: GameState,
  entity: Entity,
  modifiers: PlayerModifierSet,
  data: GameData,
): void {
  if (entity.kind === 'unit') {
    const next = upgradedUnitType(modifiers, entity.type);
    if (next !== entity.type && data.units[next]) {
      retype(state, entity, next, data);
    }
    return;
  }
  if (entity.kind !== 'building') {
    return;
  }
  const next = upgradedBuildingType(modifiers, entity.type);
  if (next !== entity.type && data.buildings[next]) {
    retype(state, entity, next, data);
  }
  for (const item of entity.queue) {
    const unit = upgradedUnitType(modifiers, item.unit);
    if (data.units[unit]) {
      item.unit = unit;
    }
  }
}

function adjustHp(entity: Entity, before: number, after: number): void {
  if (before === after || before <= 0) {
    return;
  }
  if (isFoundation(entity)) {
    entity.hp = Math.max(1, (entity.hp * after) / before);
    return;
  }
  entity.hp = Math.min(after, Math.max(1, entity.hp + after - before));
}

function isFarm(entity: Entity, data: GameData): boolean {
  return entity.kind === 'building' && (data.buildings[entity.type]?.class.includes('farm') ?? false);
}

export function completeResearch(
  state: GameState,
  playerId: number,
  technologyId: string,
  ctx: StepContext,
  position: Vec2,
): void {
  const data = ctx.data;
  const player = state.players[playerId];
  const technology = data.technologies[technologyId];
  if (!player || !technology || player.researched.includes(technologyId)) {
    return;
  }
  const previous = modifiersOf(player, data);
  const owned: Entity[] = [];
  const hpBefore = new Map<EntityId, number>();
  for (const entity of Object.values(state.entities)) {
    if (!usesOwnStats(entity, player)) {
      continue;
    }
    owned.push(entity);
    const max = maxHpOf(previous, entity, data);
    if (max !== null) {
      hpBefore.set(entity.id, max);
    }
  }
  const previousAge = player.age;
  player.researched.push(technologyId);
  const modifiers = modifiersOf(player, data);
  const farmFoodGain = modifiers.farmFood - previous.farmFood;
  for (const entity of owned) {
    applyUpgrades(state, entity, modifiers, data);
    const before = hpBefore.get(entity.id);
    const after = maxHpOf(modifiers, entity, data);
    if (before !== undefined && after !== null) {
      adjustHp(entity, before, after);
    }
    if (farmFoodGain !== 0 && entity.amount !== null && isFarm(entity, data)) {
      entity.amount = Math.max(0, entity.amount + farmFoodGain);
    }
  }
  syncPlayer(state, player, data);
  recordStat(state, playerId, 'technologiesResearched', 1);
  ctx.events.push({
    type: 'researchCompleted',
    playerId,
    technology: technologyId,
    position: { x: position.x, y: position.y },
  });
  if (player.age !== previousAge) {
    const stat = AGE_STAT[player.age];
    if (stat && (player.stats[stat] ?? 0) === 0) {
      recordStat(state, playerId, stat, state.tick);
    }
    ctx.events.push({ type: 'ageAdvanced', playerId, age: player.age });
  }
}
