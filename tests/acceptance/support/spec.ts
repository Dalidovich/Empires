import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgeId, Cost, ResourceKind } from '../../../src/data/types';
import { RESOURCE_KINDS } from '../../../src/data/types';
import ru from '../../../src/locales/ru.json';

const SPEC_PATH = join(process.cwd(), 'tests', 'acceptance', 'support', 'spec-appendices.md');

const APPENDIX_COUNT = 4;

const NONE = '—';

const AGES: Record<string, AgeId> = { Stone: 'stone', Tool: 'tool', Bronze: 'bronze', Iron: 'iron' };

const CIVILIZATION_CODES: Record<string, string> = {
  As: 'assyrian',
  Ba: 'babylonian',
  Ch: 'choson',
  Eg: 'egyptian',
  Gr: 'greek',
  Hi: 'hittite',
  Mi: 'minoan',
  Pe: 'persian',
  Ph: 'phoenician',
  Sh: 'shang',
  Su: 'sumerian',
  Ya: 'yamato',
};

const RESOURCE_NAMES: [string, ResourceKind][] = RESOURCE_KINDS.map((kind) => [
  ru[`resource.${kind}`].toLowerCase(),
  kind,
]);

export interface BuildingRow {
  id: string;
  age: AgeId;
  cost: Cost;
  buildTime: number;
  hp: number;
  note: string;
}

export interface UnitRow {
  building: string;
  id: string;
  cost: Cost;
  trainTime: number;
  hp: number;
  attack: number;
  attackInterval: number;
  armor: number;
  pierceArmor: number;
  range: number;
  speed: number;
}

export interface TechnologyRow {
  building: string;
  id: string;
  age: AgeId;
  cost: Cost;
  researchTime: number;
  unavailable: string[];
}

export interface CivilizationRow {
  id: string;
  bonuses: string;
}

export function toId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[()]/g, '')
    .replace(/\s+/g, '_');
}

function seconds(text: string): number {
  const [minutes, rest] = text.trim().split(':');
  return Number(minutes) * 60 + Number(rest);
}

function decimal(text: string): number {
  const trimmed = text.trim();
  return /^\d/.test(trimmed) ? Number(trimmed.replace(',', '.')) : 0;
}

function resourceByLetter(letter: string): ResourceKind {
  const found = RESOURCE_NAMES.find(([name]) => name.startsWith(letter.toLowerCase()));
  if (!found) {
    throw new Error(`Unknown resource letter "${letter}"`);
  }
  return found[1];
}

function resourceByWord(word: string): ResourceKind {
  const stem = word.trim().toLowerCase().slice(0, 2);
  const found = RESOURCE_NAMES.find(([name]) => name.startsWith(stem));
  if (!found) {
    throw new Error(`Unknown resource word "${word}"`);
  }
  return found[1];
}

function codedCost(text: string): Cost {
  const cost: Cost = {};
  for (const part of text.trim().split(/\s+/)) {
    cost[resourceByLetter(part.slice(-1))] = Number(part.slice(0, -1));
  }
  return cost;
}

function wordedCost(text: string): Cost {
  const cost: Cost = {};
  for (const part of text.split(',')) {
    const [amount, word] = part.trim().split(/\s+/);
    cost[resourceByWord(word)] = Number(amount);
  }
  return cost;
}

function specLines(): string[] {
  return readFileSync(SPEC_PATH, 'utf8').split(/\r?\n/);
}

function tables(): string[][][] {
  const found: string[][][] = [];
  let current: string[][] | null = null;
  for (const line of specLines()) {
    if (line.startsWith('|')) {
      current = current ?? [];
      current.push(
        line
          .slice(1, line.lastIndexOf('|'))
          .split('|')
          .map((cell) => cell.trim()),
      );
    } else if (current) {
      found.push(current.slice(2));
      current = null;
    }
  }
  if (current) {
    found.push(current.slice(2));
  }
  return found;
}

function appendix(index: number): string[][] {
  const all = tables();
  return all[all.length - APPENDIX_COUNT + index];
}

export function buildingRows(): BuildingRow[] {
  return appendix(0).map(([name, age, cost, time, hp, note]) => ({
    id: toId(name),
    age: AGES[age],
    cost: wordedCost(cost),
    buildTime: seconds(time),
    hp: Number(hp),
    note,
  }));
}

export function unitRows(): UnitRow[] {
  return appendix(1).map(
    ([building, name, cost, time, hp, attack, interval, armor, pierce, range, speed]) => ({
      building: toId(building),
      id: toId(name),
      cost: codedCost(cost),
      trainTime: seconds(time),
      hp: Number(hp),
      attack: decimal(attack),
      attackInterval: decimal(interval),
      armor: decimal(armor),
      pierceArmor: decimal(pierce),
      range: decimal(range),
      speed: decimal(speed),
    }),
  );
}

function expandShorthand(entry: string): string[] {
  const words = entry.trim().split(' ');
  if (!words[0].includes('/')) {
    return [entry.trim()];
  }
  const rest = words.slice(1).join(' ');
  return words[0].split('/').map((variant) => `${variant} ${rest}`);
}

export function unitAges(): Record<string, AgeId> {
  const line = specLines().find(
    (entry) => entry.includes(`Stone ${NONE}`) && entry.includes(`Iron ${NONE}`),
  );
  if (!line) {
    throw new Error('Unit ages note not found');
  }
  const ages: Record<string, AgeId> = {};
  const body = line.slice(line.indexOf(`Stone ${NONE}`), line.indexOf(`Iron ${NONE}`));
  for (const group of body.split(';')) {
    const [ageName, list] = group.split(NONE).map((part) => part.trim());
    const age = AGES[ageName];
    if (!age || !list) {
      continue;
    }
    for (const entry of list.split(',')) {
      for (const name of expandShorthand(entry)) {
        ages[toId(name)] = age;
      }
    }
  }
  return ages;
}

export function technologyRows(): TechnologyRow[] {
  return appendix(2).map(([building, name, age, cost, time, , unavailable]) => ({
    building: toId(building),
    id: toId(name),
    age: AGES[age],
    cost: codedCost(cost),
    researchTime: seconds(time),
    unavailable:
      unavailable === NONE
        ? []
        : unavailable.split(',').map((code) => {
            const id = CIVILIZATION_CODES[code.trim()];
            if (!id) {
              throw new Error(`Unknown civilization code "${code}"`);
            }
            return id;
          }),
  }));
}

export function civilizationRows(): CivilizationRow[] {
  return appendix(3).map(([name, bonuses]) => ({ id: toId(name), bonuses }));
}

export function noteNumbers(note: string): number[] {
  const tail = note.split(';')[1] ?? '';
  return (tail.match(/\d+(?:,\d+)?/g) ?? []).map(decimal);
}

export function noteName(note: string): { id: string; leading: boolean; exact: boolean } | null {
  const head = note.split(';')[0];
  const match = /[A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*/.exec(head);
  if (!match) {
    return null;
  }
  return { id: toId(match[0]), leading: match.index === 0, exact: match[0] === head.trim() };
}
