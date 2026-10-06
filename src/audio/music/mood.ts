import type { SimEvent } from '../../sim/events';
import type { PlayerId } from '../../sim/types';
import type { Mood } from './composer';

export const TENSION_HALF_LIFE = 12;
export const TENSION_LIMIT = 1.5;
export const UNDER_ATTACK_IMPULSE = 0.5;
export const CASUALTY_IMPULSE = 0.3;
export const BATTLE_ENTER = 0.7;
export const BATTLE_EXIT = 0.4;
export const TENSION_ENTER = 0.2;
export const TENSION_EXIT = 0.1;

function impulse(event: SimEvent, playerId: PlayerId): number {
  switch (event.type) {
    case 'underAttack':
      return event.playerId === playerId ? UNDER_ATTACK_IMPULSE : 0;
    case 'entityDied': {
      if (event.entityKind !== 'unit' && event.entityKind !== 'building') {
        return 0;
      }
      if (event.killerOwner === null || event.killerOwner < 0 || event.owner < 0) {
        return 0;
      }
      return event.owner === playerId || event.killerOwner === playerId ? CASUALTY_IMPULSE : 0;
    }
    default:
      return 0;
  }
}

export class GameMood {
  private tension = 0;
  private updatedAt = 0;
  private mood: Mood = 'calm';

  observe(events: readonly SimEvent[], playerId: PlayerId, now: number): void {
    this.decay(now);
    for (const event of events) {
      this.tension = Math.min(TENSION_LIMIT, this.tension + impulse(event, playerId));
    }
  }

  current(now: number): Mood {
    this.decay(now);
    if (this.tension >= BATTLE_ENTER || (this.mood === 'battle' && this.tension >= BATTLE_EXIT)) {
      this.mood = 'battle';
    } else if (this.tension >= TENSION_ENTER || (this.mood !== 'calm' && this.tension >= TENSION_EXIT)) {
      this.mood = 'tension';
    } else {
      this.mood = 'calm';
    }
    return this.mood;
  }

  reset(): void {
    this.tension = 0;
    this.updatedAt = 0;
    this.mood = 'calm';
  }

  private decay(now: number): void {
    const elapsed = now - this.updatedAt;
    if (elapsed > 0) {
      this.tension *= 0.5 ** (elapsed / TENSION_HALF_LIFE);
    }
    this.updatedAt = now;
  }
}
