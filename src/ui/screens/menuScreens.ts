import type { SerializedGame } from '../../sim/protocol';
import type { SaveRecord } from '../../storage/api';
import type { AppContext, AppErrorKind, Screen } from '../context';
import { button, h, replace } from '../dom';
import { t } from '../i18n';
import { createSaveList } from './saveList';
import { settingsPanel } from './settingsPanel';

export function gameFromRecord(record: SaveRecord): SerializedGame {
  return record.state as unknown as SerializedGame;
}

function menuScreen(render: (root: HTMLElement) => void, destroy: () => void = () => {}): Screen {
  const element = h('div', ['screen', 'menu-screen']);
  const refresh = (): void => render(element);
  refresh();
  return { element, refresh, destroy };
}

export function mainMenuScreen(ctx: AppContext): Screen {
  return menuScreen((root) => {
    replace(root, [
      h('div', ['panel', 'menu'], [
        h('h1', 'title', t('ui.title')),
        button(t('ui.menu.new_game'), () => ctx.showSetup(), ['primary', 'wide']),
        button(t('ui.menu.load'), () => ctx.showLoad(), ['wide']),
        button(t('ui.menu.settings'), () => ctx.showSettings(), ['wide']),
      ]),
    ]);
  });
}

export function settingsScreen(ctx: AppContext): Screen {
  return menuScreen((root) => {
    replace(root, [
      h('div', ['panel', 'menu'], [
        h('h1', 'title', t('ui.settings.title')),
        settingsPanel(ctx),
        button(t('ui.common.back'), () => ctx.showMainMenu(), ['wide']),
      ]),
    ]);
  });
}

export function loadScreen(ctx: AppContext): Screen {
  const list = createSaveList(ctx, {
    onLoad: (record) => ctx.startGame({ kind: 'load', game: gameFromRecord(record) }),
  });
  return menuScreen((root) => {
    list.reload();
    replace(root, [
      h('div', ['panel', 'menu', 'menu-wide'], [
        h('h1', 'title', t('ui.load.title')),
        list.element,
        button(t('ui.common.back'), () => ctx.showMainMenu(), ['wide']),
      ]),
    ]);
  });
}

async function loadAutosave(ctx: AppContext): Promise<void> {
  const result = await ctx.saveStore.loadAuto();
  if (result.ok) {
    ctx.startGame({ kind: 'load', game: gameFromRecord(result.value) });
  } else {
    ctx.showLoad();
  }
}

export function errorScreen(ctx: AppContext, kind: AppErrorKind): Screen {
  return menuScreen((root) => {
    const actions: HTMLElement[] = [];
    if (kind === 'simulation') {
      actions.push(
        button(t('ui.error.load_autosave'), () => void loadAutosave(ctx), ['primary', 'wide']),
      );
    }
    if (kind === 'load_failed') {
      actions.push(button(t('ui.error.to_saves'), () => ctx.showLoad(), ['primary', 'wide']));
    }
    if (kind !== 'webgl') {
      actions.push(button(t('ui.error.to_menu'), () => ctx.showMainMenu(), ['wide']));
    }
    replace(root, [
      h('div', ['panel', 'menu', 'error-panel'], [
        h('h1', 'title', t(`ui.error.${kind}.title`)),
        h('p', 'error-text', t(`ui.error.${kind}.text`)),
        ...actions,
      ]),
    ]);
  });
}
