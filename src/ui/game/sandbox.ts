import type { PlayerPublicView, PlayerView } from '../../sim/snapshot';
import type { AiDirectiveMode, PlayerId } from '../../sim/types';
import { button, h, replace, select } from '../dom';
import { colorCss } from '../format';
import { getLanguage, t } from '../i18n';
import { playerName } from '../labels';

export const SANDBOX_MODES: readonly AiDirectiveMode[] = ['free', 'passive', 'off', 'frozen'];

export const SANDBOX_GRANTS: readonly number[] = [1000, 10000];

const NO_TARGET = 'none';

export interface SandboxCallbacks {
  onDirective(playerId: PlayerId, mode: AiDirectiveMode, victimId: PlayerId | null): void;
  onGrant(playerId: PlayerId, amount: number): void;
  onClose(): void;
}

export class SandboxWindow {
  readonly element = h('div', 'backdrop');
  private readonly panel = h('div', ['panel', 'sandbox']);
  private key = '';

  constructor(private readonly callbacks: SandboxCallbacks) {
    this.element.appendChild(this.panel);
  }

  update(view: PlayerView): void {
    const key = [
      getLanguage(),
      ...view.players.map((player) =>
        [player.id, player.defeated, player.aiDirective?.mode, player.aiDirective?.victimId].join('.'),
      ),
    ].join('|');
    if (key === this.key) {
      return;
    }
    this.key = key;
    replace(this.panel, [
      h('h2', 'dialog-title', t('ui.sandbox.title')),
      h('table', 'diplomacy-table', [
        h('tr', [], [
          h('th', [], t('ui.sandbox.player')),
          h('th', [], t('ui.sandbox.behaviour')),
          h('th', [], t('ui.sandbox.attack')),
          h('th', [], t('ui.sandbox.resources')),
        ]),
        ...view.players.map((player) => this.row(view, player)),
      ]),
      h('div', 'dialog-actions', [button(t('ui.common.close'), () => this.callbacks.onClose(), ['primary'])]),
    ]);
  }

  private row(view: PlayerView, player: PlayerPublicView): HTMLElement {
    const swatch = h('span', 'swatch');
    swatch.style.backgroundColor = colorCss(player.color);
    const controllable = player.kind === 'ai' && !player.defeated;
    const mode = player.aiDirective?.mode ?? 'free';
    const modes = controllable
      ? SANDBOX_MODES.map((option) => {
          const control = button(t(`ui.sandbox.mode.${option}`), () =>
            this.callbacks.onDirective(player.id, option, null),
          );
          control.title = t(`ui.sandbox.mode.${option}.desc`);
          control.classList.toggle('active', option === mode);
          control.dataset.mode = option;
          return control;
        })
      : [];
    const victims = view.players.filter((other) => other.id !== player.id && !other.defeated);
    const victim = mode === 'attack' ? (player.aiDirective?.victimId ?? null) : null;
    const attack = controllable
      ? select(
          [
            { value: NO_TARGET, label: t('ui.sandbox.no_target') },
            ...victims.map((other) => ({
              value: String(other.id),
              label: playerName(view.players, other.id, view.playerId),
            })),
          ],
          victim === null ? NO_TARGET : String(victim),
          (value) =>
            value === NO_TARGET
              ? this.callbacks.onDirective(player.id, 'free', null)
              : this.callbacks.onDirective(player.id, 'attack', Number(value)),
        )
      : null;
    const grants = player.defeated
      ? []
      : SANDBOX_GRANTS.map((amount) => {
          const control = button(`+${amount}`, () => this.callbacks.onGrant(player.id, amount));
          control.title = t('ui.sandbox.grant', { amount });
          return control;
        });
    const row = h('tr', player.defeated ? 'defeated' : [], [
      h('td', 'diplomacy-player', [swatch, playerName(view.players, player.id, view.playerId)]),
      h('td', 'stance-cell', modes),
      h('td', [], [attack]),
      h('td', 'stance-cell', grants),
    ]);
    row.dataset.player = String(player.id);
    return row;
  }
}
