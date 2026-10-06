import type { GameData } from '../../data/types';
import { AGE_ORDER } from '../../data/types';
import type { PlayerView } from '../../sim/snapshot';
import { civilizationOverview } from '../civilization';
import { civilizationSummary, civilizationTree } from '../civilizationView';
import type { Child } from '../dom';
import { button, h, onPress, replace } from '../dom';
import { costEntries } from '../format';
import { getLanguage, hasTranslation, t } from '../i18n';
import { civilizationName } from '../labels';
import { ownedBuildingTypes, viewerCivilization } from './availability';
import type { GuideChain, GuideKind, GuideRef, GuideStep } from './guide';
import { GUIDE_KINDS, guideChain, guideEntries, guideUnlocks, refKey, sameRef } from './guide';

export interface GuideCallbacks {
  onClose(): void;
}

const LOCALE_PREFIX: Record<GuideKind, string> = {
  building: 'building',
  unit: 'unit',
  technology: 'tech',
};

function refName(ref: GuideRef): string {
  return t(`${LOCALE_PREFIX[ref.kind]}.${ref.id}.name`);
}

function stepVerb(step: GuideStep): string {
  if (step.advancesTo !== null) {
    return 'advance';
  }
  return step.ref.kind === 'building' ? 'build' : step.ref.kind === 'unit' ? 'train' : 'research';
}

export class GuideWindow {
  readonly element = h('div', 'backdrop');
  private readonly title = h('h2', 'dialog-title');
  private readonly search = h('input', 'text-input');
  private readonly list = h('div', 'guide-list');
  private readonly detail = h('div', 'guide-detail');
  private readonly close: HTMLButtonElement;
  private readonly entries: readonly GuideRef[];
  private readonly civilizations: readonly string[];
  private selected: GuideRef | null = null;
  private civilization: string | null = null;
  private view: PlayerView | null = null;
  private key = '';

  constructor(
    private readonly data: GameData,
    callbacks: GuideCallbacks,
  ) {
    this.entries = guideEntries(data);
    this.civilizations = Object.keys(data.civilizations);
    this.close = button('', () => callbacks.onClose(), ['primary']);
    this.search.type = 'search';
    this.search.addEventListener('input', () => this.render());
    this.element.appendChild(
      h('div', ['panel', 'guide'], [
        this.title,
        h('div', 'guide-body', [h('div', 'guide-side', [this.search, this.list]), this.detail]),
        h('div', 'dialog-actions', [this.close]),
      ]),
    );
  }

  update(view: PlayerView): void {
    this.view = view;
    this.render();
  }

  select(ref: GuideRef): void {
    this.selected = ref;
    this.civilization = null;
    this.render();
    this.detail.scrollTop = 0;
  }

  selectCivilization(id: string): void {
    this.selected = null;
    this.civilization = id;
    this.render();
    this.detail.scrollTop = 0;
  }

  private render(): void {
    const view = this.view;
    if (!view) {
      return;
    }
    const query = this.search.value.trim().toLocaleLowerCase();
    const key = [
      getLanguage(),
      view.self.age,
      view.settings.fullTechTree === true,
      view.self.researched.join(),
      [...ownedBuildingTypes(view)].sort().join(),
      this.selected ? refKey(this.selected) : '',
      this.civilization ?? '',
      query,
    ].join('|');
    if (key === this.key) {
      return;
    }
    this.key = key;
    this.title.textContent = t('ui.guide.title');
    this.close.textContent = t('ui.common.close');
    this.search.placeholder = t('ui.guide.search');
    const chains = new Map<string, GuideChain>();
    for (const entry of this.entries) {
      chains.set(refKey(entry), guideChain(this.data, view, entry));
    }
    this.renderList(view, chains, query);
    if (this.civilization !== null) {
      this.renderCivilization(view, this.civilization);
    } else {
      this.renderDetail(chains);
    }
  }

  private link(ref: GuideRef, chains: ReadonlyMap<string, GuideChain>, classes: readonly string[] = []): HTMLElement {
    const node = h('span', ['guide-link', ...classes], refName(ref));
    node.classList.toggle('blocked', chains.get(refKey(ref))?.blocked ?? false);
    onPress(node, () => this.select(ref));
    return node;
  }

  private renderList(view: PlayerView, chains: ReadonlyMap<string, GuideChain>, query: string): void {
    const groups: Child[] = [];
    const own = viewerCivilization(view, this.data)?.id ?? null;
    const civilizations = this.civilizations
      .filter((id) => civilizationName(id).toLocaleLowerCase().includes(query))
      .map((id) => {
        const item = h('div', ['guide-item', 'guide-civ'], civilizationName(id));
        item.dataset.civ = id;
        item.classList.toggle('active', id === this.civilization);
        item.classList.toggle('ready', id === own);
        if (id === own) {
          item.title = t('ui.civ.own');
        }
        onPress(item, () => this.selectCivilization(id));
        return item;
      });
    if (civilizations.length > 0) {
      groups.push(h('div', 'guide-group', t('ui.guide.kind.civilization')), ...civilizations);
    }
    for (const kind of GUIDE_KINDS) {
      const items = this.entries
        .filter((entry) => entry.kind === kind && refName(entry).toLocaleLowerCase().includes(query))
        .map((entry) => {
          const chain = chains.get(refKey(entry));
          const item = h('div', 'guide-item', refName(entry));
          item.classList.toggle('active', sameRef(entry, this.selected));
          item.classList.toggle('blocked', chain?.blocked ?? false);
          item.classList.toggle('ready', chain !== undefined && chain.ready && !chain.blocked);
          if (chain?.blocked) {
            item.title = t('ui.guide.blocked');
          } else if (chain?.ready) {
            item.title = t('ui.guide.ready');
          }
          onPress(item, () => this.select(entry));
          return item;
        });
      if (items.length > 0) {
        groups.push(h('div', 'guide-group', t(`ui.guide.kind.${kind}`)), ...items);
      }
    }
    replace(this.list, groups.length > 0 ? groups : [h('div', 'guide-hint', t('ui.guide.none'))]);
  }

