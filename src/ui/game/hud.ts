import type { BuildingDef, GameData, UnitDef } from '../../data/types';
import { RESOURCE_KINDS } from '../../data/types';
import type { EntityView, PlayerView } from '../../sim/snapshot';
import type { EntityId, Vec2 } from '../../sim/types';
import type { Child } from '../dom';
import { button, h, onPress, replace } from '../dom';
import { clamp01, colorCss, costEntries, formatClock } from '../format';
import { getLanguage, hasTranslation, t } from '../i18n';
import { entityDescription, entityName, playerName, reasonText, requirementsText } from '../labels';
import { activityOf } from './activity';
import { isCompleted } from './availability';
import type { PanelButton } from './commandPanel';
import { PANEL_SLOTS, slotLabel } from './commandPanel';

export const NOTIFICATION_MS = 8000;

const MAX_NOTIFICATIONS = 6;

const MAX_PORTRAITS = 60;

const TOUCH_TOOLTIP_MS = 2500;

const TOUCH_MOUSE_GUARD_MS = 1000;

export type NotificationTone = 'info' | 'warning' | 'danger';

export interface HudCallbacks {
  onPanelButton(button: PanelButton, shift: boolean): void;
  onQueueCancel(buildingId: EntityId, index: number): void;
  onResearchCancel(buildingId: EntityId): void;
  onPortrait(id: EntityId, shift: boolean): void;
  onMenu(): void;
  onDiplomacy(): void;
  onGuide(): void;
  onSandbox(): void;
  onSpeed(): void;
  onNotification(position: Vec2): void;
  onTouchTool(tool: TouchToolButton): void;
}

export type TouchToolButton = 'box' | 'order' | 'idle' | 'cancel';

const TOUCH_TOOLS: readonly TouchToolButton[] = ['box', 'order', 'idle', 'cancel'];

export interface HudModel {
  view: PlayerView;
  selection: readonly EntityView[];
  buttons: readonly PanelButton[];
}

interface ProgressRef {
  bar: HTMLElement;
  read(view: PlayerView): number;
}

function progressBar(value: number, classes: readonly string[] = []): { root: HTMLElement; fill: HTMLElement } {
  const fill = h('div', 'bar-fill');
  fill.style.width = `${Math.round(clamp01(value) * 100)}%`;
  return { root: h('div', ['bar', ...classes], [fill]), fill };
}

function statRow([label, value]: [string, string]): HTMLElement {
  return h('div', 'stat', [h('span', 'stat-label', label), h('span', 'stat-value', value)]);
}

function combatRows(def: UnitDef | BuildingDef, hp: string): [string, string][] {
  const rows: [string, string][] = [[t('ui.stat.hp'), hp]];
  if (def.attack > 0) {
    rows.push([t('ui.stat.attack'), String(def.attack)]);
  }
  rows.push([t('ui.stat.armor'), `${def.armor}/${def.pierceArmor}`]);
  if (def.range > 0) {
    rows.push([t('ui.stat.range'), String(def.range)]);
  }
  return rows;
}

export class Hud {
  readonly element = h('div', 'game');
  readonly viewport = h('div', 'viewport');
  readonly minimap = h('div', 'minimap');
  private readonly top = h('div', 'topbar');
  private readonly info = h('div', 'info-panel');
  private readonly queue = h('div', 'queue-panel');
  private readonly commands = h('div', 'command-panel');
  private readonly notifications = h('div', 'notifications');
  private readonly banner = h('div', 'banner');
  private readonly tooltip = h('div', 'tooltip');
  private readonly timers = h('div', 'timers');
  private readonly touchbar = h('div', 'touchbar');
  private touchTool: TouchToolButton | null = null;
  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTouchAt = Number.NEGATIVE_INFINITY;
  private touchedName: string | null = null;
  private readonly resourceValues = new Map<string, HTMLElement>();
  private readonly notificationTexts = new Map<Element, () => string>();
  private population = h('span', 'value');
  private age = h('span', 'value');
  private clock = h('span', 'value');
  private speed = h('button', 'btn');
  private infoKey = '';
  private queueKey = '';
  private commandKey = '';
  private timerKey = '';
  private progress: ProgressRef[] = [];
  private buttons: readonly PanelButton[] = [];
  private hoveredSlot: number | null = null;
  private model: HudModel | null = null;
  private sandbox = false;

