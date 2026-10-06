import { createAudioSystem } from '../audio';
import type { AudioSystem } from '../audio/api';
import { loadGameData } from '../data';
import type { GameData } from '../data/types';
import { createRenderer, isWebGLAvailable } from '../render';
import type { CreateRenderer } from '../render/api';
import type { AssetManifest } from '../shared/assetManifest';
import { loadAssetManifest } from '../shared/assetManifest';
import { createSaveStore, createSettingsStore } from '../storage';
import type { AppSettings, SaveStore, SettingsStore } from '../storage/api';
import type { AppContext, CreateWorker, Screen, SimWorker } from './context';
import { h } from './dom';
import { gameScreen } from './game/gameScreen';
import { getLanguage, onLanguageChange, setLanguage, t } from './i18n';
import { errorScreen, loadScreen, mainMenuScreen, settingsScreen } from './screens/menuScreens';
import { setupScreen } from './screens/setupScreen';
import { summaryScreen } from './screens/summaryScreen';

export const MIN_WINDOW_WIDTH = 1280;

export const MIN_WINDOW_HEIGHT = 720;

export interface AppOverrides {
  data?: GameData;
  manifest?: AssetManifest;
  audio?: AudioSystem;
  saveStore?: SaveStore;
  settingsStore?: SettingsStore;
  createRenderer?: CreateRenderer;
  createWorker?: CreateWorker;
  webglAvailable?: () => boolean;
}

export interface App {
  context: AppContext;
  destroy(): void;
}

function defaultWorker(): SimWorker {
  return new Worker(new URL('../sim/worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as SimWorker;
}

export async function startApp(root: HTMLElement, overrides: AppOverrides = {}): Promise<App> {
  const settingsStore = overrides.settingsStore ?? createSettingsStore();
  let settings: AppSettings = settingsStore.load();
  setLanguage(settings.language);

  const host = h('div', 'screen-host', t('ui.loading'));
  const overlayRoot = h('div', 'overlay-root');
  const warning = h('div', 'size-warning');
  root.replaceChildren(host, overlayRoot, warning);

  const data = overrides.data ?? loadGameData();
  const manifest = overrides.manifest ?? (await loadAssetManifest());
  const audio = overrides.audio ?? createAudioSystem({ manifest });
  const saveStore = overrides.saveStore ?? createSaveStore();
  let current: Screen | null = null;

  const applyAudio = (): void => {
    audio.setEffectsVolume(settings.effectsVolume);
    audio.setMusicVolume(settings.musicVolume);
    audio.setMuted(settings.muted);
  };

  const applyLanguage = (): void => {
    document.title = t('ui.title');
    document.documentElement.lang = getLanguage();
    warning.textContent = t('ui.warning.window_size', {
      width: MIN_WINDOW_WIDTH,
      height: MIN_WINDOW_HEIGHT,
    });
  };

  const show = (screen: Screen): void => {
    const previous = current;
    current = screen;
    previous?.destroy();
    audio.startMusic();
    overlayRoot.replaceChildren();
    host.replaceChildren(screen.element);
  };

  const context: AppContext = {
    data,
    manifest,
    audio,
    saveStore,
    createRenderer: overrides.createRenderer ?? createRenderer,
    createWorker: overrides.createWorker ?? defaultWorker,
    overlayRoot,
    getSettings: () => settings,
    updateSettings: (patch) => {
      settings = { ...settings, ...patch };
      settingsStore.save(settings);
      applyAudio();
      setLanguage(settings.language);
    },
    showMainMenu: () => show(mainMenuScreen(context)),
    showSetup: () => show(setupScreen(context)),
    showLoad: () => show(loadScreen(context)),
    showSettings: () => show(settingsScreen(context)),
    startGame: (start) => show(gameScreen(context, start)),
    showSummary: (result) => show(summaryScreen(context, result)),
    showError: (kind) => show(errorScreen(context, kind)),
  };

  const updateWarning = (): void => {
    warning.hidden = window.innerWidth >= MIN_WINDOW_WIDTH && window.innerHeight >= MIN_WINDOW_HEIGHT;
  };
  const resumeAudio = (): void => {
    void audio.resume();
  };
  const clickSound = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest('button') !== null) {
      audio.playUi('click');
    }
  };
  const stopListening = onLanguageChange(() => {
    applyLanguage();
    current?.refresh();
  });
  window.addEventListener('resize', updateWarning);
  window.addEventListener('pointerdown', resumeAudio, { once: true });
  window.addEventListener('keydown', resumeAudio, { once: true });
  root.addEventListener('click', clickSound);

  applyAudio();
  applyLanguage();
  updateWarning();
  if ((overrides.webglAvailable ?? isWebGLAvailable)()) {
    context.showMainMenu();
  } else {
    context.showError('webgl');
  }

  return {
    context,
    destroy: () => {
      stopListening();
      window.removeEventListener('resize', updateWarning);
      window.removeEventListener('pointerdown', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
      root.removeEventListener('click', clickSound);
      current?.destroy();
      current = null;
      audio.destroy();
      root.replaceChildren();
    },
  };
}
