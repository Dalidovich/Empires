import { describe, expect, it } from 'vitest';
import { RAW_GAME_DATA, loadGameData } from '../index';
import {
  buildingClassSchema,
  buildingsFileSchema,
  civilizationsFileSchema,
  gameRulesSchema,
  resourcesSchema,
  technologiesFileSchema,
  unitClassSchema,
  unitsFileSchema,
} from '../schema';
import { AGE_ORDER } from '../types';
import type { Effect, EffectTarget, GameData } from '../types';

const data: GameData = loadGameData();

const unitIds = new Set(Object.keys(data.units));
const buildingIds = new Set(Object.keys(data.buildings));
const techIds = new Set(Object.keys(data.technologies));
const usedUnitClasses = new Set(Object.values(data.units).flatMap((unit) => unit.class));
const usedBuildingClasses = new Set(
  Object.values(data.buildings).flatMap((building) => building.class),
);

function targetProblems(target: EffectTarget): string[] {
  const problems: string[] = [];
  const selectors =
    (target.units?.length ?? 0) +
    (target.unitClasses?.length ?? 0) +
    (target.buildings?.length ?? 0) +
    (target.buildingClasses?.length ?? 0);
  if (selectors === 0) problems.push('empty target');
  for (const id of target.units ?? []) {
    if (!unitIds.has(id)) problems.push(`unknown unit ${id}`);
  }
  for (const id of target.buildings ?? []) {
    if (!buildingIds.has(id)) problems.push(`unknown building ${id}`);
  }
  for (const unitClass of target.unitClasses ?? []) {
    if (!usedUnitClasses.has(unitClass)) problems.push(`unused unit class ${unitClass}`);
  }
  for (const buildingClass of target.buildingClasses ?? []) {
    if (!usedBuildingClasses.has(buildingClass)) {
      problems.push(`unused building class ${buildingClass}`);
    }
  }
  return problems;
}

function effectProblems(effect: Effect): string[] {
  const problems: string[] = [];
  if (effect.condition?.hasTech !== undefined && !techIds.has(effect.condition.hasTech)) {
    problems.push(`unknown condition technology ${effect.condition.hasTech}`);
  }
  if (effect.condition?.lacksTech !== undefined && !techIds.has(effect.condition.lacksTech)) {
    problems.push(`unknown condition technology ${effect.condition.lacksTech}`);
  }
  switch (effect.type) {
    case 'modify_stat':
    case 'modify_cost':
      problems.push(...targetProblems(effect.target));
      break;
    case 'modify_attack_bonus':
      problems.push(...targetProblems(effect.target));
      if (!usedUnitClasses.has(effect.targetClass)) {
        problems.push(`unused unit class ${effect.targetClass}`);
      }
      break;
    case 'enable_unit':
      if (!unitIds.has(effect.unit)) problems.push(`unknown unit ${effect.unit}`);
      break;
    case 'enable_building':
      if (!buildingIds.has(effect.building)) problems.push(`unknown building ${effect.building}`);
      break;
    case 'upgrade_unit':
      if (!unitIds.has(effect.from)) problems.push(`unknown unit ${effect.from}`);
      if (!unitIds.has(effect.to)) problems.push(`unknown unit ${effect.to}`);
      if (data.units[effect.from]?.upgradesTo !== effect.to) {
        problems.push(`${effect.from} does not upgrade to ${effect.to}`);
      }
      break;
    case 'upgrade_building':
      if (!buildingIds.has(effect.from)) problems.push(`unknown building ${effect.from}`);
      if (!buildingIds.has(effect.to)) problems.push(`unknown building ${effect.to}`);
      if (data.buildings[effect.from]?.upgradesTo !== effect.to) {
        problems.push(`${effect.from} does not upgrade to ${effect.to}`);
      }
      break;
    default:
      break;
  }
  return problems;
}

function collect<T extends { id: string }>(
  records: Readonly<Record<string, T>>,
  check: (record: T) => string[],
): string[] {
  return Object.values(records).flatMap((record) =>
    check(record).map((problem) => `${record.id}: ${problem}`),
  );
}

