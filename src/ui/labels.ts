import type { ResourceKind } from '../data/types';
import type { EntityView, PlayerPublicView } from '../sim/snapshot';
import type { PlayerId } from '../sim/types';
import { GAIA_PLAYER_ID } from '../sim/types';
import type { StorageErrorCode } from '../storage/api';
import type { DisabledReason, Requirement } from './game/availability';
import type { GuideRef } from './game/guide';
import { hasTranslation, t } from './i18n';

export function entityName(entity: Pick<EntityView, 'kind' | 'type'>): string {
  switch (entity.kind) {
    case 'unit':
      return t(`unit.${entity.type}.name`);
    case 'building':
      return t(`building.${entity.type}.name`);
    case 'resource':
      return t(`resource.${entity.type}`);
    default:
      return t(`ui.object.${entity.type}`);
  }
}

function entityDescriptionKey(entity: Pick<EntityView, 'kind' | 'type'>): string {
  switch (entity.kind) {
    case 'unit':
      return `unit.${entity.type}.desc`;
    case 'building':
      return `building.${entity.type}.desc`;
    case 'resource':
      return `resource.${entity.type}.desc`;
    default:
      return `ui.object.${entity.type}.desc`;
  }
}

export function entityDescription(entity: Pick<EntityView, 'kind' | 'type'>): string | null {
  const key = entityDescriptionKey(entity);
  return hasTranslation(key) ? t(key) : null;
}

export function civilizationName(id: string): string {
  return t(`civ.${id}.name`);
}

export function guideRefName(ref: GuideRef): string {
  return t(`${ref.kind === 'technology' ? 'tech' : ref.kind}.${ref.id}.name`);
}

export function playerName(
  players: readonly PlayerPublicView[],
  id: PlayerId,
  viewerId: PlayerId,
): string {
  if (id === GAIA_PLAYER_ID) {
    return t('ui.player.gaia');
  }
  const player = players.find((candidate) => candidate.id === id);
  const civilization = player ? civilizationName(player.civilization) : '';
  if (id === viewerId) {
    return t('ui.player.you', { civ: civilization });
  }
  return t('ui.player.name', { n: id + 1, civ: civilization });
}

export function reasonText(reason: DisabledReason, resource: ResourceKind | null): string {
  if (reason === 'resources' && resource !== null) {
    return t('ui.reason.resource', { resource: t(`resource.${resource}`) });
  }
  return t(`ui.reason.${reason}`);
}

const LIST_SEPARATOR = ', ';

function requirementText(requirement: Requirement): string {
  switch (requirement.kind) {
    case 'age':
      return t(`age.${requirement.age}`);
    case 'building':
      return t(`building.${requirement.id}.name`);
    case 'technology':
      return t(`tech.${requirement.id}.name`);
    default:
      return t('ui.requirement.age_buildings', {
        count: requirement.count,
        buildings: requirement.buildings.map((id) => t(`building.${id}.name`)).join(LIST_SEPARATOR),
      });
  }
}

export function requirementsText(requirements: readonly Requirement[]): string {
  return t('ui.tooltip.requires', {
    list: requirements.map(requirementText).join(LIST_SEPARATOR),
  });
}

export function storageErrorText(code: StorageErrorCode): string {
  return t(`ui.storage.error.${code}`);
}
