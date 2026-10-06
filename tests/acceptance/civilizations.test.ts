import { describe, expect, it } from 'vitest';
import type { Command } from '../../src/sim/commands';
import type { OwnedBuildings } from '../../src/sim/effects/availability';
import {
  buildingBlockReason,
  technologyBlockReason,
  unitBlockReason,
} from '../../src/sim/effects/availability';
import { createGame, step } from '../../src/sim/engine';
import type { SimEventOf } from '../../src/sim/events';
import {
  getBuildingStats,
  getCarryCapacity,
  getConversionParams,
  getFarmFood,
  getGatherRate,
  getUnitStats,
} from '../../src/sim/stats';
import type { GameState, Player } from '../../src/sim/types';
import {
  addBuilding,
  baseSettings,
  context,
  data,
  emptyState,
} from '../../src/sim/__tests__/fixtures';
import { technologyRows } from './support/spec';

const CIVILIZATIONS = Object.keys(data.civilizations).sort();
const AGE_TECHNOLOGIES = data.game.ages.flatMap((age) => (age.technology ? [age.technology] : []));
const TRAINABLE_UNITS = Object.values(data.units)
  .filter((unit) => unit.building !== null && unit.animal === undefined)
  .map((unit) => unit.id);
const SPEC_TECHNOLOGIES = technologyRows();

function everythingOwned(): OwnedBuildings {
  const complete: Record<string, number> = {};
  for (const id of Object.keys(data.buildings)) {
    complete[id] = 1;
  }
  return { complete, total: {}, researching: [] };
}

interface Tree {
  technologies: string[];
  everTrainable: string[];
  finalRoster: string[];
  buildings: string[];
}

function trainableNow(player: Player): string[] {
  return TRAINABLE_UNITS.filter((id) => unitBlockReason(player, id, data) === null);
}

function buildableNow(player: Player, owned: OwnedBuildings): string[] {
  return Object.keys(data.buildings).filter(
    (id) => buildingBlockReason(player, id, owned, data) === null,
  );
}

function explore(civilization: string): Tree {
  const state = emptyState(16);
  const player = state.players[0];
  player.civilization = civilization;
  player.age = 'iron';
  const owned = everythingOwned();
  const ever = new Set(trainableNow(player));
  const buildings = new Set(buildableNow(player, owned));
  let progress = true;
  while (progress) {
    progress = false;
    for (const id of Object.keys(data.technologies)) {
      if (player.researched.includes(id) || technologyBlockReason(player, id, owned, data) !== null) {
        continue;
      }
      player.researched = [...player.researched, id];
      progress = true;
      trainableNow(player).forEach((unit) => ever.add(unit));
      buildableNow(player, owned).forEach((building) => buildings.add(building));
    }
  }
  return {
    technologies: [...player.researched].sort(),
    everTrainable: [...ever].sort(),
    finalRoster: trainableNow(player).sort(),
    buildings: [...buildings].sort(),
  };
}

function allowedBySpec(civilization: string): Set<string> {
  return new Set(
    SPEC_TECHNOLOGIES.filter((row) => !row.unavailable.includes(civilization)).map((row) => row.id),
  );
}

function isReachable(id: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(id) && data.technologies[id].requires.every((required) => isReachable(required, allowed));
}

function expectedTechnologies(civilization: string): string[] {
  const allowed = allowedBySpec(civilization);
  return [...allowed]
    .filter((id) => !AGE_TECHNOLOGIES.includes(id) && isReachable(id, allowed))
    .sort();
}

function blockedByPrerequisite(civilization: string): string[] {
  const allowed = allowedBySpec(civilization);
  return [...allowed].filter((id) => !isReachable(id, allowed)).sort();
}

function expectedUnits(civilization: string): string[] {
  const technologies = new Set([...expectedTechnologies(civilization), ...AGE_TECHNOLOGIES]);
  const disabled = data.civilizations[civilization].disabledUnits;
  return TRAINABLE_UNITS.filter((id) => {
    const required = data.units[id].requiresTech ?? null;
    return !disabled.includes(id) && (required === null || technologies.has(required));
  }).sort();
}