  constructor(
    private readonly data: GameData,
    private readonly callbacks: HudCallbacks,
  ) {
    this.banner.hidden = true;
    this.tooltip.hidden = true;
    this.buildTop();
    this.buildTouchbar();
    this.viewport.append(this.touchbar, this.notifications);
    this.element.append(
      this.top,
      this.viewport,
      h('div', 'bottom', [this.info, this.queue, this.commands, this.minimap]),
      this.banner,
      this.tooltip,
    );
    this.bindCommandPanel();
  }

  update(model: HudModel): void {
    this.model = model;
    this.updateTop(model.view);
    this.updateInfo(model);
    this.updateQueue(model);
    this.updateCommands(model.buttons);
  }

  relabel(): void {
    this.infoKey = '';
    this.queueKey = '';
    this.commandKey = '';
    this.timerKey = '';
    this.buildTop();
    this.buildTouchbar();
    for (const [item, render] of this.notificationTexts) {
      item.textContent = render();
    }
    if (this.model) {
      this.update(this.model);
    }
  }

  setSandbox(enabled: boolean): void {
    if (enabled === this.sandbox) {
      return;
    }
    this.sandbox = enabled;
    this.buildTop();
  }

  setTouchTool(tool: TouchToolButton | null): void {
    this.touchTool = tool;
    for (const node of this.touchbar.querySelectorAll<HTMLElement>('[data-tool]')) {
      node.classList.toggle('active', node.dataset.tool === tool);
    }
  }

  setBanner(text: string | null): void {
    this.banner.hidden = text === null;
    this.banner.textContent = text ?? '';
  }

  notify(
    text: string | (() => string),
    position: Vec2 | null = null,
    tone: NotificationTone = 'info',
  ): void {
    const render = typeof text === 'string' ? () => text : text;
    const item = h('div', ['notification', tone], render());
    this.notificationTexts.set(item, render);
    if (position !== null) {
      item.classList.add('clickable');
      onPress(item, () => this.callbacks.onNotification(position));
    }
    this.notifications.appendChild(item);
    while (this.notifications.childElementCount > MAX_NOTIFICATIONS) {
      const oldest = this.notifications.firstElementChild;
      if (!oldest) {
        break;
      }
      this.dropNotification(oldest);
    }
    setTimeout(() => this.dropNotification(item), NOTIFICATION_MS);
  }

  private dropNotification(item: Element): void {
    this.notificationTexts.delete(item);
    item.remove();
  }

  private buildTop(): void {
    this.resourceValues.clear();
    const resources = RESOURCE_KINDS.map((kind) => {
      const value = h('span', 'value');
      this.resourceValues.set(kind, value);
      const item = h('div', ['top-item', 'resource', `res-${kind}`], [h('span', 'res-icon'), value]);
      item.title = [t(`resource.${kind}`), t(`resource.${kind}.desc`)].join('\n');
      return item;
    });
    this.population = h('span', 'value');
    const population = h('div', ['top-item', 'population'], [
      h('span', 'top-label', t('ui.hud.population')),
      this.population,
    ]);
    this.age = h('span', 'value');
    const age = h('div', ['top-item', 'age'], [this.age]);
    age.title = t('ui.hud.age');
    this.clock = h('span', 'value');
    const clock = h('div', ['top-item', 'clock'], [this.clock]);
    clock.title = t('ui.hud.game_time');
    this.speed = button('', () => this.callbacks.onSpeed());
    this.speed.title = t('ui.hud.speed');
    replace(this.top, [
      ...resources,
      population,
      age,
      clock,
      this.timers,
      h('div', 'top-buttons', [
        this.speed,
        button(t('ui.hud.diplomacy'), () => this.callbacks.onDiplomacy()),
        button(t('ui.hud.guide'), () => this.callbacks.onGuide()),
        this.sandbox && button(t('ui.hud.sandbox'), () => this.callbacks.onSandbox()),
        button(t('ui.hud.menu'), () => this.callbacks.onMenu()),
      ]),
    ]);
  }

  private buildTouchbar(): void {
    replace(
      this.touchbar,
      TOUCH_TOOLS.map((tool) => {
        const node = button(t(`ui.touch.${tool}`), () => this.callbacks.onTouchTool(tool), [
          'touch-tool',
          tool === this.touchTool ? 'active' : '',
        ]);
        node.dataset.tool = tool;
        node.title = t(`ui.touch.${tool}.hint`);
        return node;
      }),
    );
  }

