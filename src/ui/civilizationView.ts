import type { CivilizationEntry, CivilizationOverview } from './civilization';
import { availableCount, unavailableRefs } from './civilization';
import type { Child } from './dom';
import { h } from './dom';
import type { GuideRef } from './game/guide';
import { GUIDE_KINDS } from './game/guide';
import { t } from './i18n';
import { guideRefName } from './labels';

export type RefRenderer = (ref: GuideRef) => HTMLElement;

export function plainRef(ref: GuideRef): HTMLElement {
  return h('span', 'civ-entry', guideRefName(ref));
}

function entryNode(entry: CivilizationEntry, render: RefRenderer): HTMLElement {
  const node = render(entry.ref);
  node.classList.toggle('blocked', !entry.available);
  return node;
}

function chipRow(label: string, entries: readonly CivilizationEntry[], render: RefRenderer): Child {
  return (
    entries.length > 0 &&
    h('div', 'civ-row', [
      h('span', 'civ-row-label', label),
      h('div', 'guide-chips', entries.map((entry) => entryNode(entry, render))),
    ])
  );
}

export function civilizationSummary(
  overview: CivilizationOverview,
  fullTechTree: boolean,
  render: RefRenderer,
): Child[] {
  const { entries } = overview;
  return [
    h('p', 'guide-desc', t(`civ.${overview.id}.desc`)),
    fullTechTree && h('p', 'civ-note', t('ui.civ.full_tech_tree')),
    h('h4', 'guide-heading', t('ui.civ.bonuses')),
    h('p', 'civ-bonuses', t(`civ.${overview.id}.bonuses`)),
    h('h4', 'guide-heading', t('ui.civ.unavailable')),
    h(
      'p',
      'guide-desc',
      t('ui.civ.counts', {
        units: availableCount(entries.unit),
        unitTotal: entries.unit.length,
        techs: availableCount(entries.technology),
        techTotal: entries.technology.length,
      }),
    ),
    ...GUIDE_KINDS.map((kind): Child => {
      const refs = unavailableRefs(entries[kind]);
      return (
        refs.length > 0 &&
        h('div', 'civ-row', [
          h('span', 'civ-row-label', t(`ui.guide.kind.${kind}`)),
          h('div', 'guide-chips', refs.map(render)),
        ])
      );
    }),
  ];
}

export function civilizationTree(overview: CivilizationOverview, render: RefRenderer): Child[] {
  return [
    h('h4', 'guide-heading', t('ui.civ.tree')),
    h('p', 'guide-desc', t('ui.civ.tree_hint')),
    chipRow(t('ui.guide.kind.building'), overview.entries.building, render),
    ...overview.sections.map((section) =>
      h('div', 'civ-section', [
        h('div', 'guide-era-name', [entryNode(section.building, render)]),
        chipRow(t('ui.guide.trains'), section.units, render),
        chipRow(t('ui.guide.researches'), section.technologies, render),
      ]),
    ),
  ];
}