describe('criterion 2: technology trees', () => {
  const trees = new Map(CIVILIZATIONS.map((id) => [id, explore(id)]));

  it('covers the twelve civilizations', () => {
    expect(CIVILIZATIONS).toHaveLength(12);
  });

  it.each(CIVILIZATIONS)('%s researches exactly the technologies of its tree', (civilization) => {
    expect(trees.get(civilization)?.technologies).toEqual(expectedTechnologies(civilization));
  });

  it('finds one appendix technology that is allowed but lacks an allowed prerequisite', () => {
    const blocked = CIVILIZATIONS.flatMap((civilization) =>
      blockedByPrerequisite(civilization).map((id) => `${civilization}:${id}`),
    );
    expect(blocked).toEqual(['shang:ballista_tower']);
    expect(data.technologies.ballista_tower.requires).toContain('ballistics');
    expect(data.civilizations.shang.disabledTechs).toContain('ballistics');
  });

  it.each(CIVILIZATIONS)('%s trains exactly the units of its tree', (civilization) => {
    const tree = trees.get(civilization);
    expect(tree?.everTrainable).toEqual(expectedUnits(civilization));
    for (const id of tree?.finalRoster ?? []) {
      const next = data.units[id].upgradesTo;
      expect(next !== null && tree?.everTrainable.includes(next), `${id} is replaced by ${next}`).toBe(false);
    }
  });

  it('makes every unit, building and technology obtainable by some civilization', () => {
    const units = new Set<string>();
    const technologies = new Set<string>(AGE_TECHNOLOGIES);
    const buildings = new Set<string>();
    for (const tree of trees.values()) {
      tree.everTrainable.forEach((id) => units.add(id));
      tree.technologies.forEach((id) => technologies.add(id));
      tree.buildings.forEach((id) => buildings.add(id));
    }
    expect([...units].sort()).toEqual([...TRAINABLE_UNITS].sort());
    expect([...technologies].sort()).toEqual(Object.keys(data.technologies).sort());
    expect([...buildings].sort()).toEqual(Object.keys(data.buildings).sort());
  });
});

function arsenal(civilization: string): { state: GameState; buildingOf: Map<string, number> } {
  const state = emptyState(64);
  const player = state.players[0];
  player.civilization = civilization;
  player.age = 'iron';
  player.resources = { food: 100000, wood: 100000, stone: 100000, gold: 100000 };
  const buildingOf = new Map<string, number>();
  const producers = new Set<string>();
  for (const unit of Object.values(data.units)) {
    if (unit.building !== null) {
      producers.add(unit.building);
    }
  }
  for (const technology of Object.values(data.technologies)) {
    producers.add(technology.building);
  }
  [...producers].sort().forEach((type, index) => {
    const building = addBuilding(state, type, 0, 4 + (index % 5) * 10, 4 + Math.floor(index / 5) * 10);
    buildingOf.set(type, building.id);
  });
  for (let index = 0; index < 12; index++) {
    addBuilding(state, 'house', 0, 54, 2 + index * 3);
  }
  return { state, buildingOf };
}

function rejection(state: GameState, command: Command): string | null {
  const events = step(state, [command], context());
  const rejected = events.find(
    (event): event is SimEventOf<'commandRejected'> => event.type === 'commandRejected',
  );
  return rejected ? rejected.reason : null;
}

describe('criterion 2: commands respect the tree', () => {
  it.each(CIVILIZATIONS)('%s cannot research or train what its tree lacks', (civilization) => {
    const { state, buildingOf } = arsenal(civilization);
    step(state, [], context());
    const def = data.civilizations[civilization];
    for (const technology of def.disabledTechs) {
      const buildingId = buildingOf.get(data.technologies[technology].building) ?? 0;
      expect(
        rejection(state, { type: 'research', playerId: 0, buildingId, technology }),
        technology,
      ).toBe('unavailable');
    }
    for (const unit of def.disabledUnits) {
      const buildingId = buildingOf.get(data.units[unit].building ?? '') ?? 0;
      expect(
        rejection(state, { type: 'train', playerId: 0, buildingId, unit, count: 1 }),
        unit,
      ).toBe('unavailable');
    }
    expect(state.players[0].resources).toEqual({ food: 100000, wood: 100000, stone: 100000, gold: 100000 });
  });

  it.each(CIVILIZATIONS)('%s can queue a unit and start a technology of its tree', (civilization) => {
    const { state, buildingOf } = arsenal(civilization);
    step(state, [], context());
    const barracks = buildingOf.get('barracks') ?? 0;
    const pit = buildingOf.get('storage_pit') ?? 0;
    expect(rejection(state, { type: 'train', playerId: 0, buildingId: barracks, unit: 'clubman', count: 1 })).toBeNull();
    expect(
      rejection(state, { type: 'research', playerId: 0, buildingId: pit, technology: 'toolworking' }),
    ).toBeNull();
    expect(state.entities[barracks].queue).toHaveLength(1);
    expect(state.entities[pit].research?.technology).toBe('toolworking');
  });
});

