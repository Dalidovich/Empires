import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from '../../data';
import en from '../../locales/en.json';
import ru from '../../locales/ru.json';
import { onLanguageChange, setLanguage, t } from '../i18n';

const UI_ROOT = join(process.cwd(), 'src', 'ui');

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') {
        files.push(...sourceFiles(path));
      }
    } else if (name.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('i18n', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('keeps identical key sets in both locales', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort());
  });

  it('has no empty values and keeps placeholders in sync', () => {
    const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();
    const russian: Record<string, string> = ru;
    for (const [key, value] of Object.entries(en)) {
      expect(value.length, key).toBeGreaterThan(0);
      expect(russian[key].length, key).toBeGreaterThan(0);
      expect(placeholders(russian[key]), key).toEqual(placeholders(value));
    }
  });

  it('translates by the current language and falls back to the key', () => {
    expect(t('resource.food')).toBe(en['resource.food']);
    setLanguage('ru');
    expect(t('resource.food')).toBe(ru['resource.food']);
    expect(t('missing.key')).toBe('missing.key');
  });

  it('substitutes parameters and keeps unknown placeholders', () => {
    expect(t('ui.setup.computer', { n: 3 })).toBe(en['ui.setup.computer'].replace('{n}', '3'));
    expect(t('ui.setup.computer')).toBe(en['ui.setup.computer']);
  });

  it('notifies listeners only when the language changes', () => {
    const listener = vi.fn();
    const stop = onLanguageChange(listener);
    setLanguage('en');
    expect(listener).not.toHaveBeenCalled();
    setLanguage('ru');
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setLanguage('en');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('names every game object of the data files', () => {
    const data = loadGameData();
    const keys = new Set(Object.keys(en));
    const expected: string[] = [];
    for (const id of Object.keys(data.units)) {
      expected.push(`unit.${id}.name`, `unit.${id}.desc`);
    }
    for (const id of Object.keys(data.buildings)) {
      expected.push(`building.${id}.name`, `building.${id}.desc`);
    }
    for (const id of Object.keys(data.technologies)) {
      expected.push(`tech.${id}.name`, `tech.${id}.desc`);
    }
    for (const id of Object.keys(data.civilizations)) {
      expected.push(`civ.${id}.name`, `civ.${id}.bonuses`);
    }
    for (const id of Object.keys(data.resourceSources)) {
      expected.push(`resource.${id}`, `resource.${id}.desc`);
    }
    for (const id of Object.keys(data.mapObjects)) {
      expected.push(`ui.object.${id}`, `ui.object.${id}.desc`);
    }
    for (const id of [...Object.keys(data.mapTypes), ...Object.keys(data.mapSizes)]) {
      expected.push(`map.${id}`);
    }
    for (const id of Object.keys(data.mapTypes)) {
      expected.push(`map.${id}.desc`);
    }
    for (const id of Object.keys(data.aiLevels)) {
      expected.push(`ui.difficulty.${id}`);
    }
    for (const id of ['food', 'wood', 'stone', 'gold']) {
      expected.push(`resource.${id}`, `resource.${id}.desc`);
    }
    for (const id of ['conquest', 'standard']) {
      expected.push(`ui.victory.${id}`, `ui.victory.${id}.desc`);
    }
    for (const id of ['stone', 'tool', 'bronze', 'iron']) {
      expected.push(`age.${id}`);
    }
    expect(expected.filter((key) => !keys.has(key))).toEqual([]);
  });

  it('defines every literal key referenced by the interface code', () => {
    const keys = new Set(Object.keys(en));
    const missing = new Set<string>();
    for (const file of sourceFiles(UI_ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/'((?:ui|notify)\.[a-z0-9_.]+)'/gi)) {
        const key = match[1];
        if (!keys.has(key) && ![...keys].some((known) => known.startsWith(`${key}.`))) {
          missing.add(key);
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