describe('data file schemas', () => {
  it.each([
    ['units.json', unitsFileSchema, RAW_GAME_DATA.units],
    ['buildings.json', buildingsFileSchema, RAW_GAME_DATA.buildings],
    ['technologies.json', technologiesFileSchema, RAW_GAME_DATA.technologies],
    ['civilizations.json', civilizationsFileSchema, RAW_GAME_DATA.civilizations],
    ['resources.json', resourcesSchema, RAW_GAME_DATA.resources],
    ['game.json', gameRulesSchema, RAW_GAME_DATA.game],
  ] as const)('%s matches its schema', (_file, schema, raw) => {
    const result = schema.safeParse(raw);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it('uses only declared class tags', () => {
    expect([...usedUnitClasses].filter((tag) => !unitClassSchema.safeParse(tag).success)).toEqual(
      [],
    );
    expect(
      [...usedBuildingClasses].filter((tag) => !buildingClassSchema.safeParse(tag).success),
    ).toEqual([]);
  });
});

describe('referential integrity', () => {
  it('resolves unit references', () => {
    const problems = collect(data.units, (unit) => {
      const found: string[] = [];
      if (unit.building !== null && !buildingIds.has(unit.building)) {
        found.push(`unknown building ${unit.building}`);
      }
      if (unit.upgradesTo !== null) {
        const next = data.units[unit.upgradesTo];
        if (!next) {
          found.push(`unknown upgradesTo ${unit.upgradesTo}`);
        } else {
          if (next.building !== unit.building) found.push('upgrade changes building');
          if (AGE_ORDER.indexOf(next.age) < AGE_ORDER.indexOf(unit.age)) {
            found.push('upgrade belongs to an earlier age');
          }
        }
      }
      if (unit.requiresTech != null && !techIds.has(unit.requiresTech)) {
        found.push(`unknown requiresTech ${unit.requiresTech}`);
      }
      for (const bonus of unit.bonuses) {
        if (!usedUnitClasses.has(bonus.targetClass)) {
          found.push(`bonus against unused class ${bonus.targetClass}`);
        }
      }
      if (unit.animal) {
        if (!data.resourceSources[unit.animal.carcass]) {
          found.push(`unknown carcass ${unit.animal.carcass}`);
        } else if (data.resourceSources[unit.animal.carcass].amount !== unit.animal.food) {
          found.push('carcass amount differs from animal food');
        }
      }
      return found;
    });
    expect(problems).toEqual([]);
  });

  it('gives every trainable unit that needs a technology a way to obtain it', () => {
    const granted = new Set<string>();
    for (const tech of Object.values(data.technologies)) {
      for (const effect of tech.effects) {
        if (effect.type === 'enable_unit') granted.add(`${tech.id}>${effect.unit}`);
        if (effect.type === 'upgrade_unit') granted.add(`${tech.id}>${effect.to}`);
      }
    }
    const missing = Object.values(data.units)
      .filter((unit) => unit.requiresTech != null)
      .filter((unit) => !granted.has(`${unit.requiresTech}>${unit.id}`))
      .map((unit) => unit.id);
    expect(missing).toEqual([]);
  });

  it('resolves building references', () => {
    const problems = collect(data.buildings, (building) => {
      const found: string[] = [];
      for (const id of building.requires.buildings) {
        if (!buildingIds.has(id)) found.push(`unknown required building ${id}`);
      }
      for (const id of building.requires.technologies) {
        if (!techIds.has(id)) found.push(`unknown required technology ${id}`);
      }
      for (const id of building.requiresWhenOwned ?? []) {
        if (!buildingIds.has(id)) found.push(`unknown requiresWhenOwned ${id}`);
      }
      if (building.upgradesTo !== null && !buildingIds.has(building.upgradesTo)) {
        found.push(`unknown upgradesTo ${building.upgradesTo}`);
      }
      return found;
    });
    expect(problems).toEqual([]);
  });

  it('resolves technology references', () => {
    const problems = collect(data.technologies, (tech) => {
      const found: string[] = [];
      if (!buildingIds.has(tech.building)) found.push(`unknown building ${tech.building}`);
      for (const id of tech.requires) {
        const required = data.technologies[id];
        if (!required) {
          found.push(`unknown prerequisite ${id}`);
        } else if (AGE_ORDER.indexOf(required.age) > AGE_ORDER.indexOf(tech.age)) {
          found.push(`prerequisite ${id} belongs to a later age`);
        }
      }
      if (tech.requires.includes(tech.id)) found.push('requires itself');
      return [...found, ...tech.effects.flatMap(effectProblems)];
    });
    expect(problems).toEqual([]);
  });

  it('has no prerequisite cycles', () => {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const cycles: string[] = [];
    const visit = (id: string): void => {
      if (done.has(id)) return;
      if (visiting.has(id)) {
        cycles.push(id);
        return;
      }
      visiting.add(id);
      for (const required of data.technologies[id]?.requires ?? []) visit(required);
      visiting.delete(id);
      done.add(id);
    };
    for (const id of techIds) visit(id);
    expect(cycles).toEqual([]);
  });

  it('resolves civilization references', () => {
    const problems = collect(data.civilizations, (civ) => {
      const found: string[] = [];
      for (const id of civ.disabledTechs) {
        if (!techIds.has(id)) found.push(`unknown disabled technology ${id}`);
      }
      for (const id of civ.disabledUnits) {
        if (!unitIds.has(id)) found.push(`unknown disabled unit ${id}`);
      }
      if (new Set(civ.disabledTechs).size !== civ.disabledTechs.length) {
        found.push('duplicate disabled technology');
      }
      if (new Set(civ.disabledUnits).size !== civ.disabledUnits.length) {
        found.push('duplicate disabled unit');
      }
      return [...found, ...civ.bonuses.flatMap(effectProblems)];
    });
    expect(problems).toEqual([]);
  });

  it('resolves game rule references', () => {
    const { game } = data;
    expect(buildingIds.has(game.start.building)).toBe(true);
    expect(unitIds.has(game.start.unit)).toBe(true);
    expect(game.ages.map((age) => age.id)).toEqual([...AGE_ORDER]);
    for (const [index, age] of game.ages.entries()) {
      if (age.technology !== null) {
        expect(data.technologies[age.technology].effects).toContainEqual({
          type: 'advance_age',
          age: age.id,
        });
      }
      for (const id of age.qualifyingBuildings) {
        expect(data.buildings[id]?.age).toBe(AGE_ORDER[index - 1]);
      }
      expect(age.qualifyingBuildings.length).toBeGreaterThanOrEqual(age.requiredBuildingCount);
    }
  });

  it('covers every gather kind with a drop-off building', () => {
    const covered = new Set(Object.values(data.buildings).flatMap((building) => building.dropOff));
    expect(Object.keys(data.resources.gatherRates).filter((kind) => !covered.has(kind as never))).toEqual(
      [],
    );
    for (const source of data.resources.sources) {
      expect(covered.has(source.gatherKind)).toBe(true);
    }
  });

  it('keeps record sources valid and names out of data', () => {
    const records = [
      ...Object.values(data.units),
      ...Object.values(data.buildings),
      ...Object.values(data.technologies),
      ...Object.values(data.civilizations),
      ...data.resources.sources,
      ...data.resources.objects,
    ];
    for (const record of records) {
      expect(['1.0', 'DE']).toContain(record.source);
      expect(record).not.toHaveProperty('name');
    }
  });
});