  private updateTop(view: PlayerView): void {
    for (const kind of RESOURCE_KINDS) {
      const node = this.resourceValues.get(kind);
      if (node) {
        node.textContent = String(Math.floor(view.self.resources[kind]));
      }
    }
    this.population.textContent = `${view.self.population}/${view.self.housing}`;
    this.population.title = t('ui.hud.population_limit', { limit: view.self.populationLimit });
    this.population.classList.toggle('warn', view.self.population >= view.self.housing);
    this.age.textContent = t(`age.${view.self.age}`);
    this.clock.textContent = formatClock(view.tick / this.data.game.tickRate);
    const multiplier = this.data.game.speedMultipliers[view.speed];
    this.speed.textContent = `×${multiplier.toLocaleString(getLanguage(), { minimumFractionDigits: 1 })}`;
    const lines = view.victoryTimers.map((timer) =>
      t(`ui.timer.${timer.kind}`, {
        player: playerName(view.players, timer.playerId, view.playerId),
        years: Math.max(0, Math.ceil((timer.endTick - view.tick) / this.data.game.ticksPerGameYear)),
      }),
    );
    const key = lines.join('|');
    if (key !== this.timerKey) {
      this.timerKey = key;
      replace(
        this.timers,
        lines.map((line) => h('div', 'timer', line)),
      );
    }
  }

  private portrait(entity: EntityView, view: PlayerView, small: boolean): HTMLElement {
    const node = h('div', ['portrait', small ? 'small' : 'large', `kind-${entity.kind}`]);
    const owner = view.players.find((player) => player.id === entity.owner);
    if (owner) {
      node.style.borderColor = colorCss(owner.color);
    }
    const health = progressBar(entity.maxHp > 0 ? entity.hp / entity.maxHp : 0, ['health']);
    node.append(h('span', 'portrait-name', entityName(entity)), health.root);
    return node;
  }

  private activityText(entity: EntityView, view: PlayerView): string | null {
    const activity = activityOf(entity, view, this.data);
    return activity === null ? null : t(`ui.activity.${activity}`);
  }

  private statRows(entity: EntityView): [string, string][] {
    const rows: [string, string][] = [];
    const add = (key: string, value: string | number): void => {
      rows.push([t(`ui.stat.${key}`), String(value)]);
    };
    const unit = entity.kind === 'unit' ? this.data.units[entity.type] : undefined;
    const building = entity.kind === 'building' ? this.data.buildings[entity.type] : undefined;
    const def = unit ?? building;
    const hp = `${Math.ceil(entity.hp)}/${Math.ceil(entity.maxHp)}`;
    if (def) {
      rows.push(...combatRows(def, hp));
    } else if (entity.kind === 'unit' || entity.kind === 'building') {
      add('hp', hp);
    }
    if (entity.kind === 'resource' && entity.amount !== null) {
      add('amount', Math.ceil(entity.amount));
    }
    if (entity.kind === 'building' && !isCompleted(entity)) {
      add('progress', `${Math.floor(clamp01(entity.buildProgress ?? 0) * 100)}%`);
    }
    const own = entity.own;
    if (own) {
      if (own.carry && own.carry.amount > 0) {
        add('carry', `${Math.floor(own.carry.amount)} ${t(`resource.${own.carry.resource}`)}`);
      }
      if (own.faith !== null) {
        add('faith', `${Math.floor(own.faith)}%`);
      }
      if (unit?.transportCapacity) {
        add('cargo', `${own.cargo.length}/${unit.transportCapacity}`);
      }
    }
    return rows;
  }

  private infoSignature(model: HudModel): string {
    const { selection, view } = model;
    if (selection.length === 1) {
      const entity = selection[0];
      return [
        getLanguage(),
        entity.id,
        entity.type,
        entity.owner,
        activityOf(entity, view, this.data) ?? '',
        Math.ceil(entity.hp),
        entity.maxHp,
        Math.ceil(entity.amount ?? 0),
        Math.floor((entity.buildProgress ?? 1) * 100),
        Math.floor(entity.own?.carry?.amount ?? 0),
        entity.own?.carry?.resource ?? '',
        Math.floor(entity.own?.faith ?? 0),
        entity.own?.cargo.length ?? 0,
      ].join(':');
    }
    return [
      getLanguage(),
      ...selection.map(
        (entity) =>
          `${entity.id}.${entity.type}.${Math.round((entity.hp / (entity.maxHp || 1)) * 20)}.${activityOf(entity, view, this.data) ?? ''}`,
      ),
    ].join(':');
  }

