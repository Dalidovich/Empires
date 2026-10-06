import type { SimEvent } from '../sim/events';
import type { PlayerId, Vec2 } from '../sim/types';
import type { UiSound, UiSoundOptions } from './api';

export interface SoundRequest {
  candidates: string[];
  position: Vec2 | null;
  priority: boolean;
  minInterval: number;
}

export const SOUND = {
  select: 'select',
  acknowledge: 'acknowledge',
  hit: 'hit',
  shot: 'shot',
  death: 'death',
  gather: 'gather',
  build: 'build',
  place: 'place',
  convert: 'convert',
  trade: 'trade',
  buildingComplete: 'alert.building_complete',
  unitReady: 'alert.unit_ready',
  researchComplete: 'alert.research_complete',
  underAttack: 'alert.under_attack',
  ageAdvance: 'alert.age_advance',
  uiClick: 'ui.click',
  uiError: 'ui.error',
  uiVictory: 'ui.victory',
  uiDefeat: 'ui.defeat',
} as const;

export const EFFECT_INTERVAL = 0.08;
export const ALERT_INTERVAL = 0.5;
export const UNDER_ATTACK_INTERVAL = 5;
export const UI_INTERVAL = 0.03;

function effect(position: Vec2, ...candidates: string[]): SoundRequest {
  return { candidates, position, priority: false, minInterval: EFFECT_INTERVAL };
}

function alert(id: string, minInterval: number = ALERT_INTERVAL): SoundRequest {
  return { candidates: [id], position: null, priority: true, minInterval };
}

function ownAlert(owner: PlayerId, listener: PlayerId, id: string, minInterval?: number): SoundRequest | null {
  return owner === listener ? alert(id, minInterval) : null;
}

export function eventSound(event: SimEvent, listener: PlayerId): SoundRequest | null {
  switch (event.type) {
    case 'attackHit':
      return effect(event.position, `${SOUND.hit}.${event.attackerType}`, SOUND.hit);
    case 'projectileLaunched':
      return effect(event.position, `${SOUND.shot}.${event.sourceType}`, SOUND.shot);
    case 'entityDied':
      if (event.entityKind !== 'unit' && event.entityKind !== 'building') {
        return null;
      }
      return effect(
        event.position,
        `${SOUND.death}.${event.entityType}`,
        `${SOUND.death}.${event.entityKind}`,
      );
    case 'gatherStrike':
      return effect(event.position, `${SOUND.gather}.${event.gatherKind}`, SOUND.gather);
    case 'constructionStrike':
      return effect(event.position, SOUND.build);
    case 'buildingPlaced':
      return effect(event.position, SOUND.place);
    case 'unitConverted':
      return effect(event.position, SOUND.convert);
    case 'tradeCompleted':
      return effect(event.position, SOUND.trade);
    case 'buildingCompleted':
      return ownAlert(event.playerId, listener, SOUND.buildingComplete);
    case 'unitTrained':
      return ownAlert(event.playerId, listener, SOUND.unitReady);
    case 'researchCompleted':
      return ownAlert(event.playerId, listener, SOUND.researchComplete);
    case 'ageAdvanced':
      return ownAlert(event.playerId, listener, SOUND.ageAdvance);
    case 'underAttack':
      return ownAlert(event.playerId, listener, SOUND.underAttack, UNDER_ATTACK_INTERVAL);
    default:
      return null;
  }
}

function ui(...candidates: string[]): SoundRequest {
  return { candidates, position: null, priority: true, minInterval: UI_INTERVAL };
}

function perEntity(base: string, options: UiSoundOptions | undefined): SoundRequest {
  return options?.entityType ? ui(`${base}.${options.entityType}`, base) : ui(base);
}

export function uiSoundRequest(sound: UiSound, options?: UiSoundOptions): SoundRequest {
  switch (sound) {
    case 'click':
      return ui(SOUND.uiClick);
    case 'select':
      return perEntity(SOUND.select, options);
    case 'acknowledge':
      return perEntity(SOUND.acknowledge, options);
    case 'error':
      return ui(SOUND.uiError);
    case 'victory':
      return ui(SOUND.uiVictory);
    case 'defeat':
      return ui(SOUND.uiDefeat);
  }
}