  private stepRow(step: GuideStep, chain: GuideChain, chains: ReadonlyMap<string, GuideChain>): HTMLElement {
    const target = sameRef(step.ref, this.selected);
    const cost = costEntries(step.cost).map(([kind, amount]) =>
      h('span', ['cost', `res-${kind}`], [h('span', 'res-icon'), String(amount)]),
    );
    const planned = new Set(chain.steps.map((other) => refKey(other.ref)));
    const choice = step.choice;
    const row = h('li', 'guide-step', [
      h('div', 'guide-step-main', [
        h('span', 'guide-verb', t(`ui.guide.verb.${stepVerb(step)}`)),
        target ? h('span', 'guide-target', refName(step.ref)) : this.link(step.ref, chains),
        step.location !== null &&
          h('span', 'guide-where', [
            t(step.location.kind === 'unit' ? 'ui.guide.builder' : 'ui.guide.where'),
            this.link(step.location, chains),
          ]),
        cost.length > 0 && h('span', 'guide-cost', cost),
      ]),
      choice !== null &&
        h('div', 'guide-choice', [
          t('ui.guide.choice', { count: choice.count, have: choice.owned.length }),
          ...choice.buildings.map((id) => {
            const ref: GuideRef = { kind: 'building', id };
            const state = choice.owned.includes(id) ? 'owned' : planned.has(refKey(ref)) ? 'planned' : '';
            return this.link(ref, chains, [state]);
          }),
        ]),
    ]);
    row.classList.toggle('done', step.done);
    row.classList.toggle('target', target);
    return row;
  }

  private refList(titleKey: string, refs: readonly GuideRef[], chains: ReadonlyMap<string, GuideChain>): Child {
    return (
      refs.length > 0 &&
      h('div', 'guide-section', [
        h('h4', 'guide-heading', t(titleKey)),
        h('div', 'guide-chips', refs.map((ref) => this.link(ref, chains))),
      ])
    );
  }

  private renderCivilization(view: PlayerView, id: string): void {
    const overview = civilizationOverview(this.data, id);
    const link = (ref: GuideRef): HTMLElement => {
      const node = h('span', 'guide-link', refName(ref));
      onPress(node, () => this.select(ref));
      return node;
    };
    replace(this.detail, [
      h('h3', 'guide-name', civilizationName(id)),
      viewerCivilization(view, this.data)?.id === id && h('p', 'guide-ready', t('ui.civ.own')),
      ...civilizationSummary(overview, view.settings.fullTechTree === true, link),
      ...civilizationTree(overview, link),
    ]);
  }

  private renderDetail(chains: ReadonlyMap<string, GuideChain>): void {
    const ref = this.selected;
    const chain = ref ? chains.get(refKey(ref)) : undefined;
    if (!ref || !chain) {
      replace(this.detail, [h('div', 'guide-hint', t('ui.guide.empty'))]);
      return;
    }
    const descKey = `${LOCALE_PREFIX[ref.kind]}.${ref.id}.desc`;
    const eras = AGE_ORDER.filter((age) => chain.steps.some((step) => step.age === age)).map((age) =>
      h('div', 'guide-era', [
        h('div', 'guide-era-name', t(`age.${age}`)),
        h('ol', 'guide-steps', chain.steps
          .filter((step) => step.age === age)
          .map((step) => this.stepRow(step, chain, chains))),
      ]),
    );
    const repeat = ref.kind === 'building' ? (this.data.buildings[ref.id]?.requiresWhenOwned ?? []) : [];
    const unlocks = guideUnlocks(this.data, ref);
    replace(this.detail, [
      h('h3', 'guide-name', refName(ref)),
      hasTranslation(descKey) && h('p', 'guide-desc', t(descKey)),
      chain.blocked && h('p', 'guide-blocked', t('ui.guide.blocked')),
      !chain.blocked && chain.ready && h('p', 'guide-ready', t('ui.guide.ready')),
      h('div', 'guide-section', [h('h4', 'guide-heading', t('ui.guide.chain')), ...eras]),
      repeat.length > 0 &&
        h('p', 'guide-repeat', [
          t('ui.guide.repeat'),
          ...repeat.map((id) => this.link({ kind: 'building', id }, chains)),
        ]),
      this.refList('ui.guide.trains', unlocks.trains, chains),
      this.refList('ui.guide.researches', unlocks.researches, chains),
      this.refList('ui.guide.unlocks', unlocks.unlocks, chains),
    ]);
  }
}
