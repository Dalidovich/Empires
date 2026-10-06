export type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes: string | readonly string[] = [],
  children: readonly Child[] | string = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const names = typeof classes === 'string' ? [classes] : classes;
  for (const name of names) {
    if (name) {
      node.classList.add(name);
    }
  }
  if (typeof children === 'string') {
    node.textContent = children;
  } else {
    append(node, children);
  }
  return node;
}

export function append(parent: HTMLElement, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export function replace(node: HTMLElement, children: readonly Child[]): void {
  clear(node);
  append(node, children);
}

export function button(
  label: string,
  onClick: (event: MouseEvent) => void,
  classes: readonly string[] = [],
): HTMLButtonElement {
  const node = h('button', ['btn', ...classes], label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

export function onPress(node: HTMLElement, handler: (event: MouseEvent) => void): void {
  node.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      event.preventDefault();
      handler(event);
    }
  });
}

export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
}

export function labeled(label: string, control: HTMLElement, classes: readonly string[] = []): HTMLElement {
  return h('label', ['field', ...classes], [h('span', 'field-label', label), control]);
}

export interface SelectOption {
  value: string;
  label: string;
}

export function select(
  options: readonly SelectOption[],
  value: string,
  onChange: (value: string) => void,
): HTMLSelectElement {
  const node = h('select', 'select');
  for (const option of options) {
    const item = h('option', [], option.label);
    item.value = option.value;
    node.appendChild(item);
  }
  node.value = value;
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

export function checkbox(checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
  const node = h('input', 'checkbox');
  node.type = 'checkbox';
  node.checked = checked;
  node.addEventListener('change', () => onChange(node.checked));
  return node;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = h('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