  private updateInfo(model: HudModel): void {
    const key = this.infoSignature(model);
    if (key === this.infoKey) {
      return;
    }
    this.infoKey = key;
    const { selection, view } = model;
    if (selection.length === 0) {
      replace(this.info, []);
      return;
    }
    if (selection.length === 1) {
      const entity = selection[0];
      const activity = this.activityText(entity, view);
      const description = entityDescription(entity);
      replace(this.info, [
        h('div', 'portrait-column', [
          this.portrait(entity, view, false),
          activity !== null && h('div', 'portrait-activity', activity),
        ]),
        h('div', 'info-main', [
          h('div', 'info-name', entityName(entity)),
          h('div', 'info-owner', playerName(view.players, entity.owner, view.playerId)),
          h('div', 'stats', this.statRows(entity).map(statRow)),
          description !== null && h('div', 'info-desc', description),
        ]),
      ]);
      return;
    }
    const shown = selection.slice(0, MAX_PORTRAITS);
    const children: Child[] = shown.map((entity) => {
      const node = this.portrait(entity, view, true);
      const activity = this.activityText(entity, view);
      node.title = activity === null ? entityName(entity) : [entityName(entity), activity].join('\n');
      onPress(node, (event) => this.callbacks.onPortrait(entity.id, event.shiftKey));
      return node;
    });
    replace(this.info, [
      h('div', 'info-count', t('ui.hud.selected', { count: selection.length })),
      h('div', 'portrait-grid', children),
    ]);
  }

  private updateQueue(model: HudModel): void {
    const building = model.selection.length > 0 ? model.selection[0] : null;
    const own = building && building.kind === 'building' ? building.own : null;
    if (!building || !own || (own.research === null && own.queue.length === 0)) {
      if (this.queueKey !== '') {
        this.queueKey = '';
        this.progress = [];
        replace(this.queue, []);
      }
      return;
    }
    const key = [
      getLanguage(),
      building.id,
      own.research?.technology ?? '',
      ...own.queue.map((item) => item.unit),
    ].join(':');
    if (key !== this.queueKey) {
      this.queueKey = key;
      this.progress = [];
      const id = building.id;
      const items: HTMLElement[] = [];
      const readEntity = (view: PlayerView): EntityView | undefined =>
        view.entities.find((entity) => entity.id === id);
      if (own.research) {
        const bar = progressBar(own.research.progress);
        const item = h('div', ['queue-item', 'research'], [
          h('span', 'queue-name', t(`tech.${own.research.technology}.name`)),
          bar.root,
        ]);
        item.title = t('ui.queue.cancel');
        onPress(item, () => this.callbacks.onResearchCancel(id));
        this.progress.push({
          bar: bar.fill,
          read: (view) => readEntity(view)?.own?.research?.progress ?? 0,
        });
        items.push(item);
      }
      own.queue.forEach((entry, index) => {
        const bar = progressBar(entry.progress);
        const item = h('div', 'queue-item', [
          h('span', 'queue-name', t(`unit.${entry.unit}.name`)),
          bar.root,
        ]);
        item.title = t('ui.queue.cancel');
        onPress(item, () => this.callbacks.onQueueCancel(id, index));
        this.progress.push({
          bar: bar.fill,
          read: (view) => readEntity(view)?.own?.queue[index]?.progress ?? 0,
        });
        items.push(item);
      });
      replace(this.queue, [h('div', 'queue-title', t('ui.queue.title')), h('div', 'queue-items', items)]);
      return;
    }
    for (const ref of this.progress) {
      ref.bar.style.width = `${Math.round(clamp01(ref.read(model.view)) * 100)}%`;
    }
  }