interface Probe {
  state: GameState;
  unit(id: string): ReturnType<typeof getUnitStats>;
  building(id: string): ReturnType<typeof getBuildingStats>;
}

function probe(civilization: string): Probe {
  const state = emptyState(16);
  state.players[0].civilization = civilization;
  return {
    state,
    unit: (id) => getUnitStats(state, 0, id, data),
    building: (id) => getBuildingStats(state, 0, id, data),
  };
}

function scaled(actual: number, base: number, factor: number): void {
  expect(Math.abs(actual - base * factor)).toBeLessThanOrEqual(0.5);
}

const base = data.units;
const rates = data.resources.gatherRates;

const BONUS_CHECKS: Record<string, (civilization: Probe) => void> = {
  assyrian: (civ) => {
    for (const id of ['bowman', 'improved_bowman', 'composite_bowman', 'chariot_archer', 'horse_archer', 'heavy_horse_archer']) {
      expect(civ.unit(id).attackInterval).toBeCloseTo(base[id].attackInterval * 0.75, 3);
    }
    expect(civ.unit('villager').speed).toBeCloseTo((base.villager.speed * 4) / 3, 3);
  },
  babylonian: (civ) => {
    for (const id of ['small_wall', 'medium_wall', 'fortification', 'watch_tower', 'guard_tower']) {
      expect(civ.building(id).hp).toBe(data.buildings[id].hp * 2);
    }
    const conversion = data.game.conversion;
    expect(getConversionParams(civ.state, 0, data).faithRechargeTime).toBeCloseTo(
      conversion.faithMax / conversion.faithRechargeRate - 12,
      6,
    );
    expect(getGatherRate(civ.state, 0, 'stone', data)).toBeCloseTo(rates.stone * 1.3, 6);
  },
  choson: (civ) => {
    expect(civ.unit('long_swordsman').hp).toBe(base.long_swordsman.hp + 80);
    expect(civ.unit('legion').hp).toBe(base.legion.hp + 80);
    for (const id of ['watch_tower', 'sentry_tower', 'guard_tower', 'ballista_tower']) {
      expect(civ.building(id).range).toBe(data.buildings[id].range + 2);
    }
    scaled(civ.unit('priest').cost.gold ?? 0, base.priest.cost.gold ?? 0, 2 / 3);
  },
  egyptian: (civ) => {
    expect(civ.unit('priest').range).toBe(base.priest.range + 3);
    expect(getGatherRate(civ.state, 0, 'gold', data)).toBeCloseTo(rates.gold * 1.2, 6);
    scaled(civ.unit('chariot').hp, base.chariot.hp, 4 / 3);
    scaled(civ.unit('chariot_archer').hp, base.chariot_archer.hp, 4 / 3);
  },
  greek: (civ) => {
    for (const id of ['hoplite', 'phalanx', 'centurion', 'scout_ship', 'war_galley', 'trireme', 'catapult_trireme', 'juggernaut']) {
      expect(civ.unit(id).speed).toBeCloseTo(base[id].speed * 1.3, 6);
    }
    expect(civ.unit('light_transport').speed).toBe(base.light_transport.speed);
  },
  hittite: (civ) => {
    for (const id of ['stone_thrower', 'catapult', 'heavy_catapult']) {
      expect(civ.unit(id).hp).toBe(base[id].hp * 2);
    }
    for (const id of ['bowman', 'composite_bowman', 'chariot_archer', 'horse_archer', 'elephant_archer']) {
      expect(civ.unit(id).attack).toBe(base[id].attack + 1);
    }
    for (const id of ['scout_ship', 'war_galley', 'trireme', 'catapult_trireme', 'juggernaut']) {
      expect(civ.unit(id).range).toBe(base[id].range + 4);
    }
  },
  minoan: (civ) => {
    for (const id of ['fishing_boat', 'trade_boat', 'light_transport', 'scout_ship', 'trireme', 'juggernaut']) {
      scaled(civ.unit(id).cost.wood ?? 0, base[id].cost.wood ?? 0, 2 / 3);
    }
    expect(civ.unit('composite_bowman').range).toBe(base.composite_bowman.range + 2);
    scaled(getFarmFood(civ.state, 0, data), data.resources.farmFood, 1.25);
  },
  persian: (civ) => {
    expect(getGatherRate(civ.state, 0, 'hunt', data)).toBeCloseTo(rates.hunt * 1.3, 6);
    scaled(getFarmFood(civ.state, 0, data), data.resources.farmFood, 0.7);
    expect(civ.unit('war_elephant').speed).toBeCloseTo(base.war_elephant.speed * 1.5, 6);
    expect(civ.unit('elephant_archer').speed).toBeCloseTo(base.elephant_archer.speed * 1.5, 6);
    expect(civ.unit('trireme').attackInterval).toBeCloseTo(base.trireme.attackInterval / 1.5, 3);
  },
  phoenician: (civ) => {
    for (const id of ['war_elephant', 'elephant_archer']) {
      scaled(civ.unit(id).cost.food ?? 0, base[id].cost.food ?? 0, 0.75);
      scaled(civ.unit(id).cost.gold ?? 0, base[id].cost.gold ?? 0, 0.75);
    }
    for (const id of ['catapult_trireme', 'juggernaut']) {
      expect(civ.unit(id).attackInterval).toBeCloseTo(base[id].attackInterval * 0.6, 6);
    }
    expect(getCarryCapacity(civ.state, 0, 'wood', data)).toBe(data.resources.carryCapacity.wood + 2);
  },
  shang: (civ) => {
    scaled(civ.unit('villager').cost.food ?? 0, base.villager.cost.food ?? 0, 0.7);
    for (const id of ['small_wall', 'medium_wall', 'fortification']) {
      expect(civ.building(id).hp).toBe(data.buildings[id].hp * 2);
    }
    expect(civ.building('watch_tower').hp).toBe(data.buildings.watch_tower.hp);
  },
  sumerian: (civ) => {
    expect(civ.unit('villager').hp).toBe(base.villager.hp + 15);
    for (const id of ['stone_thrower', 'catapult', 'heavy_catapult']) {
      expect(civ.unit(id).attackInterval).toBeCloseTo(base[id].attackInterval / 1.5, 3);
    }
    expect(getFarmFood(civ.state, 0, data)).toBe(data.resources.farmFood * 2);
  },
  yamato: (civ) => {
    for (const id of ['horse_archer', 'heavy_horse_archer', 'scout', 'cavalry', 'heavy_cavalry', 'cataphract']) {
      scaled(civ.unit(id).cost.food ?? 0, base[id].cost.food ?? 0, 0.75);
      scaled(civ.unit(id).cost.gold ?? 0, base[id].cost.gold ?? 0, 0.75);
    }
    expect(civ.unit('villager').speed).toBeCloseTo((base.villager.speed * 4) / 3, 3);
    for (const id of ['fishing_boat', 'light_transport', 'scout_ship', 'trireme']) {
      scaled(civ.unit(id).hp, base[id].hp, 4 / 3);
    }
  },
};

