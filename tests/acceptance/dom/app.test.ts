import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../src/locales/en.json';
import ru from '../../../src/locales/ru.json';
import { emptyManifest } from '../../../src/shared/assetManifest';
import type { SerializedGame } from '../../../src/sim/protocol';
import { STAT_KEYS } from '../../../src/sim/playerStats';
import { createMemorySaveStore, createMemorySettingsStore } from '../../../src/storage';
import type { SaveStore } from '../../../src/storage/api';
import type { App } from '../../../src/ui/app';
import { startApp } from '../../../src/ui/app';
import { AUTOSAVE_INTERVAL_MS } from '../../../src/ui/game/gameScreen';
import { setLanguage } from '../../../src/ui/i18n';
import { FakeRenderer, FakeWorker, data, silentAudio } from '../../../src/ui/__tests__/fixtures';

interface Harness {
  app: App;
  root: HTMLElement;
  renderer: FakeRenderer;
  workers: FakeWorker[];
  saveStore: SaveStore;
}

const english: Record<string, string> = en;
const russian: Record<string, string> = ru;
const CYRILLIC = /[Ѐ-ӿ]/;

let active: Harness | null = null;

async function flush(): Promise<void> {
  for (let turn = 0; turn < 8; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function launch(saveStore: SaveStore = createMemorySaveStore()): Promise<Harness> {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const renderer = new FakeRenderer();
  const workers: FakeWorker[] = [];
  const app = await startApp(root, {
    data,
    manifest: emptyManifest(),
    audio: silentAudio(),
    saveStore,
    settingsStore: createMemorySettingsStore(),
    webglAvailable: () => true,
    createRenderer: async () => ({ ok: true, renderer }),
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  active = { app, root, renderer, workers, saveStore };
  return active;
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((node) => node.textContent === text);
  if (!found) {
    throw new Error(`No button: ${text}`);
  }
  return found;
}

function key(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
}

function mouse(target: EventTarget, type: string, button: number): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: 50, clientY: 50 }),
  );
}

async function startGame(harness: Harness): Promise<FakeWorker> {
  harness.app.context.showSetup();
  harness.root.querySelector<HTMLButtonElement>('[data-role="start"]')?.click();
  await flush();
  return harness.workers[harness.workers.length - 1];
}

function latestWorker(harness: Harness): FakeWorker {
  return harness.workers[harness.workers.length - 1];
}

function tickOf(record: { state: unknown }): number {
  return (record.state as SerializedGame).state.tick;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  active?.app.destroy();
  active?.root.remove();
  active = null;
  setLanguage('en');
});

describe('criterion 9: autosave', () => {
  it('appears after five minutes, is overwritten and loads', async () => {
    expect(AUTOSAVE_INTERVAL_MS).toBe(5 * 60 * 1000);
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const harness = await launch();
    const worker = await startGame(harness);
    const { saveStore } = harness;
    expect((await saveStore.loadAuto()).ok).toBe(false);

    worker.postMessage({ type: 'commands', commands: [{ type: 'setSpeed', playerId: 0, speed: 'fast' }] });
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS - 1000);
    await flush();
    expect((await saveStore.loadAuto()).ok).toBe(false);

    vi.advanceTimersByTime(1000);
    await flush();
    const first = await saveStore.loadAuto();
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.name).toBe(en['ui.saves.autosave']);
    expect(first.value.summary.gameTicks).toBe(tickOf(first.value));
    const listed = await saveStore.list();
    expect(listed.ok && listed.value).toEqual([]);

    worker.postMessage({ type: 'commands', commands: [{ type: 'setSpeed', playerId: 0, speed: 'normal' }] });
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    await flush();
    const second = await saveStore.loadAuto();
    expect(second.ok && tickOf(second.value)).toBe(tickOf(first.value) + 1);

    harness.app.context.showLoad();
    await flush();
    expect(harness.root.querySelector('.save-name')?.textContent).toBe(en['ui.saves.autosave']);
    buttonByText(harness.root, en['ui.saves.load']).click();
    await flush();
    const loaded = latestWorker(harness);
    expect(loaded).not.toBe(worker);
    expect(loaded.messages[0]).toMatchObject({ type: 'load' });
    expect(harness.renderer.view?.tick).toBe(second.ok ? tickOf(second.value) : -1);
    expect(harness.root.querySelector('.topbar')).not.toBeNull();
  });

  it('can be switched off in the settings', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const harness = await launch();
    harness.app.context.updateSettings({ autosave: false });
    await startGame(harness);
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS * 3);
    await flush();
    expect((await harness.saveStore.loadAuto()).ok).toBe(false);
    harness.app.context.updateSettings({ autosave: true });
    vi.advanceTimersByTime(AUTOSAVE_INTERVAL_MS);
    await flush();
    expect((await harness.saveStore.loadAuto()).ok).toBe(true);
  });
});

