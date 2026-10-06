import { loadGameData } from '../data';
import type {
  AttackBonus,
  BuildingDef,
  Cost,
  GameData,
  GatherKind,
  PlayerFlag,
  TechnologyDef,
  UnitDef,
} from '../data/types';
import type { ConversionParams, PlayerModifierSet } from './effects/modifiers';
import { compileModifiers, modifiedBuilding, modifiedUnit, modifiersOf } from './effects/modifiers';
import type { Entity, GameState, PlayerId } from './types';

export type UnitStats = UnitDef;

export type BuildingStats = BuildingDef;

export type { ConversionParams } from './effects/modifiers';

const neutralModifiers = new WeakMap<GameData, PlayerModifierSet>();

function modifiersFor(state: GameState, playerId: PlayerId, data: GameData): PlayerModifierSet {
  const player = state.players[playerId];
  if (player) {
    return modifiersOf(player, data);
  }
  let neutral = neutralModifiers.get(data);
  if (!neutral) {
    neutral = compileModifiers('', [], data);
    neutralModifiers.set(data, neutral);
  }
  return neutral;
}

export function getUnitStats(
  state: GameState,
  playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): UnitStats {
  const def = data.units[typeId];
  if (!def) {
    throw new Error(`Unknown unit type: ${typeId}`);
  }
  return modifiedUnit(modifiersFor(state, playerId, data), def);
}

export function getBuildingStats(
  state: GameState,
  playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): BuildingStats {
  const def = data.buildings[typeId];
  if (!def) {
    throw new Error(`Unknown building type: ${typeId}`);
  }
  return modifiedBuilding(modifiersFor(state, playerId, data), def);
}

export function getGatherRate(
  state: GameState,
  playerId: PlayerId,
  kind: GatherKind,
  data: GameData = loadGameData(),
): number {
  return modifiersFor(state, playerId, data).gatherRates[kind];
}

export function getCarryCapacity(
  state: GameState,
  playerId: PlayerId,
  kind: GatherKind,
  data: GameData = loadGameData(),
): number {
  return modifiersFor(state, playerId, data).carryCapacity[kind];
}

export function getFarmFood(
  state: GameState,
  playerId: PlayerId,
  data: GameData = loadGameData(),
): number {
  return modifiersFor(state, playerId, data).farmFood;
}

export function getConversionParams(
  state: GameState,
  playerId: PlayerId,
  data: GameData = loadGameData(),
): ConversionParams {
  return modifiersFor(state, playerId, data).conversion;
}

export function hasPlayerFlag(
  state: GameState,
  playerId: PlayerId,
  flag: PlayerFlag,
  data: GameData = loadGameData(),
): boolean {
  const player = state.players[playerId];
  if (!player) {
    return false;
  }
  return player.modifiers.flags[flag] === true || modifiersOf(player, data).flags[flag] === true;
}

export function getUnitCost(
  state: GameState,
  playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): Cost {
  return getUnitStats(state, playerId, typeId, data).cost;
}

export function getBuildingCost(
  state: GameState,
  playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): Cost {
  return getBuildingStats(state, playerId, typeId, data).cost;
}

export function getTrainTime(
  state: GameState,
  playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): number {
  return getUnitStats(state, playerId, typeId, data).trainTime;
}

export function getBuildTime(
  state: GameState,
  playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): number {
  return getBuildingStats(state, playerId, typeId, data).buildTime;
}

function technologyOf(typeId: string, data: GameData): TechnologyDef {
  const def = data.technologies[typeId];
  if (!def) {
    throw new Error(`Unknown technology: ${typeId}`);
  }
  return def;
}

export function getTechnologyCost(
  _state: GameState,
  _playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): Cost {
  return technologyOf(typeId, data).cost;
}

export function getResearchTime(
  _state: GameState,
  _playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): number {
  return technologyOf(typeId, data).researchTime;
}

export function getAttackBonuses(
  state: GameState,
  playerId: PlayerId,
  typeId: string,
  data: GameData = loadGameData(),
): readonly AttackBonus[] {
  return getUnitStats(state, playerId, typeId, data).bonuses;
}

export function getEntityMaxHp(
  state: GameState,
  entity: Entity,
  data: GameData = loadGameData(),
): number {
  const owner = entity.statsOwner ?? entity.owner;
  if (entity.kind === 'unit' && data.units[entity.type]) {
    return getUnitStats(state, owner, entity.type, data).hp;
  }
  if (entity.kind === 'building' && data.buildings[entity.type]) {
    return getBuildingStats(state, owner, entity.type, data).hp;
  }
  return entity.hp;
}
