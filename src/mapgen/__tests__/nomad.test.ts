import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../data';
import type { EntitySpec, PlayerSetup, Settings } from '../../sim/types';
import { GAIA_PLAYER_ID } from '../../sim/types';
import { generateMap } from '../index';

const data = loadGameData();

const settings: Settings = {
  mapType: 'inland',
  mapSize: 'tiny',
  victoryMode: 'standard',
  populationLimit: 50,
  startingAge: 'stone',
  revealMap: false,
  lockTeams: false,
  speed: 'normal',
};

const players: PlayerSetup[] = [0, 1, 2].map((id) => ({
  id,
  kind: 'ai' as const,
  civilization: 'greek',
  team: null,
  color: 0xffffff,
  difficulty: 'moderate' as const,
}));

function gaia(entities: readonly EntitySpec[]): EntitySpec[] {
  return entities.filter((spec) => spec.owner === GAIA_PLAYER_ID);
}

describe('nomad start generation', () => {
  const start = data.game.start;
  const unitCount = data.game.nomadStart?.unitCount ?? start.unitCount;

  it('places villagers without a start building', () => {
    for (const mapType of ['inland', 'small_islands', 'highland'] as const) {
      const map = generateMap({ ...settings, mapType, startMode: 'nomad' }, players, 11, data);
      for (const player of players) {
        const owned = map.entities.filter((spec) => spec.owner === player.id);
        expect(owned.filter((spec) => spec.kind === 'building')).toHaveLength(0);
        expect(owned.filter((spec) => spec.type === start.unit)).toHaveLength(unitCount);
        expect(owned).toHaveLength(unitCount);
        expect(map.startPositions[player.id]).toBeDefined();
      }
    }
  });

  it('keeps terrain and map objects of the standard start', () => {
    const standard = generateMap(settings, players, 11, data);
    const nomad = generateMap({ ...settings, startMode: 'nomad' }, players, 11, data);
    expect(nomad.map.terrain).toEqual(standard.map.terrain);
    expect(nomad.map.elevation).toEqual(standard.map.elevation);
    expect(nomad.startPositions).toEqual(standard.startPositions);
    expect(gaia(nomad.entities)).toEqual(gaia(standard.entities));
  });

  it('leaves the start site free for a town center', () => {
    const map = generateMap({ ...settings, startMode: 'nomad' }, players, 11, data);
    const half = data.buildings[start.building].size / 2;
    for (const player of players) {
      const center = map.startPositions[player.id];
      const inside = map.entities.filter(
        (spec) =>
          Math.abs(spec.position.x - center.x) < half && Math.abs(spec.position.y - center.y) < half,
      );
      expect(inside).toHaveLength(0);
    }
  });

  it('does not change generation when the option is absent or standard', () => {
    const absent = generateMap(settings, players, 5, data);
    const standard = generateMap({ ...settings, startMode: 'standard' }, players, 5, data);
    expect(standard).toEqual(absent);
  });
});