describe('criterion 2: civilization bonuses', () => {
  it('has a check for every civilization', () => {
    expect(Object.keys(BONUS_CHECKS).sort()).toEqual(CIVILIZATIONS);
  });

  it.each(CIVILIZATIONS)('%s bonuses change the effective stats', (civilization) => {
    BONUS_CHECKS[civilization](probe(civilization));
  });

  it('leave the other civilizations at the appendix values', () => {
    const greek = probe('greek');
    expect(greek.unit('villager')).toEqual(base.villager);
    expect(greek.unit('bowman')).toEqual(base.bowman);
    expect(greek.building('small_wall').hp).toBe(data.buildings.small_wall.hp);
    expect(getFarmFood(greek.state, 0, data)).toBe(data.resources.farmFood);
  });

  it('apply to a started game: starting units, trained units and costs', () => {
    const state = createGame(
      { ...baseSettings, populationLimit: 50 },
      [
        { id: 0, kind: 'ai', civilization: 'sumerian', team: null, color: 1, difficulty: null },
        { id: 1, kind: 'ai', civilization: 'shang', team: null, color: 2, difficulty: null },
      ],
      data,
      5,
    );
    const ctx = context();
    step(state, [], ctx);
    const villagers = (owner: number) =>
      Object.values(state.entities).filter((entity) => entity.owner === owner && entity.type === 'villager');
    expect(villagers(0).map((unit) => unit.hp)).toEqual([40, 40, 40]);
    expect(villagers(1).map((unit) => unit.hp)).toEqual([25, 25, 25]);
    const center = Object.values(state.entities).find(
      (entity) => entity.owner === 1 && entity.type === 'town_center',
    );
    const food = state.players[1].resources.food;
    step(state, [{ type: 'train', playerId: 1, buildingId: center?.id ?? 0, unit: 'villager', count: 1 }], ctx);
    expect(state.players[1].resources.food).toBe(food - 35);
  });
});
