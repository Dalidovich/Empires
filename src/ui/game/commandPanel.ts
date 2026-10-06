import type { Cost, GameData, UnitClass } from '../../data/types';
import type { EntityView, PlayerView } from '../../sim/snapshot';
import type { TradeGood } from '../../sim/types';
import type { Availability, Offer, Requirement } from './availability';
import { buildableBuildings, isCompleted, researchableTechs, trainableUnits } from './availability';

export const PANEL_SLOTS = 15;

export const SLOT_CODES: readonly string[] = [
  'KeyQ',
  'KeyW',
  'KeyE',
  'KeyR',
  'KeyT',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyF',
  'KeyG',
  'KeyZ',
  'KeyX',
  'KeyC',
  'KeyV',
  'KeyB',
];

export const TRADE_GOODS: readonly TradeGood[] = ['food', 'wood', 'stone'];

export type CursorMode = 'attackMove' | 'repair' | 'unload' | 'rally' | 'attackGround';

export type PanelPage = 'root' | 'build';

export type PanelAction =
  | { type: 'cursor'; mode: CursorMode }
  | { type: 'page'; page: PanelPage }
  | { type: 'nextPage' }
  | { type: 'stop' }
  | { type: 'standGround'; enabled: boolean }
  | { type: 'delete' }
  | { type: 'place'; building: string }
  | { type: 'train'; unit: string }
  | { type: 'research'; technology: string }
  | { type: 'tradeGood'; good: TradeGood };

export type IconKind = 'unit' | 'building' | 'tech' | 'action';

export interface PanelEntry {
  key: string;
  iconKind: IconKind;
  iconId: string;
  nameKey: string;
  descKey: string | null;
  cost: Cost;
  availability: Availability;
  requires: readonly Requirement[];
  active: boolean;
  action: PanelAction;
}

export interface PanelButton extends PanelEntry {
  slot: number;
}

export interface PanelState {
  page: PanelPage;
  pageIndex: number;
  tradeGood: TradeGood;
  cursor: CursorMode | null;
  placing: string | null;
}

const READY: Availability = { reason: null, blocked: false, resource: null };

export function slotLabel(slot: number): string {
  return (SLOT_CODES[slot] ?? '').replace(/^Key/, '');
}

function actionEntry(id: string, action: PanelAction, active = false): PanelEntry {
  return {
    key: `action:${id}`,
    iconKind: 'action',
    iconId: id,
    nameKey: `ui.action.${id}.name`,
    descKey: `ui.action.${id}.desc`,
    cost: {},
    availability: READY,
    requires: [],
    active,
    action,
  };
}

function offerEntry(kind: 'unit' | 'building' | 'tech', offer: Offer, action: PanelAction, active = false): PanelEntry {
  return {
    key: `${kind}:${offer.id}`,
    iconKind: kind,
    iconId: offer.id,
    nameKey: `${kind}.${offer.id}.name`,
    descKey: `${kind}.${offer.id}.desc`,
    cost: offer.cost,
    availability: offer.availability,
    requires: offer.requires,
    active,
    action,
  };
}

function paginate(entries: readonly PanelEntry[], submenu: boolean, pageIndex: number): PanelButton[] {
  const back = submenu ? actionEntry('back', { type: 'page', page: 'root' }) : null;
  const reserved = back ? 1 : 0;
  if (entries.length + reserved <= PANEL_SLOTS) {
    const buttons = entries.map((entry, slot) => ({ ...entry, slot }));
    if (back) {
      buttons.push({ ...back, slot: PANEL_SLOTS - 1 });
    }
    return buttons;
  }
  const capacity = PANEL_SLOTS - reserved - 1;
  const pages = Math.ceil(entries.length / capacity);
  const page = ((pageIndex % pages) + pages) % pages;
  const buttons = entries
    .slice(page * capacity, (page + 1) * capacity)
    .map((entry, slot) => ({ ...entry, slot }));
  buttons.push({ ...actionEntry('next', { type: 'nextPage' }), slot: capacity });
  if (back) {
    buttons.push({ ...back, slot: PANEL_SLOTS - 1 });
  }
  return buttons;
}