function visibleTexts(): string[] {
  const texts: string[] = [document.title];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    texts.push(node.textContent ?? '');
  }
  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of ['title', 'placeholder', 'aria-label', 'alt']) {
      const value = element.getAttribute(attribute);
      if (value) {
        texts.push(value);
      }
    }
  }
  return texts.map((text) => text.trim()).filter((text) => text.length > 0);
}

const ENGLISH_ONLY = new Set(Object.keys(english).filter((id) => english[id] !== russian[id]).map((id) => english[id]));
const RUSSIAN_ONLY = new Set(Object.keys(english).filter((id) => english[id] !== russian[id]).map((id) => russian[id]));
const RUSSIAN_VALUES = new Set(Object.values(russian));

function expectLanguage(language: 'en' | 'ru', screen: string): void {
  const texts = visibleTexts();
  expect(texts.length, screen).toBeGreaterThan(3);
  if (language === 'en') {
    const selfName = russian['ui.language.ru'];
    expect(texts.filter((text) => CYRILLIC.test(text) && text !== selfName), `${screen} in en`).toEqual([]);
    expect(texts.filter((text) => RUSSIAN_ONLY.has(text) && text !== selfName), screen).toEqual([]);
    return;
  }
  const untranslated = texts.filter(
    (text) => /[A-Za-z]{3,}/.test(text) && !CYRILLIC.test(text) && !RUSSIAN_VALUES.has(text),
  );
  expect(untranslated, `${screen} in ru`).toEqual([]);
  expect(texts.filter((text) => ENGLISH_ONLY.has(text) && !RUSSIAN_VALUES.has(text)), screen).toEqual([]);
}

function checkBothLanguages(harness: Harness, screen: string): void {
  expectLanguage('en', screen);
  harness.app.context.updateSettings({ language: 'ru' });
  expect(document.documentElement.lang).toBe('ru');
  expectLanguage('ru', screen);
  harness.app.context.updateSettings({ language: 'en' });
  expectLanguage('en', screen);
}

