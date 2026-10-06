import type { GameData } from '../data/types';
import type { Command } from './commands';
import type { SimEvent } from './events';
import type { GameState } from './types';

export type LogLevel = 'warn' | 'error';

export type SimLogger = (level: LogLevel, tick: number, message: string) => void;

export interface StepContext {
  data: GameData;
  events: SimEvent[];
  log: SimLogger;
}

export type SystemId =
  | 'orders'
  | 'diplomacy'
  | 'tribute'
  | 'population'
  | 'production'
  | 'research'
  | 'construction'
  | 'gathering'
  | 'farms'
  | 'trade'
  | 'animals'
  | 'priests'
  | 'autoTarget'
  | 'combat'
  | 'projectiles'
  | 'transport'
  | 'movement'
  | 'relics'
  | 'visibility'
  | 'victory'
  | 'score';

export interface System {
  id: SystemId;
  handleCommand?(state: GameState, command: Command, ctx: StepContext): boolean;
  update?(state: GameState, ctx: StepContext): void;
}

export const consoleLogger: SimLogger = (level, tick, message) => {
  const line = `[tick ${tick}] ${message}`;
  if (level === 'error') {
    console.error(line);
  } else {
    console.warn(line);
  }
};

export function createStepContext(data: GameData, log: SimLogger = consoleLogger): StepContext {
  return { data, events: [], log };
}
