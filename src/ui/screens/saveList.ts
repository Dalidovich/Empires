import type { SaveMeta, SaveRecord, StorageErrorCode } from '../../storage/api';
import { SAVE_FILE_EXTENSION } from '../../storage/api';
import type { AppContext } from '../context';
import { confirmDialog, messageDialog, promptDialog } from '../dialogs';
import { button, downloadBlob, h, replace } from '../dom';
import { formatClock } from '../format';
import { getLanguage, t } from '../i18n';
import { civilizationName, storageErrorText } from '../labels';

export interface SaveListOptions {
  onLoad(record: SaveRecord): void;
  onOverwrite?(meta: SaveMeta): void;
}

export interface SaveList {
  element: HTMLElement;
  reload(): void;
}

export function describeSave(ctx: AppContext, meta: SaveMeta): string {
  const summary = meta.summary;
  return [
    t(`map.${summary.mapType}`),
    t(`map.${summary.mapSize}`),
    civilizationName(summary.civilization),
    formatClock(summary.gameTicks / ctx.data.game.tickRate),
    new Date(meta.createdAt).toLocaleString(getLanguage()),
  ].join(' · ');
}

export async function exportRecord(ctx: AppContext, record: SaveRecord): Promise<StorageErrorCode | null> {
  const result = await ctx.saveStore.exportToFile(record);
  if (!result.ok) {
    return result.error;
  }
  downloadBlob(result.value, `${record.name}${SAVE_FILE_EXTENSION}`);
  return null;
}

export function createSaveList(ctx: AppContext, options: SaveListOptions): SaveList {
  const element = h('div', 'save-list');
  let generation = 0;

  const fail = (code: StorageErrorCode): void => {
    messageDialog(ctx.overlayRoot, storageErrorText(code), reload);
  };

  const load = async (id: string | null): Promise<void> => {
    const result = id === null ? await ctx.saveStore.loadAuto() : await ctx.saveStore.load(id);
    if (result.ok) {
      options.onLoad(result.value);
    } else {
      fail(result.error);
    }
  };

  const exportSave = async (id: string | null): Promise<void> => {
    const result = id === null ? await ctx.saveStore.loadAuto() : await ctx.saveStore.load(id);
    if (!result.ok) {
      fail(result.error);
      return;
    }
    const error = await exportRecord(ctx, result.value);
    if (error !== null) {
      fail(error);
    }
  };

  const rename = (meta: SaveMeta): void => {
    promptDialog(ctx.overlayRoot, t('ui.saves.rename'), meta.name, (name) => {
      void ctx.saveStore.rename(meta.id, name).then((result) => {
        if (result.ok) {
          reload();
        } else {
          fail(result.error);
        }
      });
    });
  };

  const remove = (meta: SaveMeta): void => {
    confirmDialog(ctx.overlayRoot, t('ui.saves.delete_confirm', { name: meta.name }), () => {
      void ctx.saveStore.delete(meta.id).then((result) => {
        if (result.ok) {
          reload();
        } else {
          fail(result.error);
        }
      });
    });
  };

  const importFile = (): void => {
    const input = h('input');
    input.type = 'file';
    input.accept = SAVE_FILE_EXTENSION;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      void ctx.saveStore.importFromFile(file).then((result) => {
        if (result.ok) {
          options.onLoad(result.value);
        } else {
          fail(result.error);
        }
      });
    });
    input.click();
  };

  const row = (meta: SaveMeta, auto: boolean): HTMLElement => {
    const id = auto ? null : meta.id;
    const actions: HTMLElement[] = [button(t('ui.saves.load'), () => void load(id), ['primary'])];
    if (!auto) {
      if (options.onOverwrite) {
        const overwrite = options.onOverwrite;
        actions.push(button(t('ui.saves.overwrite'), () => overwrite(meta)));
      }
      actions.push(button(t('ui.saves.rename'), () => rename(meta)));
      actions.push(button(t('ui.saves.delete'), () => remove(meta)));
    }
    actions.push(button(t('ui.saves.export'), () => void exportSave(id)));
    return h('div', 'save-row', [
      h('div', 'save-info', [
        h('div', 'save-name', auto ? t('ui.saves.autosave') : meta.name),
        h('div', 'save-meta', describeSave(ctx, meta)),
      ]),
      h('div', 'save-actions', actions),
    ]);
  };

  const render = (saves: SaveMeta[], auto: SaveMeta | null, error: StorageErrorCode | null): void => {
    const rows: HTMLElement[] = [];
    if (auto) {
      rows.push(row(auto, true));
    }
    rows.push(...saves.map((meta) => row(meta, false)));
    replace(element, [
      error !== null && h('p', 'error-text', storageErrorText(error)),
      rows.length === 0 && error === null && h('p', 'empty-text', t('ui.saves.empty')),
      h('div', 'save-rows', rows),
      button(t('ui.saves.import'), importFile),
    ]);
  };

  function reload(): void {
    generation += 1;
    const current = generation;
    replace(element, [h('p', 'empty-text', t('ui.loading'))]);
    void Promise.all([ctx.saveStore.list(), ctx.saveStore.loadAuto()]).then(([list, auto]) => {
      if (current !== generation) {
        return;
      }
      render(list.ok ? list.value : [], auto.ok ? auto.value : null, list.ok ? null : list.error);
    });
  }

  return { element, reload };
}