describe('criterion 10: language switch', () => {
  it('translates the menu screens without a reload', async () => {
    const harness = await launch();
    const { context } = harness.app;
    const reloads = vi.fn();
    window.addEventListener('beforeunload', reloads);
    await harness.saveStore.save({
      name: '001',
      summary: { mapType: 'inland', mapSize: 'tiny', civilization: 'greek', gameTicks: 1200 },
      state: {},
    });
    checkBothLanguages(harness, 'main menu');
    context.showSetup();
    checkBothLanguages(harness, 'setup');
    context.showSettings();
    checkBothLanguages(harness, 'settings');
    context.showLoad();
    await flush();
    harness.app.context.updateSettings({ language: 'ru' });
    await flush();
    expectLanguage('ru', 'load');
    harness.app.context.updateSettings({ language: 'en' });
    await flush();
    expectLanguage('en', 'load');
    for (const kind of ['webgl', 'renderer', 'simulation', 'load_failed'] as const) {
      context.showError(kind);
      checkBothLanguages(harness, `error ${kind}`);
    }
    expect(reloads).not.toHaveBeenCalled();
    window.removeEventListener('beforeunload', reloads);
  });

  it('translates the game screen, its panels and windows', async () => {
    const harness = await launch();
    const worker = await startGame(harness);
    const view = harness.renderer.view;
    const viewport = harness.root.querySelector('.viewport');
    expect(view && viewport).toBeTruthy();
    if (!view || !viewport) {
      return;
    }
    checkBothLanguages(harness, 'hud');

    const villager = view.entities.find((entity) => entity.owner === 0 && entity.type === 'villager');
    harness.renderer.picked = villager?.id ?? null;
    mouse(viewport, 'mousedown', 0);
    mouse(window, 'mouseup', 0);
    checkBothLanguages(harness, 'villager selected');
    key('KeyB');
    checkBothLanguages(harness, 'build page');
    key('Escape');

    key('KeyH');
    checkBothLanguages(harness, 'town center selected');

    worker.emit({
      type: 'events',
      tick: 3,
      events: [
        { type: 'housingShort', playerId: 0 },
        { type: 'underAttack', playerId: 0, attackerOwner: 1, position: { x: 1, y: 2 } },
        { type: 'ageAdvanced', playerId: 1, age: 'tool' },
        { type: 'insufficientResources', playerId: 0, resource: 'wood' },
        { type: 'researchCompleted', playerId: 0, technology: 'toolworking', position: { x: 1, y: 2 } },
        { type: 'victoryTimerStarted', kind: 'wonder', playerId: 1, endTick: 9000 },
        { type: 'playerDefeated', playerId: 1, resigned: false },
        { type: 'unitConverted', entityId: 1, fromPlayerId: 0, toPlayerId: 1, position: { x: 1, y: 2 } },
        { type: 'relicCaptured', entityId: 1, entityType: 'artifact', playerId: 1, position: { x: 1, y: 2 } },
      ],
    });
    expect(harness.root.querySelector('.notifications')?.textContent).toContain(en['notify.unit_converted.lost']);
    expectLanguage('en', 'notifications');

    buttonByText(harness.root, en['ui.hud.diplomacy']).click();
    checkBothLanguages(harness, 'diplomacy');
    key('Escape');

    key('Escape');
    checkBothLanguages(harness, 'pause menu');
    buttonByText(harness.root, en['ui.pause.save']).click();
    await flush();
    checkBothLanguages(harness, 'pause save');
    key('Escape');
    buttonByText(harness.root, en['ui.pause.settings']).click();
    checkBothLanguages(harness, 'pause settings');
  });
});

describe('summary screen', () => {
  it('shows every counter of the specification for every player', async () => {
    const harness = await launch();
    const worker = await startGame(harness);
    const players = harness.renderer.view?.players ?? [];
    const stats = (offset: number): Record<string, number> =>
      Object.fromEntries(STAT_KEYS.map((name, index) => [name, 1000 + offset * 100 + index]));
    worker.emit({
      type: 'events',
      tick: 10,
      events: [
        {
          type: 'gameOver',
          winners: [1],
          reason: 'wonder',
          players: players.map((player) => ({
            playerId: player.id,
            winner: player.id === 1,
            score: 7000 + player.id,
            stats: { ...stats(player.id), toolAgeTick: 1200, bronzeAgeTick: 2400, ironAgeTick: 0 },
          })),
        },
      ],
    });
    const { root } = harness;
    expect(root.textContent).toContain(en['ui.summary.defeat']);
    expect(root.textContent).toContain(en['ui.summary.reason.wonder']);
    const rows = [...root.querySelectorAll('.summary-table tr')].slice(2);
    expect(rows).toHaveLength(players.length);
    rows.forEach((row, index) => {
      const cells = [...row.querySelectorAll('td')].map((cell) => cell.textContent);
      const own = stats(index);
      for (const name of [
        'unitsKilled',
        'unitsLost',
        'buildingsRazed',
        'buildingsLost',
        'foodGathered',
        'woodGathered',
        'stoneGathered',
        'goldGathered',
        'tributeSent',
        'tributeReceived',
        'technologiesResearched',
      ]) {
        expect(cells, name).toContain(String(own[name]));
        expect(english[`ui.summary.stat.${name}`], name).toBeDefined();
      }
      expect(cells).toContain('1:00');
      expect(cells).toContain('2:00');
      expect(cells.at(-1)).toBe(String(7000 + index));
    });
    expect(root.querySelectorAll('.winner-row')).toHaveLength(1);
    checkBothLanguages(harness, 'summary');
  });
});