function hasClass(data: GameData, entity: EntityView, tag: UnitClass): boolean {
  return data.units[entity.type]?.class.includes(tag) ?? false;
}

function unitEntries(units: readonly EntityView[], data: GameData, state: PanelState): PanelEntry[] {
  const entries: PanelEntry[] = [];
  const any = (tag: UnitClass): boolean => units.some((unit) => hasClass(data, unit, tag));
  if (any('villager')) {
    entries.push(actionEntry('build', { type: 'page', page: 'build' }));
    entries.push(
      actionEntry('repair', { type: 'cursor', mode: 'repair' }, state.cursor === 'repair'),
    );
  }
  if (units.some((unit) => (data.units[unit.type]?.attack ?? 0) > 0)) {
    entries.push(
      actionEntry(
        'attack_move',
        { type: 'cursor', mode: 'attackMove' },
        state.cursor === 'attackMove',
      ),
    );
  }
  if (units.some((unit) => (data.units[unit.type]?.blastRadius ?? 0) > 0)) {
    entries.push(
      actionEntry(
        'attack_ground',
        { type: 'cursor', mode: 'attackGround' },
        state.cursor === 'attackGround',
      ),
    );
  }
  entries.push(actionEntry('stop', { type: 'stop' }));
  if (any('military')) {
    const holding = units.every((unit) => unit.own?.standGround === true);
    entries.push(actionEntry('stand_ground', { type: 'standGround', enabled: !holding }, holding));
  }
  if (units.some((unit) => hasClass(data, unit, 'transport_ship') && (unit.own?.cargo.length ?? 0) > 0)) {
    entries.push(
      actionEntry('unload', { type: 'cursor', mode: 'unload' }, state.cursor === 'unload'),
    );
  }
  if (any('trade_ship')) {
    for (const good of TRADE_GOODS) {
      entries.push(
        actionEntry(`trade_${good}`, { type: 'tradeGood', good }, state.tradeGood === good),
      );
    }
  }
  entries.push(actionEntry('delete', { type: 'delete' }));
  return entries;
}

function buildEntries(view: PlayerView, data: GameData, state: PanelState): PanelEntry[] {
  return buildableBuildings(view, data).map((offer) =>
    offerEntry('building', offer, { type: 'place', building: offer.id }, state.placing === offer.id),
  );
}

function buildingEntries(
  building: EntityView,
  view: PlayerView,
  data: GameData,
  state: PanelState,
): PanelEntry[] {
  const remove = actionEntry('delete', { type: 'delete' });
  if (!isCompleted(building)) {
    return [remove];
  }
  const units = trainableUnits(building.type, view, data).map((offer) =>
    offerEntry('unit', offer, { type: 'train', unit: offer.id }),
  );
  const techs = researchableTechs(building, view, data).map((offer) =>
    offerEntry('tech', offer, { type: 'research', technology: offer.id }),
  );
  const entries = [...units, ...techs];
  if (units.length > 0) {
    entries.push(actionEntry('rally', { type: 'cursor', mode: 'rally' }, state.cursor === 'rally'));
  }
  entries.push(remove);
  return entries;
}

export function buildPanel(
  selection: readonly EntityView[],
  view: PlayerView,
  data: GameData,
  state: PanelState,
): PanelButton[] {
  if (selection.length === 0 || selection.some((entity) => entity.owner !== view.playerId)) {
    return [];
  }
  const units = selection.filter((entity) => entity.kind === 'unit');
  if (units.length > 0) {
    const canBuild = units.some((unit) => hasClass(data, unit, 'villager'));
    if (state.page === 'build' && canBuild) {
      return paginate(buildEntries(view, data, state), true, state.pageIndex);
    }
    return paginate(unitEntries(units, data, state), false, state.pageIndex);
  }
  const building = selection.find((entity) => entity.kind === 'building');
  if (!building) {
    return [];
  }
  return paginate(buildingEntries(building, view, data, state), false, state.pageIndex);
}
