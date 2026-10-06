import { describe, expect, it } from 'vitest';
import { loadGameData } from '../../src/data';
import {
  buildingRows,
  civilizationRows,
  noteName,
  noteNumbers,
  technologyRows,
  unitAges,
  unitRows,
} from './support/spec';

const data = loadGameData();

describe('criterion 3: Appendix A buildings', () => {
  const rows = buildingRows();

  it('lists exactly the buildings of the game', () => {
    expect(rows).toHaveLength(22);
    expect(rows.map((row) => row.id).sort()).toEqual(Object.keys(data.buildings).sort());
  });

  it.each(rows.map((row) => [row.id, row] as const))('%s has the appendix values', (id, row) => {
    const building = data.buildings[id];
    expect({
      age: building.age,
      cost: building.cost,
      buildTime: building.buildTime,
      hp: building.hp,
    }).toEqual({ age: row.age, cost: row.cost, buildTime: row.buildTime, hp: row.hp });
    const [attack, attackInterval, range] = noteNumbers(row.note);
    if (attack !== undefined) {
      expect({
        attack: building.attack,
        attackInterval: building.attackInterval,
        range: building.range,
      }).toEqual({ attack, attackInterval, range });
    }
    const required = noteName(row.note);
    if (required === null) {
      return;
    }
    if (!required.leading) {
      expect(building.requires.technologies).toContain(required.id);
      expect(data.technologies[required.id]).toBeDefined();
    } else if (required.exact) {
      expect(building.requires.buildings).toContain(required.id);
    } else {
      expect(building.requiresWhenOwned).toContain(required.id);
    }
  });
});

describe('criterion 3: Appendix B units', () => {
  const rows = unitRows();
  const ages = unitAges();

  it('lists exactly the trainable units of the game', () => {
    expect(rows).toHaveLength(40);
    const trainable = Object.values(data.units)
      .filter((unit) => unit.animal === undefined)
      .map((unit) => unit.id);
    expect(rows.map((row) => row.id).sort()).toEqual(trainable.sort());
  });

  it.each(rows.map((row) => [row.id, row] as const))('%s has the appendix values', (id, row) => {
    const unit = data.units[id];
    expect({
      building: unit.building,
      cost: unit.cost,
      trainTime: unit.trainTime,
      hp: unit.hp,
      attack: unit.attack,
      attackInterval: unit.attackInterval,
      armor: unit.armor,
      pierceArmor: unit.pierceArmor,
      range: unit.range,
      speed: unit.speed,
      age: unit.age,
    }).toEqual({
      building: row.building,
      cost: row.cost,
      trainTime: row.trainTime,
      hp: row.hp,
      attack: row.attack,
      attackInterval: row.attackInterval,
      armor: row.armor,
      pierceArmor: row.pierceArmor,
      range: row.range,
      speed: row.speed,
      age: ages[id] ?? 'iron',
    });
  });

  it('reads the age note for every listed unit', () => {
    expect(Object.keys(ages).length).toBe(22);
    for (const id of Object.keys(ages)) {
      expect(data.units[id], id).toBeDefined();
    }
  });
});

describe('criterion 3: Appendix C technologies', () => {
  const rows = technologyRows();

  it('lists exactly the technologies of the game', () => {
    expect(rows).toHaveLength(71);
    expect(rows.map((row) => row.id).sort()).toEqual(Object.keys(data.technologies).sort());
  });

  it.each(rows.map((row) => [row.id, row] as const))('%s has the appendix values', (id, row) => {
    const technology = data.technologies[id];
    expect({
      building: technology.building,
      age: technology.age,
      cost: technology.cost,
      researchTime: technology.researchTime,
    }).toEqual({
      building: row.building,
      age: row.age,
      cost: row.cost,
      researchTime: row.researchTime,
    });
    const disabledFor = Object.values(data.civilizations)
      .filter((civilization) => civilization.disabledTechs.includes(id))
      .map((civilization) => civilization.id)
      .sort();
    expect(disabledFor).toEqual([...row.unavailable].sort());
  });
});

describe('criterion 3: Appendix D civilizations', () => {
  it('lists exactly the civilizations of the game', () => {
    const rows = civilizationRows();
    expect(rows).toHaveLength(12);
    expect(rows.map((row) => row.id).sort()).toEqual(Object.keys(data.civilizations).sort());
  });
});
