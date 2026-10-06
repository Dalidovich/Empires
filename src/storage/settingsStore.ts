import type { AppSettings, SettingsStore } from './api';
import { DEFAULT_APP_SETTINGS, SETTINGS_KEY } from './api';
import { parseAppSettings } from './validation';

export function createSettingsStore(): SettingsStore {
  return {
    load: (): AppSettings => {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return raw === null ? { ...DEFAULT_APP_SETTINGS } : parseAppSettings(JSON.parse(raw));
      } catch {
        return { ...DEFAULT_APP_SETTINGS };
      }
    },
    save: (settings) => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        return;
      }
    },
  };
}
