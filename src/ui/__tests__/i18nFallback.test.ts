import { describe, expect, it, vi } from 'vitest';

vi.mock('../../locales/en.json', () => ({
  default: { 'only.english': 'English only', shared: 'Shared {value}' },
}));

vi.mock('../../locales/ru.json', () => ({
  default: { shared: 'Second {value}' },
}));

describe('i18n fallback', () => {
  it('falls back to English, then to the key', async () => {
    const { setLanguage, t, hasTranslation } = await import('../i18n');
    setLanguage('ru');
    expect(t('shared', { value: 1 })).toBe('Second 1');
    expect(t('only.english')).toBe('English only');
    expect(t('absent.key')).toBe('absent.key');
    expect(hasTranslation('only.english')).toBe(true);
    expect(hasTranslation('absent.key')).toBe(false);
  });
});
