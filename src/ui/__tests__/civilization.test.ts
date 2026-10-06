import { describe, expect, it } from 'vitest';
import en from '../../locales/en.json';
import ru from '../../locales/ru.json';
import { availableCount, civilizationOverview, unavailableRefs } from '../civilization';
import { civilizationSummary, civilizationTree, plainRef } from '../civilizationView';
import { h } from '../dom';
import { guideEntries } from '../game/guide';
import { GuideWindow } from '../game/guideWindow';
import { data, makeView } from './fixtures';

function ids(refs: readonly { id: string }[]): string[] {
  return refs.map((ref) => ref.id);
}

describe('civilization overview', () => {
  it('marks disabled units and technologies as unavailable', () => {
    for (const civilization of Object.values(data.civilizations)) {
      const overview = civilizationOverview(data, civilization.id);
      expect(ids(unavailableRefs(overview.entries.unit))).toEqual(
        expect.arrayContaining(civilization.disabledUnits),
      );
      expect(ids(unavailableRefs(overview.entries.technology))).toEqual(
        expect.arrayContaining(civilization.disabledTechs),
      );
    }
  });

  it('follows prerequisites of what is disabled', () => {
    const minoan = civilizationOverview(data, 'minoan');
    expect(ids(unavailableRefs(minoan.entries.building))).toEqual([
      'fortification',
      'guard_tower',
      'ballista_tower',
    ]);
    const assyrian = civilizationOverview(data, 'assyrian');
    expect(ids(unavailableRefs(assyrian.entries.unit))).toEqual(
      expect.arrayContaining(['improved_bowman', 'composite_bowman', 'phalanx', 'centurion']),
    );
    const persian = civilizationOverview(data, 'persian');
    expect(ids(unavailableRefs(persian.entries.unit))).toEqual(
      expect.arrayContaining(['chariot', 'chariot_archer', 'helepolis', 'heavy_catapult']),
    );
  });

  it('covers every guide entry once and groups units and technologies by building', () => {
    const overview = civilizationOverview(data, 'greek');
    const total = overview.entries.building.length + overview.entries.unit.length + overview.entries.technology.length;
    expect(total).toBe(guideEntries(data).length);
    const grouped = overview.sections.flatMap((section) => [...section.units, ...section.technologies]);
    expect(grouped.length).toBe(overview.entries.unit.length + overview.entries.technology.length);
    expect(availableCount(overview.entries.unit)).toBeLessThan(overview.entries.unit.length);
    expect(ids(overview.sections.map((section) => section.building.ref))).toContain('academy');
  });

  it('has a description for every civilization in both languages', () => {
    for (const id of Object.keys(data.civilizations)) {
      expect(en).toHaveProperty([`civ.${id}.desc`]);
      expect(ru).toHaveProperty([`civ.${id}.desc`]);
    }
  });

  it('renders the summary and the tree with unavailable entries struck through', () => {
    const overview = civilizationOverview(data, 'egyptian');
    const root = h('div', [], [
      ...civilizationSummary(overview, false, plainRef),
      ...civilizationTree(overview, plainRef),
    ]);
    expect(root.textContent).toContain(en['civ.egyptian.desc']);
    expect(root.textContent).toContain(en['civ.egyptian.bonuses']);
    expect(root.querySelectorAll('.civ-section').length).toBe(overview.sections.length);
    const blocked = [...root.querySelectorAll('.civ-section .civ-entry.blocked')].map((node) => node.textContent);
    expect(blocked).toContain(en['unit.cavalry.name']);
    expect(blocked).not.toContain(en['unit.chariot.name']);
    expect(root.querySelector('.civ-note')).toBeNull();
    const full = h('div', [], civilizationSummary(overview, true, plainRef));
    expect(full.querySelector('.civ-note')).not.toBeNull();
  });
});

describe('guide window civilizations', () => {
  it('lists civilizations and opens their tech tree with links to entries', () => {
    const guide = new GuideWindow(data, { onClose: () => {} });
    guide.update(makeView());
    const items = guide.element.querySelectorAll<HTMLElement>('.guide-civ');
    expect(items.length).toBe(Object.keys(data.civilizations).length);
    expect(guide.element.querySelectorAll('.guide-civ.ready').length).toBe(1);
    guide.selectCivilization('greek');
    expect(guide.element.querySelector('.guide-civ.active')?.textContent).toBe(en['civ.greek.name']);
    expect(guide.element.querySelector('.guide-detail')?.textContent).toContain(en['civ.greek.desc']);
    const link = guide.element.querySelector<HTMLElement>('.civ-section .guide-chips .guide-link');
    link?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(guide.element.querySelector('.guide-civ.active')).toBeNull();
    expect(guide.element.querySelector('.guide-step.target')).not.toBeNull();
  });
});
