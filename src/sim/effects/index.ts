import type { PlayerModifiers } from '../types';

export * from './modifiers';
export * from './availability';
export * from './apply';

export function createPlayerModifiers(): PlayerModifiers {
  return { flags: {}, state: null };
}
