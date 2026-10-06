import en from '../locales/en.json';
import ru from '../locales/ru.json';
import type { Language } from '../storage/api';

export type TranslationParams = Record<string, string | number>;

const dictionaries: Record<Language, Record<string, string>> = { en, ru };

export const LANGUAGES: readonly Language[] = ['en', 'ru'];

let currentLanguage: Language = 'en';

const listeners = new Set<() => void>();

export function setLanguage(language: Language): void {
  if (language === currentLanguage) {
    return;
  }
  currentLanguage = language;
  for (const listener of [...listeners]) {
    listener();
  }
}

export function getLanguage(): Language {
  return currentLanguage;
}

export function onLanguageChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasTranslation(key: string): boolean {
  return key in dictionaries[currentLanguage] || key in dictionaries.en;
}

export function t(key: string, params: TranslationParams = {}): string {
  const template = dictionaries[currentLanguage][key] ?? dictionaries.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
