import type { GameData, ResourceKind } from '../../data/types';
import { RESOURCE_KINDS } from '../../data/types';
import type { PlayerView } from '../../sim/snapshot';
import type { PlayerId, Stance } from '../../sim/types';
import type { Child } from '../dom';
import { button, h, replace } from '../dom';
import { colorCss } from '../format';
import { getLanguage, t } from '../i18n';
import { civilizationName, playerName } from '../labels';

export const STANCES: readonly Stance[] = ['ally', 'neutral', 'enemy'];

export interface DiplomacyCallbacks {
  onStance(playerId: PlayerId, stance: Stance): void;
  onTribute(playerId: PlayerId, resource: ResourceKind, amount: number): void;
  onClose(): void;
}

function labeledCell(labelKey: string, classes: string | readonly string[], children: readonly Child[] | string): HTMLElement {
  const cell = h('td', classes, children);
  cell.dataset.label = t(labelKey);
  return cell;
}

export class DiplomacyWindow {
  readonly element = h('div', 'backdrop');
  private readonly panel = h('div', ['panel', 'diplomacy']);
  private key = '';

  constructor(
    private readonly data: GameData,
    private readonly callbacks: DiplomacyCallbacks,
  ) {
    this.element.appendChild(this.panel);
  }

  update(view: PlayerView): void {
    const amount = this.data.game.tributeAmount;
    const taxRate = view.self.flags.no_tribute_tax ? 0 : this.data.game.tributeTax;
    const charge = Math.ceil(amount * (1 + taxRate));
    const others = view.players.filter((player) => player.id !== view.playerId);
    const key = [
      getLanguage(),
      taxRate,
      view.settings.lockTeams,
      RESOURCE_KINDS.map((kind) => view.self.resources[kind] >= charge).join(),
      ...others.map((player) =>
        [player.id, player.defeated, player.stanceTowardViewer, view.self.diplomacy[player.id]].join('.'),
      ),
    ].join('|');
    if (key === this.key) {
      return;
    }
    this.key = key;
    const rows = others.map((player) => {
      const swatch = h('span', 'swatch');
      swatch.style.backgroundColor = colorCss(player.color);
      const mine = view.self.diplomacy[player.id] ?? 'enemy';
      const stances = STANCES.map((stance) => {
        const control = button(t(`ui.stance.${stance}`), () => this.callbacks.onStance(player.id, stance));
        control.classList.toggle('active', stance === mine);
        control.disabled = view.settings.lockTeams || player.defeated;
        return control;
      });
      const tributes = RESOURCE_KINDS.map((kind) => {
        const control = button(String(amount), () => this.callbacks.onTribute(player.id, kind, amount), [
          'tribute',
          `res-${kind}`,
        ]);
        control.prepend(h('span', 'res-icon'));
        control.title = t('ui.diplomacy.tribute', { amount, resource: t(`resource.${kind}`) });
        control.disabled = player.defeated || view.self.resources[kind] < charge;
        return control;
      });
      return h('tr', player.defeated ? 'defeated' : [], [
        labeledCell('ui.diplomacy.player', 'diplomacy-player', [swatch, playerName(view.players, player.id, view.playerId)]),
        labeledCell('ui.diplomacy.civilization', [], civilizationName(player.civilization)),
        labeledCell('ui.diplomacy.team', [], player.team === null ? t('ui.setup.no_team') : String(player.team)),
        labeledCell('ui.diplomacy.their_stance', [], player.defeated
          ? t('ui.diplomacy.defeated')
          : player.stanceTowardViewer === null
            ? ''
            : t(`ui.stance.${player.stanceTowardViewer}`)),
        labeledCell('ui.diplomacy.your_stance', 'stance-cell', stances),
        labeledCell('ui.diplomacy.tribute_head', 'tribute-cell', tributes),
      ]);
    });
    replace(this.panel, [
      h('h2', 'dialog-title', t('ui.diplomacy.title')),
      h('table', 'diplomacy-table', [
        h('tr', [], [
          h('th', [], t('ui.diplomacy.player')),
          h('th', [], t('ui.diplomacy.civilization')),
          h('th', [], t('ui.diplomacy.team')),
          h('th', [], t('ui.diplomacy.their_stance')),
          h('th', [], t('ui.diplomacy.your_stance')),
          h('th', [], t('ui.diplomacy.tribute_head')),
        ]),
        ...rows,
      ]),
      h('p', 'diplomacy-tax', t('ui.diplomacy.tax', { percent: Math.round(taxRate * 100) })),
      view.settings.lockTeams && h('p', 'diplomacy-locked', t('ui.diplomacy.locked')),
      h('div', 'dialog-actions', [button(t('ui.common.close'), () => this.callbacks.onClose(), ['primary'])]),
    ]);
  }
}
