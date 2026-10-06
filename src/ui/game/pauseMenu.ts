import type { SaveInput, SaveMeta, SaveRecord, StorageResult } from '../../storage/api';
import { FORMAT_VERSION, GAME_VERSION } from '../../storage/api';
import type { AppContext } from '../context';
import { confirmDialog, messageDialog } from '../dialogs';
import { button, h, replace } from '../dom';
import { t } from '../i18n';
import { storageErrorText } from '../labels';
import type { SaveList } from '../screens/saveList';
import { createSaveList, exportRecord } from '../screens/saveList';
import { settingsPanel } from '../screens/settingsPanel';

type PauseView = 'main' | 'save' | 'load' | 'settings';

export interface PauseMenuHost {
  defaultSaveName(): string;
  createSaveInput(name: string): Promise<SaveInput | null>;
  isSaved(): boolean;
  markSaved(): void;
  canResign(): boolean;
  onResume(): void;
  onResign(): void;
  onExit(): void;
  onLoad(record: SaveRecord): void;
}

export class PauseMenu {
  readonly element = h('div', 'backdrop');
  private readonly panel = h('div', ['panel', 'menu', 'pause-menu']);
  private view: PauseView = 'main';
  private saveName: string;
  private readonly list: SaveList;

  constructor(
    private readonly ctx: AppContext,
    private readonly host: PauseMenuHost,
  ) {
    this.saveName = host.defaultSaveName();
    this.list = createSaveList(ctx, {
      onLoad: (record) => this.confirmUnsaved('ui.pause.load_confirm', () => host.onLoad(record)),
      onOverwrite: (meta) => this.overwrite(meta),
    });
    this.element.appendChild(this.panel);
    this.refresh();
  }

  refresh(): void {
    switch (this.view) {
      case 'save':
        this.renderSave();
        break;
      case 'load':
        this.list.reload();
        this.renderSection('ui.pause.load', [this.list.element]);
        break;
      case 'settings':
        this.renderSection('ui.pause.settings', [settingsPanel(this.ctx)]);
        break;
      default:
        this.renderMain();
    }
  }

  back(): boolean {
    if (this.view === 'main') {
      return false;
    }
    this.show('main');
    return true;
  }

  private show(view: PauseView): void {
    this.view = view;
    this.refresh();
  }

  private confirmUnsaved(messageKey: string, action: () => void): void {
    if (this.host.isSaved()) {
      action();
    } else {
      confirmDialog(this.ctx.overlayRoot, t(messageKey), action);
    }
  }

  private renderMain(): void {
    const resign = button(
      t('ui.pause.resign'),
      () => confirmDialog(this.ctx.overlayRoot, t('ui.pause.resign_confirm'), () => this.host.onResign()),
      ['wide'],
    );
    resign.disabled = !this.host.canResign();
    replace(this.panel, [
      h('h1', 'title', t('ui.pause.title')),
      button(t('ui.pause.resume'), () => this.host.onResume(), ['primary', 'wide']),
      button(t('ui.pause.save'), () => this.show('save'), ['wide']),
      button(t('ui.pause.load'), () => this.show('load'), ['wide']),
      button(t('ui.pause.settings'), () => this.show('settings'), ['wide']),
      resign,
      button(
        t('ui.pause.exit'),
        () => this.confirmUnsaved('ui.pause.exit_confirm', () => this.host.onExit()),
        ['wide'],
      ),
    ]);
  }

  private renderSection(titleKey: string, body: HTMLElement[]): void {
    this.panel.classList.toggle('menu-wide', this.view !== 'settings');
    replace(this.panel, [
      h('h1', 'title', t(titleKey)),
      ...body,
      button(t('ui.common.back'), () => this.show('main'), ['wide']),
    ]);
  }

  private renderSave(): void {
    const input = h('input', 'text-input');
    input.type = 'text';
    input.maxLength = 60;
    input.value = this.saveName;
    input.addEventListener('input', () => {
      this.saveName = input.value;
    });
    this.list.reload();
    this.renderSection('ui.pause.save', [
      h('div', 'save-form', [
        input,
        button(t('ui.pause.save_new'), () => void this.store((data) => this.ctx.saveStore.save(data)), [
          'primary',
        ]),
        button(t('ui.pause.export'), () => void this.exportFile()),
      ]),
      this.list.element,
    ]);
  }

  private name(): string {
    const trimmed = this.saveName.trim();
    return trimmed.length > 0 ? trimmed : this.host.defaultSaveName();
  }

  private async store(
    write: (input: SaveInput) => Promise<StorageResult<SaveMeta>>,
    name: string = this.name(),
  ): Promise<void> {
    const input = await this.host.createSaveInput(name);
    if (input === null) {
      messageDialog(this.ctx.overlayRoot, storageErrorText('unknown'));
      return;
    }
    const result = await write(input);
    if (result.ok) {
      this.host.markSaved();
      messageDialog(this.ctx.overlayRoot, t('ui.pause.saved'));
      this.list.reload();
    } else {
      messageDialog(this.ctx.overlayRoot, storageErrorText(result.error));
    }
  }

  private overwrite(meta: SaveMeta): void {
    confirmDialog(this.ctx.overlayRoot, t('ui.pause.overwrite_confirm', { name: meta.name }), () => {
      void this.store((input) => this.ctx.saveStore.overwrite(meta.id, input), meta.name);
    });
  }

  private async exportFile(): Promise<void> {
    const input = await this.host.createSaveInput(this.name());
    if (input === null) {
      messageDialog(this.ctx.overlayRoot, storageErrorText('unknown'));
      return;
    }
    const error = await exportRecord(this.ctx, {
      id: 'export',
      name: input.name,
      createdAt: Date.now(),
      formatVersion: FORMAT_VERSION,
      gameVersion: GAME_VERSION,
      summary: input.summary,
      state: input.state,
    });
    if (error === null) {
      this.host.markSaved();
    } else {
      messageDialog(this.ctx.overlayRoot, storageErrorText(error));
    }
  }
}
