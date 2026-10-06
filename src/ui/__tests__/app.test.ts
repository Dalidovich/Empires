import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import ru from '../../locales/ru.json';
import { emptyManifest } from '../../shared/assetManifest';
import { createMemorySaveStore, createMemorySettingsStore } from '../../storage';
import type { App } from '../app';
import { startApp } from '../app';
import { setLanguage } from '../i18n';
import { FakeRenderer, FakeWorker, data, silentAudio } from './fixtures';

interface Harness {
  app: App;
  root: HTMLElement;
  renderer: FakeRenderer;
  workers: FakeWorker[];
}

async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function launch(webgl = true): Promise<Harness> {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const renderer = new FakeRenderer();
  const workers: FakeWorker[] = [];
  const app = await startApp(root, {
    data,
    manifest: emptyManifest(),
    audio: silentAudio(),
    saveStore: createMemorySaveStore(),
    settingsStore: createMemorySettingsStore(),
    webglAvailable: () => webgl,
    createRenderer: async () => ({ ok: true, renderer }),
    createWorker: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });
  return { app, root, renderer, workers };
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((node) => node.textContent === text);
  if (!found) {
    throw new Error(`No button: ${text}`);
  }
  return found;
}

function mouse(target: EventTarget, type: string, button: number, x = 50, y = 50, shiftKey = false): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: x, clientY: y, shiftKey }),
  );
}

function key(code: string, init: KeyboardEventInit = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...init }));
}

async function startGame(harness: Harness): Promise<FakeWorker> {
  buttonByText(harness.root, en['ui.menu.new_game']).click();
  const start = harness.root.querySelector<HTMLButtonElement>('[data-role="start"]');
  expect(start?.disabled).toBe(false);
  start?.click();
  await flush();
  return harness.workers[harness.workers.length - 1];
}