  private updateCommands(buttons: readonly PanelButton[]): void {
    this.buttons = buttons;
    const key = [
      getLanguage(),
      ...buttons.map((item) =>
        [
          item.slot,
          item.key,
          item.availability.reason ?? '',
          item.availability.resource ?? '',
          JSON.stringify(item.requires),
          item.active ? 1 : 0,
          costEntries(item.cost).join(),
        ].join('.'),
      ),
    ].join('|');
    if (key === this.commandKey) {
      return;
    }
    this.commandKey = key;
    const cells: HTMLElement[] = [];
    for (let slot = 0; slot < PANEL_SLOTS; slot++) {
      const item = buttons.find((candidate) => candidate.slot === slot);
      if (!item) {
        cells.push(h('div', ['cmd', 'empty']));
        continue;
      }
      const cell = h('div', ['cmd', `icon-${item.iconKind}`], [
        h('span', 'cmd-name', t(item.nameKey)),
        h('span', 'cmd-key', slotLabel(slot)),
      ]);
      cell.classList.toggle('disabled', item.availability.reason !== null);
      cell.classList.toggle('active', item.active);
      cell.dataset.slot = String(slot);
      cells.push(cell);
    }
    replace(this.commands, cells);
    this.renderTooltip();
  }

  private slotOf(target: EventTarget | null): number | null {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    const cell = target.closest<HTMLElement>('[data-slot]');
    return cell ? Number(cell.dataset.slot) : null;
  }

  private bindCommandPanel(): void {
    this.commands.addEventListener('mousedown', (event) => {
      const slot = this.slotOf(event.target);
      const item = this.buttons.find((candidate) => candidate.slot === slot);
      if (event.button === 0 && item) {
        event.preventDefault();
        this.callbacks.onPanelButton(item, event.shiftKey);
      }
    });
    this.commands.addEventListener('mouseover', (event) => {
      if (event.timeStamp - this.lastTouchAt < TOUCH_MOUSE_GUARD_MS) {
        return;
      }
      this.touchedName = null;
      this.hoveredSlot = this.slotOf(event.target);
      this.renderTooltip();
    });
    this.commands.addEventListener('mouseleave', (event) => {
      if (event.timeStamp - this.lastTouchAt < TOUCH_MOUSE_GUARD_MS) {
        return;
      }
      this.hoveredSlot = null;
      this.renderTooltip();
    });
    this.commands.addEventListener(
      'touchstart',
      (event) => {
        this.lastTouchAt = event.timeStamp;
        const slot = this.slotOf(event.target);
        this.hoveredSlot = slot;
        this.touchedName = this.buttons.find((candidate) => candidate.slot === slot)?.nameKey ?? null;
        this.renderTooltip();
        if (this.tooltipTimer !== null) {
          clearTimeout(this.tooltipTimer);
        }
        this.tooltipTimer = setTimeout(() => {
          this.tooltipTimer = null;
          this.touchedName = null;
          this.hoveredSlot = null;
          this.renderTooltip();
        }, TOUCH_TOOLTIP_MS);
      },
      { passive: true },
    );
  }

  private renderTooltip(): void {
    const item = this.buttons.find((candidate) => candidate.slot === this.hoveredSlot);
    if (!item || (this.touchedName !== null && item.nameKey !== this.touchedName)) {
      this.tooltip.hidden = true;
      return;
    }
    const cost = costEntries(item.cost).map(([kind, amount]) =>
      h('span', ['cost', `res-${kind}`], [h('span', 'res-icon'), String(amount)]),
    );
    const { reason, resource } = item.availability;
    const building = item.iconKind === 'building' ? this.data.buildings[item.iconId] : undefined;
    const def = item.iconKind === 'unit' ? this.data.units[item.iconId] : building;
    const stats = def ? combatRows(def, String(def.hp)) : [];
    if (building && building.housing > 0) {
      stats.push([t('ui.stat.housing'), `+${building.housing}`]);
    }
    const gated = reason === 'age' || reason === 'prerequisite';
    replace(this.tooltip, [
      h('div', 'tooltip-head', [
        h('span', 'tooltip-name', t(item.nameKey)),
        h('span', 'tooltip-key', t('ui.tooltip.hotkey', { key: slotLabel(item.slot) })),
      ]),
      cost.length > 0 && h('div', 'tooltip-cost', cost),
      item.descKey !== null && hasTranslation(item.descKey) && h('div', 'tooltip-desc', t(item.descKey)),
      stats.length > 0 && h('div', 'tooltip-stats', stats.map(statRow)),
      item.requires.length > 0 && h('div', 'tooltip-reason', requirementsText(item.requires)),
      reason !== null &&
        !(gated && item.requires.length > 0) &&
        h('div', 'tooltip-reason', reasonText(reason, resource)),
    ]);
    this.tooltip.hidden = false;
  }
}