describe('NFR-7 and error states of the interface', () => {
  it('keeps the tab and the saves alive after a simulation failure', async () => {
    const harness = await launch();
    const { saveStore, root } = harness;
    const worker = await startGame(harness);
    key('Escape');
    buttonByText(root, en['ui.pause.save']).click();
    buttonByText(root, en['ui.pause.save_new']).click();
    await flush();
    buttonByText(harness.app.context.overlayRoot, en['ui.common.ok']).click();
    key('Escape');
    key('Escape');
    const input = await harness.app.context.saveStore.list();
    const before = input.ok ? input.value : [];
    expect(before).toHaveLength(1);
    const manual = await saveStore.load(before[0].id);
    const autosave = await saveStore.saveAuto({
      name: en['ui.saves.autosave'],
      summary: before[0].summary,
      state: manual.ok ? manual.value.state : {},
    });
    expect(autosave.ok).toBe(true);

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    worker.emit({ type: 'error', code: 'simulation_error', tick: 5, message: 'boom' });
    expect(errors).toHaveBeenCalledWith('Simulation error at tick 5: boom');
    expect(root.textContent).toContain(en['ui.error.simulation.title']);
    expect(worker.terminated).toBe(true);

    const after = await saveStore.list();
    expect(after.ok && after.value).toEqual(before);
    const intact = await saveStore.load(before[0].id);
    expect(intact).toEqual(manual);

    buttonByText(root, en['ui.error.load_autosave']).click();
    await flush();
    const resumed = latestWorker(harness);
    expect(resumed).not.toBe(worker);
    expect(resumed.messages[0]).toMatchObject({ type: 'load' });
    expect(root.querySelector('.topbar')).not.toBeNull();
  });

  it('returns to the save list when a save cannot be loaded', async () => {
    const harness = await launch();
    const worker = await startGame(harness);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    worker.emit({ type: 'error', code: 'load_failed', tick: 0, message: 'bad' });
    expect(harness.root.textContent).toContain(en['ui.error.load_failed.title']);
    buttonByText(harness.root, en['ui.error.to_saves']).click();
    await flush();
    expect(harness.root.textContent).toContain(en['ui.saves.import']);
  });

  it('reports unavailable storage on save and still exports to a file', async () => {
    const memory = createMemorySaveStore();
    const broken: SaveStore = {
      ...memory,
      save: async () => ({ ok: false, error: 'unavailable' }),
      list: async () => ({ ok: false, error: 'unavailable' }),
    };
    const harness = await launch(broken);
    await startGame(harness);
    const created = vi.fn(() => 'blob:save');
    const revoked = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
    const { root } = harness;
    key('Escape');
    buttonByText(root, en['ui.pause.save']).click();
    await flush();
    buttonByText(root, en['ui.pause.save_new']).click();
    await flush();
    expect(harness.app.context.overlayRoot.textContent).toContain(en['ui.storage.error.unavailable']);
    buttonByText(harness.app.context.overlayRoot, en['ui.common.ok']).click();
    buttonByText(root, en['ui.pause.export']).click();
    await flush();
    expect(created).toHaveBeenCalledTimes(1);
    const exported = created.mock.calls[0] as unknown as [Blob];
    const imported = await memory.importFromFile(exported[0]);
    expect(imported.ok).toBe(true);
    vi.unstubAllGlobals();
  });
});
