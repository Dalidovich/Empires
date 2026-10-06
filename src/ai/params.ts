import type { AiLevelDef } from '../data/types';

export interface AiParams {
  maxArmy: number;
  minAttackAge: number;
  attackArmyShare: number;
  attackCooldownTicks: number;
  attackDelayTicks: number;
  stallTicks: number;
  concedeTicks: number;
  retreatShare: number;
  scouting: number;
  priests: number;
  fishingBoats: number;
  warships: number;
  villagerShare: number;
  concurrentBuildings: number;
  defendRadius: number;
  houseMargin: number;
  tributePerStanceStep: number;
  wonder: number;
  relics: number;
  earlyArmy: number;
  stalemateTicks: number;
}

const DEFAULTS: AiParams = {
  maxArmy: 24,
  minAttackAge: 2,
  attackArmyShare: 0.6,
  attackCooldownTicks: 1800,
  attackDelayTicks: 3000,
  stallTicks: 16000,
  concedeTicks: 60000,
  retreatShare: 0.25,
  scouting: 1,
  priests: 1,
  fishingBoats: 4,
  warships: 3,
  villagerShare: 0.55,
  concurrentBuildings: 1,
  defendRadius: 14,
  houseMargin: 3,
  tributePerStanceStep: 400,
  wonder: 1,
  relics: 1,
  earlyArmy: 3,
  stalemateTicks: 24000,
};

export function resolveParams(level: AiLevelDef): AiParams {
  const params: AiParams = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as (keyof AiParams)[]) {
    const value = level.params[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      params[key] = value;
    }
  }
  return params;
}