describe('application shell', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await launch();
  });

  afterEach(() => {
    harness.app.destroy();
    harness.root.remove();
    setLanguage('en');
  });

  it('shows the main menu and reaches load and settings screens', async () => {
    const { root } = harness;
    expect(document.title).toBe(en['ui.title']);
    buttonByText(root, en['ui.menu.load']).click();
    await flush();
    expect(root.textContent).toContain(en['ui.saves.empty']);
    expect(root.textContent).toContain(en['ui.saves.import']);
    buttonByText(root, en['ui.common.back']).click();
    buttonByText(root, en['ui.menu.settings']).click();
    expect(root.textContent).toContain(en['ui.settings.autosave']);
  });

  it('switches the language without reloading', () => {
    const { root, app } = harness;
    buttonByText(root, en['ui.menu.settings']).click();
    const language = root.querySelector('select');
    expect(language).not.toBeNull();
    if (language) {
      language.value = 'ru';
      language.dispatchEvent(new Event('change'));
    }
    expect(app.context.getSettings().language).toBe('ru');
    expect(root.textContent).toContain(ru['ui.settings.autosave']);
    expect(document.title).toBe(ru['ui.title']);
    buttonByText(root, ru['ui.common.back']).click();
    expect(root.textContent).toContain(ru['ui.menu.new_game']);
  });

  it('disables the start button while all players share a team', () => {
    const { root } = harness;
    buttonByText(root, en['ui.menu.new_game']).click();
    const teamSelects = (): HTMLSelectElement[] =>
      [...root.querySelectorAll<HTMLElement>('[data-player]')].map(
        (row) => row.querySelectorAll('select')[1],
      );
    for (let index = 0; index < 2; index++) {
      const control = teamSelects()[index];
      control.value = '1';
      control.dispatchEvent(new Event('change'));
    }
    const start = root.querySelector<HTMLButtonElement>('[data-role="start"]');
    expect(start?.disabled).toBe(true);
    expect(root.textContent).toContain(en['ui.setup.issue.single_team']);
    const seed = root.querySelector<HTMLInputElement>('[data-role="seed"]');
    expect(seed?.value).toMatch(/^\d+$/);
  });

  it('starts a game, selects units and sends commands', async () => {
    const worker = await startGame(harness);
    const { root, renderer } = harness;
    expect(worker.messages[0].type).toBe('init');
    expect(harness.app.context.getSettings().lastGameSetup).not.toBeNull();
    const view = renderer.view;
    expect(view).not.toBeNull();
    if (!view) {
      return;
    }
    expect(root.querySelector('.topbar')?.textContent).toContain(
      String(data.game.startingResources.food),
    );
    const viewport = root.querySelector('.viewport');
    expect(viewport).not.toBeNull();
    if (!viewport) {
      return;
    }
    const villagers = view.entities.filter(
      (entity) => entity.owner === 0 && entity.type === 'villager',
    );
    renderer.picked = villagers[0].id;
    mouse(viewport, 'mousedown', 0);
    mouse(window, 'mouseup', 0);
    expect(renderer.selection).toEqual([villagers[0].id]);
    expect(root.querySelector('.info-name')?.textContent).toBe(en['unit.villager.name']);
    expect(root.querySelector('.portrait-activity')?.textContent).toBe(en['ui.activity.idle']);
    expect(root.querySelector('.command-panel')?.textContent).toContain(en['ui.action.build.name']);

    renderer.inRect = villagers.map((entity) => entity.id);
    mouse(viewport, 'mousedown', 0, 10, 10);
    mouse(window, 'mousemove', 0, 200, 200);
    mouse(window, 'mouseup', 0, 200, 200);
    expect(renderer.selection).toEqual(villagers.map((entity) => entity.id));

    renderer.picked = null;
    mouse(viewport, 'mousedown', 2, 30, 40, true);
    expect(worker.commands.at(-1)).toEqual({
      type: 'move',
      playerId: 0,
      entityIds: villagers.map((entity) => entity.id),
      target: { x: 30, y: 40 },
      queued: true,
    });

    key('Digit1', { ctrlKey: true });
    renderer.picked = null;
    mouse(viewport, 'mousedown', 0);
    mouse(window, 'mouseup', 0);
    expect(renderer.selection).toEqual([]);
    key('Digit1');
    expect(renderer.selection).toEqual(villagers.map((entity) => entity.id));

    key('KeyE');
    mouse(viewport, 'mousedown', 0, 60, 70);
    mouse(window, 'mouseup', 0, 60, 70);
    expect(worker.commands.at(-1)).toMatchObject({ type: 'attackMove', target: { x: 60, y: 70 } });

    key('KeyH');
    const center = view.entities.find((entity) => entity.owner === 0 && entity.type === 'town_center');
    expect(renderer.selection).toEqual([center?.id]);
    key('KeyQ');
    expect(worker.commands.at(-1)).toEqual({
      type: 'train',
      playerId: 0,
      buildingId: center?.id,
      unit: 'villager',
      count: 1,
    });
  });

  it('controls speed and pause and opens the in-game windows', async () => {
    const worker = await startGame(harness);
    const { root } = harness;
    key('Equal');
    expect(worker.commands.at(-1)).toEqual({ type: 'setSpeed', playerId: 0, speed: 'fast' });
    key('Minus');
    expect(worker.commands.at(-1)).toEqual({ type: 'setSpeed', playerId: 0, speed: 'normal' });
    key('KeyP');
    expect(worker.commands.at(-1)).toEqual({ type: 'pause', playerId: 0, paused: true });
    expect(root.querySelector('.banner')?.textContent).toBe(en['ui.hud.paused']);
    key('KeyP');
    expect(worker.commands.at(-1)).toEqual({ type: 'pause', playerId: 0, paused: false });

    buttonByText(root, en['ui.hud.diplomacy']).click();
    expect(root.querySelector('.diplomacy')?.textContent).toContain(en['ui.diplomacy.tribute_head']);
    buttonByText(root, en['ui.stance.ally']).click();
    expect(worker.commands.at(-1)).toEqual({
      type: 'setStance',
      playerId: 0,
      targetPlayerId: 1,
      stance: 'ally',
    });
    key('Escape');
    expect(root.querySelector('.diplomacy')).toBeNull();

    key('Escape');
    expect(root.querySelector('.pause-menu')).not.toBeNull();
    expect(worker.commands.at(-1)).toEqual({ type: 'pause', playerId: 0, paused: true });
    for (const label of ['resume', 'save', 'load', 'settings', 'resign', 'exit'] as const) {
      expect(root.querySelector('.pause-menu')?.textContent).toContain(en[`ui.pause.${label}`]);
    }
    harness.app.context.updateSettings({ language: 'ru' });
    expect(root.querySelector('.pause-menu')?.textContent).toContain(ru['ui.pause.resume']);
    expect(root.querySelector('.topbar')?.textContent).toContain(ru['ui.hud.menu']);
    harness.app.context.updateSettings({ language: 'en' });

    buttonByText(root, en['ui.pause.save']).click();
    buttonByText(root, en['ui.pause.save_new']).click();
    await flush();
    expect(harness.app.context.overlayRoot.textContent).toContain(en['ui.pause.saved']);
    buttonByText(harness.app.context.overlayRoot, en['ui.common.ok']).click();
    const saves = await harness.app.context.saveStore.list();
    expect(saves.ok && saves.value.length).toBe(1);

    key('Escape');
    buttonByText(root, en['ui.pause.exit']).click();
    expect(worker.terminated).toBe(true);
    expect(root.textContent).toContain(en['ui.menu.new_game']);
  });

  it('asks for confirmation before leaving an unsaved game', async () => {
    await startGame(harness);
    const { root, app } = harness;
    key('Escape');
    harness.workers[0].emit({
      type: 'snapshot',
      view: { ...(harness.renderer.view ?? ({} as never)), tick: 50, paused: true },
    });
    buttonByText(root, en['ui.pause.exit']).click();
    expect(app.context.overlayRoot.textContent).toContain(en['ui.pause.exit_confirm']);
    buttonByText(app.context.overlayRoot, en['ui.common.no']).click();
    expect(root.querySelector('.pause-menu')).not.toBeNull();
    buttonByText(root, en['ui.pause.exit']).click();
    buttonByText(app.context.overlayRoot, en['ui.common.yes']).click();
    expect(root.textContent).toContain(en['ui.menu.new_game']);
  });

  it('loads a saved game from the list', async () => {
    const worker = await startGame(harness);
    const { root, app } = harness;
    key('Escape');
    buttonByText(root, en['ui.pause.save']).click();
    buttonByText(root, en['ui.pause.save_new']).click();
    await flush();
    buttonByText(app.context.overlayRoot, en['ui.common.ok']).click();
    key('Escape');
    buttonByText(root, en['ui.pause.exit']).click();
    buttonByText(root, en['ui.menu.load']).click();
    await flush();
    buttonByText(root, en['ui.saves.load']).click();
    await flush();
    const loaded = harness.workers[harness.workers.length - 1];
    expect(loaded).not.toBe(worker);
    expect(loaded.messages[0].type).toBe('load');
    expect(root.querySelector('.topbar')).not.toBeNull();
  });

  it('shows the summary after the game is over', async () => {
    const worker = await startGame(harness);
    const { root } = harness;
    const view = harness.renderer.view;
    worker.emit({
      type: 'events',
      tick: 10,
      events: [
        {
          type: 'gameOver',
          winners: [0],
          reason: 'conquest',
          players: (view?.players ?? []).map((player) => ({
            playerId: player.id,
            winner: player.id === 0,
            score: 100 + player.id,
            stats: { unitsKilled: 7, toolAgeTick: 1200 },
          })),
        },
      ],
    });
    expect(root.textContent).toContain(en['ui.summary.victory']);
    expect(root.textContent).toContain(en['ui.summary.stat.unitsKilled']);
    expect(root.querySelector('.summary-table')?.textContent).toContain('1:00');
    buttonByText(root, en['ui.summary.to_menu']).click();
    expect(root.textContent).toContain(en['ui.menu.new_game']);
  });

  it('shows the error screen on a simulation failure and notifies about events', async () => {
    const worker = await startGame(harness);
    const { root } = harness;
    worker.emit({
      type: 'events',
      tick: 3,
      events: [
        { type: 'housingShort', playerId: 0 },
        { type: 'underAttack', playerId: 0, attackerOwner: 1, position: { x: 1, y: 2 } },
        { type: 'ageAdvanced', playerId: 1, age: 'tool' },
      ],
    });
    const notifications = root.querySelector('.notifications')?.textContent ?? '';
    expect(notifications).toContain(en['notify.housing_short']);
    expect(notifications).toContain(en['notify.under_attack']);
    expect(notifications).toContain(en['age.tool']);
    worker.emit({ type: 'error', code: 'simulation_error', tick: 5, message: 'boom' });
    expect(root.textContent).toContain(en['ui.error.simulation.title']);
    expect(root.textContent).toContain(en['ui.error.load_autosave']);
    expect(worker.terminated).toBe(true);
  });
});

describe('unsupported browser', () => {
  it('shows the WebGL error screen instead of the menu', async () => {
    const harness = await launch(false);
    expect(harness.root.textContent).toContain(en['ui.error.webgl.title']);
    expect(harness.root.querySelectorAll('button')).toHaveLength(0);
    harness.app.destroy();
    harness.root.remove();
  });

  it('warns when the window is smaller than 1280×720', async () => {
    const harness = await launch();
    const warning = harness.root.querySelector<HTMLElement>('.size-warning');
    expect(warning?.hidden).toBe(window.innerWidth >= 1280 && window.innerHeight >= 720);
    expect(warning?.textContent).toContain('1280');
    harness.app.destroy();
    harness.root.remove();
  });
});
