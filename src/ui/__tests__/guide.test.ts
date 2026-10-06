import { describe, expect, it } from 'vitest';
import type { GuideRef } from '../game/guide';
import { guideChain, guideEntries, guideUnlocks, refKey } from '../game/guide';
import { GuideWindow } from '../game/guideWindow';
import { addEntity, data, makeView } from './fixtures';

const FARM: GuideRef = { kind: 'building', id: 'farm' };

function order(ids: readonly string[], ...expected: string[]): void {
  const positions = expected.map((id) => ids.indexOf(id));
  expect(positions).not.toContain(-1);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
}

describe('guide chain', () => {
  it('lists every step towards a farm in a doable order', () => {
    const chain = guideChain(data, makeView(), FARM);
    const ids = chain.steps.map((step) => step.ref.id);
    expect(ids).toEqual(['town_center', 'granary', 'tool_age', 'market', 'farm']);
    expect(chain.steps.map((step) => step.age)).toEqual(['stone', 'stone', 'stone', 'tool', 'tool']);
    const advance = chain.steps[2];
    expect(advance.advancesTo).toBe('tool');
    expect(advance.location).toEqual({ kind: 'building', id: 'town_center' });
    expect(advance.choice?.count).toBe(2);
    expect(advance.choice?.buildings).toContain('granary');
    expect(chain.ready).toBe(false);
  });

  it('tracks progress of the viewer', () => {
    const view = makeView();
    expect(guideChain(data, view, FARM).steps.find((step) => step.ref.id === 'town_center')?.done).toBe(true);
    addEntity(view, { kind: 'building', type: 'market', owner: view.playerId });
    view.self.age = 'tool';
    const chain = guideChain(data, view, FARM);
    expect(chain.steps.filter((step) => !step.done).map((step) => step.ref.id)).toEqual(['farm']);
    expect(chain.ready).toBe(true);
  });

  it('follows technologies researched in other buildings', () => {
    const view = makeView();
    view.settings.fullTechTree = true;
    const ids = guideChain(data, view, { kind: 'unit', id: 'legion' }).steps.map((step) => step.ref.id);
    order(ids, 'tool_age', 'bronze_age', 'short_sword', 'broad_sword', 'iron_age', 'long_sword', 'legion');
    order(ids, 'market', 'temple', 'fanaticism', 'legion');
  });

  it('orders every chain so that prerequisites come first', () => {
    const view = makeView();
    for (const entry of guideEntries(data)) {
      const steps = guideChain(data, view, entry).steps;
      expect(refKey(steps[steps.length - 1].ref)).toBe(refKey(entry));
      const ages = steps.map((step) => ['stone', 'tool', 'bronze', 'iron'].indexOf(step.age));
      expect(ages).toEqual([...ages].sort((a, b) => a - b));
    }
  });

  it('marks what the civilization cannot get', () => {
    const view = makeView();
    const civilization = data.civilizations.assyrian;
    const unit: GuideRef = { kind: 'unit', id: civilization.disabledUnits[0] };
    expect(guideChain(data, view, unit).blocked).toBe(true);
    view.settings.fullTechTree = true;
    expect(guideChain(data, view, unit).blocked).toBe(false);
  });

  it('tells what a building gives', () => {
    const unlocks = guideUnlocks(data, { kind: 'building', id: 'market' });
    expect(unlocks.trains).toEqual([]);
    expect(unlocks.researches.map((ref) => ref.id)).toContain('wheel');
    expect(unlocks.unlocks.map((ref) => ref.id)).toEqual(
      expect.arrayContaining(['farm', 'government_center', 'temple', 'bronze_age']),
    );
  });
});

describe('guide window', () => {
  it('shows the chain of the picked entry and follows links', () => {
    let closed = 0;
    const guide = new GuideWindow(data, { onClose: () => (closed += 1) });
    guide.update(makeView());
    expect(guide.element.querySelectorAll('.guide-item:not(.guide-civ)').length).toBe(
      guideEntries(data).length,
    );
    guide.select(FARM);
    expect(guide.element.querySelectorAll('.guide-step').length).toBe(5);
    expect(guide.element.querySelectorAll('.guide-step.done').length).toBe(1);
    const link = guide.element.querySelector<HTMLElement>('.guide-step .guide-link');
    link?.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    expect(guide.element.querySelector('.guide-item.active')).not.toBeNull();
    expect(guide.element.querySelector('.guide-step.target .guide-target')).not.toBeNull();
    expect(guide.element.querySelectorAll('.guide-step').length).toBeLessThan(5);
    guide.element.querySelector<HTMLButtonElement>('.dialog-actions .btn')?.click();
    expect(closed).toBe(1);
  });

  it('filters the list by name', () => {
    const guide = new GuideWindow(data, { onClose: () => {} });
    guide.update(makeView());
    const search = guide.element.querySelector<HTMLInputElement>('input');
    if (!search) {
      throw new Error('search input is missing');
    }
    search.value = 'zzzz';
    search.dispatchEvent(new Event('input'));
    expect(guide.element.querySelectorAll('.guide-item').length).toBe(0);
    expect(guide.element.querySelector('.guide-hint')).not.toBeNull();
  });
});
