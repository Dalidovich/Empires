import type { Child } from './dom';
import { button, h } from './dom';
import { t } from './i18n';

export interface DialogHandle {
  element: HTMLElement;
  close(): void;
}

export function openDialog(
  root: HTMLElement,
  title: string,
  body: readonly Child[],
  actions: (close: () => void) => HTMLElement[],
  onDismiss?: () => void,
): DialogHandle {
  const backdrop = h('div', 'backdrop');
  const close = (): void => {
    backdrop.remove();
  };
  const dismiss = (): void => {
    close();
    onDismiss?.();
  };
  const panel = h('div', ['panel', 'dialog'], [
    h('h2', 'dialog-title', title),
    h('div', 'dialog-body', body),
    h('div', 'dialog-actions', actions(close)),
  ]);
  panel.tabIndex = -1;
  panel.addEventListener('keydown', (event) => {
    if (event.code === 'Escape') {
      event.stopPropagation();
      dismiss();
    }
  });
  backdrop.appendChild(panel);
  root.appendChild(backdrop);
  const focusTarget = panel.querySelector<HTMLElement>('input, button');
  (focusTarget ?? panel).focus();
  return { element: backdrop, close };
}

export function messageDialog(root: HTMLElement, message: string, onClose?: () => void): DialogHandle {
  return openDialog(
    root,
    t('ui.dialog.notice'),
    [h('p', 'dialog-text', message)],
    (close) => [
      button(t('ui.common.ok'), () => {
        close();
        onClose?.();
      }, ['primary']),
    ],
    onClose,
  );
}

export function confirmDialog(root: HTMLElement, message: string, onConfirm: () => void): DialogHandle {
  return openDialog(root, t('ui.dialog.confirm'), [h('p', 'dialog-text', message)], (close) => [
    button(t('ui.common.yes'), () => {
      close();
      onConfirm();
    }, ['primary']),
    button(t('ui.common.no'), close),
  ]);
}

export function promptDialog(
  root: HTMLElement,
  title: string,
  initial: string,
  onSubmit: (value: string) => void,
): DialogHandle {
  const input = h('input', 'text-input');
  input.type = 'text';
  input.maxLength = 60;
  input.value = initial;
  let handle: DialogHandle | null = null;
  const submit = (): void => {
    const value = input.value.trim();
    if (value.length > 0) {
      handle?.close();
      onSubmit(value);
    }
  };
  input.addEventListener('keydown', (event) => {
    if (event.code === 'Enter') {
      submit();
    }
  });
  handle = openDialog(root, title, [input], (close) => [
    button(t('ui.common.ok'), submit, ['primary']),
    button(t('ui.common.cancel'), close),
  ]);
  input.select();
  return handle;
}
