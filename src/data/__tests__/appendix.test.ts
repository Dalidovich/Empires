import { describe, expect, it } from 'vitest';
import { loadGameData } from '../index';
import type { AgeId, Cost } from '../types';

const data = loadGameData();

type UnitRow = [
  building: string,
  id: string,
  cost: Cost,
  trainTime: number,
  hp: number,
  attack: number,
  attackInterval: number,
  armor: number,
  pierceArmor: number,
  range: number,
  speed: number,
];

const UNIT_ROWS: UnitRow[] = [
  ['town_center', 'villager', { food: 50 }, 20, 25, 3, 1.5, 0, 0, 0, 1.1],
  ['barracks', 'clubman', { food: 50 }, 27, 40, 3, 1.5, 0, 0, 0, 1.2],
  ['barracks', 'axeman', { food: 50 }, 27, 50, 5, 1.5, 0, 0, 0, 1.2],
  ['barracks', 'short_swordsman', { food: 35, gold: 15 }, 27, 60, 7, 1.5, 1, 0, 0, 1.2],
  ['barracks', 'broad_swordsman', { food: 35, gold: 15 }, 27, 70, 9, 1.5, 1, 0, 0, 1.2],
  ['barracks', 'long_swordsman', { food: 35, gold: 15 }, 27, 80, 11, 1.5, 2, 0, 0, 1.2],
  ['barracks', 'legion', { food: 35, gold: 15 }, 27, 160, 13, 1.5, 2, 0, 0, 1.2],
  ['academy', 'hoplite', { food: 60, gold: 40 }, 36, 120, 17, 1.5, 5, 0, 0, 0.9],
  ['academy', 'phalanx', { food: 60, gold: 40 }, 36, 120, 20, 1.5, 7, 0, 0, 0.9],
  ['academy', 'centurion', { food: 60, gold: 40 }, 36, 160, 30, 1.5, 8, 0, 0, 0.9],
  ['stable', 'scout', { food: 100 }, 30, 60, 3, 0.9, 0, 0, 0, 2],
  ['stable', 'cavalry', { food: 70, gold: 80 }, 40, 150, 8, 1.3, 0, 0, 0, 2],
  ['stable', 'heavy_cavalry', { food: 70, gold: 80 }, 40, 150, 10, 1.3, 1, 1, 0, 2],
  ['stable', 'cataphract', { food: 70, gold: 80 }, 40, 180, 12, 1.3, 3, 1, 0, 2],
  ['stable', 'chariot', { food: 40, wood: 60 }, 40, 100, 7, 1.4, 0, 0, 0, 2],
  ['stable', 'war_elephant', { food: 170, gold: 40 }, 50, 600, 15, 1, 0, 0, 0, 0.9],
  ['archery_range', 'bowman', { food: 40, wood: 20 }, 30, 35, 3, 1.4, 0, 0, 5, 1.2],
  ['archery_range', 'improved_bowman', { food: 40, gold: 20 }, 30, 40, 4, 1.4, 0, 0, 6, 1.2],
  ['archery_range', 'composite_bowman', { food: 40, gold: 20 }, 30, 45, 5, 1.4, 0, 0, 7, 1.2],
  ['archery_range', 'chariot_archer', { food: 40, wood: 70 }, 40, 70, 4, 1.5, 0, 0, 7, 2],
  ['archery_range', 'elephant_archer', { food: 180, gold: 60 }, 50, 600, 5, 1.5, 0, 0, 7, 0.9],
  ['archery_range', 'horse_archer', { food: 50, gold: 70 }, 40, 60, 7, 1.5, 0, 2, 7, 2.2],
  ['archery_range', 'heavy_horse_archer', { food: 50, gold: 70 }, 40, 90, 8, 1.5, 0, 2, 7, 2.5],
  ['siege_workshop', 'stone_thrower', { wood: 180, gold: 80 }, 60, 75, 50, 5, 0, 0, 10, 0.8],
  ['siege_workshop', 'catapult', { wood: 180, gold: 80 }, 60, 75, 50, 5, 0, 0, 12, 0.8],
  ['siege_workshop', 'heavy_catapult', { wood: 180, gold: 80 }, 60, 150, 60, 5, 0, 0, 13, 0.8],
  ['siege_workshop', 'ballista', { wood: 100, gold: 80 }, 50, 55, 40, 3, 0, 0, 9, 0.8],
  ['siege_workshop', 'helepolis', { wood: 100, gold: 80 }, 50, 55, 40, 1.5, 0, 0, 10, 0.8],
  ['temple', 'priest', { gold: 125 }, 50, 25, 0, 0, 0, 0, 10, 0.8],
  ['dock', 'fishing_boat', { wood: 50 }, 20, 45, 0, 0, 0, 0, 0, 1.45],
  ['dock', 'fishing_ship', { wood: 50 }, 20, 75, 0, 0, 0, 0, 0, 2.1],
  ['dock', 'trade_boat', { wood: 100 }, 25, 200, 0, 0, 0, 0, 0, 2.1],
  ['dock', 'merchant_ship', { wood: 100 }, 25, 250, 0, 0, 0, 0, 0, 2.5],
  ['dock', 'light_transport', { wood: 150 }, 38, 150, 0, 0, 0, 0, 0, 1.45],
  ['dock', 'heavy_transport', { wood: 150 }, 38, 200, 0, 0, 0, 0, 0, 1.8],
  ['dock', 'scout_ship', { wood: 135 }, 30, 120, 5, 1.4, 0, 0, 5, 1.8],
  ['dock', 'war_galley', { wood: 135 }, 30, 160, 8, 1.5, 0, 0, 6, 1.8],
  ['dock', 'trireme', { wood: 135 }, 30, 200, 12, 2, 0, 0, 7, 1.8],
  ['dock', 'catapult_trireme', { wood: 135, gold: 75 }, 45, 120, 35, 5, 0, 0, 9, 1.4],
  ['dock', 'juggernaut', { wood: 135, gold: 75 }, 45, 200, 35, 5, 0, 0, 10, 1.4],
];

const UNIT_AGES: Record<Exclude<AgeId, 'iron'>, string[]> = {
  stone: ['villager', 'clubman', 'fishing_boat', 'trade_boat', 'light_transport'],
  tool: ['axeman', 'scout', 'bowman', 'scout_ship'],
  bronze: [
    'short_swordsman',
    'broad_swordsman',
    'hoplite',
    'cavalry',
    'chariot',
    'improved_bowman',
    'composite_bowman',
    'chariot_archer',
    'stone_thrower',
    'priest',
    'war_galley',
    'fishing_ship',
    'merchant_ship',
  ],
};

type BuildingRow = [id: string, age: AgeId, cost: Cost, buildTime: number, hp: number];

const BUILDING_ROWS: BuildingRow[] = [
  ['town_center', 'stone', { wood: 200 }, 60, 600],
  ['house', 'stone', { wood: 30 }, 20, 75],
  ['barracks', 'stone', { wood: 125 }, 30, 350],
  ['granary', 'stone', { wood: 120 }, 30, 350],
  ['storage_pit', 'stone', { wood: 120 }, 30, 350],
  ['dock', 'stone', { wood: 100 }, 50, 350],
  ['farm', 'tool', { wood: 75 }, 30, 50],
  ['archery_range', 'tool', { wood: 150 }, 40, 350],
  ['stable', 'tool', { wood: 150 }, 40, 350],
  ['market', 'tool', { wood: 150 }, 40, 350],
  ['academy', 'bronze', { wood: 200 }, 60, 350],
  ['government_center', 'bronze', { wood: 175 }, 60, 350],
  ['siege_workshop', 'bronze', { wood: 200 }, 60, 350],
  ['temple', 'bronze', { wood: 200 }, 60, 350],
  ['wonder', 'iron', { wood: 1000, stone: 1000, gold: 1000 }, 8000, 500],
  ['small_wall', 'tool', { stone: 5 }, 8, 200],
  ['medium_wall', 'bronze', { stone: 5 }, 8, 300],
  ['fortification', 'iron', { stone: 5 }, 8, 400],
  ['watch_tower', 'tool', { stone: 150 }, 80, 100],
  ['sentry_tower', 'bronze', { stone: 150 }, 80, 150],
  ['guard_tower', 'iron', { stone: 150 }, 80, 200],
  ['ballista_tower', 'iron', { stone: 150 }, 80, 200],
];

type TechRow = [
  building: string,
  id: string,
  age: AgeId,
  cost: Cost,
  researchTime: number,
  unavailable: string,
];

const TECH_ROWS: TechRow[] = [
  ['town_center', 'tool_age', 'stone', { food: 500 }, 120, ''],
  ['town_center', 'bronze_age', 'tool', { food: 800 }, 140, ''],
  ['town_center', 'iron_age', 'bronze', { food: 1000, gold: 800 }, 160, ''],
  ['storage_pit', 'toolworking', 'tool', { food: 100 }, 30, ''],
  ['storage_pit', 'metalworking', 'bronze', { food: 200, gold: 120 }, 85, ''],
  ['storage_pit', 'metallurgy', 'iron', { food: 300, gold: 180 }, 100, 'Ba Gr Ph Su'],
  ['storage_pit', 'bronze_shield', 'bronze', { food: 150, gold: 180 }, 50, 'As Eg'],
  ['storage_pit', 'iron_shield', 'iron', { food: 200, gold: 320 }, 75, 'As Ba Ch Eg Su'],
  ['storage_pit', 'leather_armor_archers', 'tool', { food: 100 }, 30, ''],
  ['storage_pit', 'scale_armor_archers', 'bronze', { food: 125, gold: 50 }, 60, ''],
  ['storage_pit', 'chain_mail_archers', 'iron', { food: 150, gold: 100 }, 75, 'As Ba Ch Ph'],
  ['storage_pit', 'leather_armor_cavalry', 'tool', { food: 125 }, 30, ''],
  ['storage_pit', 'scale_armor_cavalry', 'bronze', { food: 150, gold: 50 }, 60, ''],
  ['storage_pit', 'chain_mail_cavalry', 'iron', { food: 175, gold: 100 }, 75, 'As Ba Ch Ph'],
  ['storage_pit', 'leather_armor_infantry', 'tool', { food: 75 }, 30, ''],
  ['storage_pit', 'scale_armor_infantry', 'bronze', { food: 100, gold: 50 }, 60, ''],
  ['storage_pit', 'chain_mail_infantry', 'iron', { food: 125, gold: 100 }, 75, 'As Ba Ch Ph'],
  ['granary', 'small_wall', 'tool', { food: 50 }, 10, ''],
  ['granary', 'medium_wall', 'bronze', { food: 180, stone: 50 }, 60, ''],
  ['granary', 'fortification', 'iron', { food: 300, stone: 175 }, 75, 'Mi Ya'],
  ['granary', 'watch_tower', 'tool', { food: 50 }, 10, ''],
  ['granary', 'sentry_tower', 'bronze', { food: 120, stone: 50 }, 30, ''],
  ['granary', 'guard_tower', 'iron', { food: 300, stone: 100 }, 75, 'Mi Ya'],
  ['granary', 'ballista_tower', 'iron', { food: 1800, stone: 750 }, 150, 'Mi Pe Su Ya'],
  ['barracks', 'battle_axe', 'tool', { food: 100 }, 40, ''],
  ['barracks', 'short_sword', 'bronze', { food: 120, gold: 50 }, 50, ''],
  ['barracks', 'broad_sword', 'bronze', { food: 140, gold: 50 }, 80, 'Eg Gr Ya'],
  ['barracks', 'long_sword', 'iron', { food: 160, gold: 50 }, 90, 'Eg Gr Hi Sh Ya'],
  ['barracks', 'legion', 'iron', { food: 1400, gold: 600 }, 150, 'Eg Gr Hi Mi Sh Su Ya'],
  ['dock', 'war_galley', 'bronze', { food: 150, wood: 75 }, 38, ''],
  ['dock', 'trireme', 'iron', { food: 250, wood: 100 }, 40, 'Ba Hi Sh'],
  ['dock', 'catapult_trireme', 'iron', { food: 300, wood: 100 }, 50, 'As Ba Ch Hi Sh Su'],
  ['dock', 'juggernaut', 'iron', { food: 2000, wood: 900 }, 150, 'As Ba Ch Hi Sh Su'],
  ['dock', 'fishing_ship', 'bronze', { food: 50, wood: 100 }, 15, 'Hi'],
  ['dock', 'merchant_ship', 'bronze', { food: 200, wood: 75 }, 30, 'Su'],
  ['dock', 'heavy_transport', 'iron', { food: 150, wood: 125 }, 38, 'As Ba Ch Hi Sh Su'],
  ['archery_range', 'improved_bow', 'bronze', { food: 140, wood: 80 }, 60, 'As Gr Hi Su'],
  ['archery_range', 'composite_bow', 'bronze', { food: 180, wood: 100 }, 85, 'As Ch Gr Hi Su'],
  [
    'archery_range',
    'heavy_horse_archer',
    'iron',
    { food: 1750, gold: 800 },
    150,
    'As Ba Ch Eg Gr Mi Ph',
  ],
  ['stable', 'heavy_cavalry', 'iron', { food: 350, gold: 125 }, 90, 'Ba Eg Hi Mi Ph Su'],
  ['stable', 'cataphract', 'iron', { food: 2000, gold: 850 }, 150, 'Ba Eg Gr Hi Mi Ph Su'],
  ['market', 'woodworking', 'tool', { food: 120, wood: 75 }, 60, ''],
  ['market', 'artisanship', 'bronze', { food: 170, wood: 150 }, 80, 'Pe'],
  ['market', 'craftsmanship', 'iron', { food: 240, wood: 200 }, 100, 'Pe Su'],
  ['market', 'stone_mining', 'tool', { food: 100, stone: 50 }, 30, ''],
  ['market', 'siegecraft', 'iron', { food: 190, stone: 100 }, 60, 'Eg Pe Ph Sh'],
  ['market', 'gold_mining', 'tool', { food: 120, wood: 100 }, 50, ''],
  ['market', 'coinage', 'iron', { food: 200, gold: 120 }, 60, 'Eg Pe Sh Su'],
  ['market', 'domestication', 'tool', { food: 200, wood: 50 }, 40, ''],
  ['market', 'plow', 'bronze', { food: 250, wood: 75 }, 75, 'Pe'],
  ['market', 'irrigation', 'iron', { food: 300, wood: 100 }, 100, 'Pe'],
  ['market', 'wheel', 'bronze', { food: 175, wood: 75 }, 75, 'Pe'],
  ['government_center', 'architecture', 'bronze', { food: 175, gold: 150 }, 50, 'As Ph'],
  ['government_center', 'nobility', 'bronze', { food: 175, gold: 120 }, 70, 'As Ch'],
  ['government_center', 'writing', 'bronze', { food: 200, gold: 75 }, 60, ''],
  ['government_center', 'aristocracy', 'iron', { food: 175, gold: 150 }, 60, 'As Ch Pe Sh'],
  ['government_center', 'alchemy', 'iron', { food: 250, gold: 200 }, 100, 'As Ch Sh'],
  ['government_center', 'ballistics', 'iron', { food: 200, gold: 50 }, 60, 'Pe Sh'],
  ['government_center', 'engineering', 'iron', { food: 200, wood: 100 }, 70, 'As Ch Sh'],
  ['temple', 'astrology', 'bronze', { gold: 150 }, 50, 'Mi Su Ya'],
  ['temple', 'mysticism', 'bronze', { gold: 120 }, 50, 'Hi Mi Ya'],
  ['temple', 'polytheism', 'bronze', { gold: 120 }, 50, 'Hi'],
  ['temple', 'fanaticism', 'iron', { gold: 150 }, 60, 'Hi Mi Su Ya'],
  ['temple', 'monotheism', 'iron', { gold: 350 }, 75, 'Gr Hi Mi Su Ya'],
  ['temple', 'afterlife', 'iron', { gold: 275 }, 75, 'Hi Mi Su'],
  ['temple', 'jihad', 'iron', { gold: 120 }, 60, 'Gr Hi Mi Su Ya'],
  ['academy', 'phalanx', 'iron', { food: 300, gold: 100 }, 90, 'As Ba Ch Eg Pe Sh'],
  ['academy', 'centurion', 'iron', { food: 1800, gold: 700 }, 150, 'As Ba Ch Eg Pe Sh'],
  ['siege_workshop', 'catapult', 'iron', { food: 300, wood: 250 }, 100, 'Ch Eg Ph Ya'],
  ['siege_workshop', 'heavy_catapult', 'iron', { food: 1800, wood: 900 }, 150, 'Ch Eg Pe Ph Sh Ya'],
  ['siege_workshop', 'helepolis', 'iron', { food: 1500, wood: 1000 }, 150, 'Ba Eg Hi Pe Ph Su Ya'],
];

const CIV_CODES: Record<string, string> = {
  As: 'assyrian',
  Ba: 'babylonian',
  Ch: 'choson',
  Eg: 'egyptian',
  Gr: 'greek',
  Hi: 'hittite',
  Mi: 'minoan',
  Pe: 'persian',
  Ph: 'phoenician',
  Sh: 'shang',
  Su: 'sumerian',
  Ya: 'yamato',
};

describe('Appendix A buildings', () => {
  it('contains exactly the appendix buildings', () => {
    expect(Object.keys(data.buildings).sort()).toEqual(BUILDING_ROWS.map((row) => row[0]).sort());
  });

  it.each(BUILDING_ROWS)('%s matches the appendix', (id, age, cost, buildTime, hp) => {
    const building = data.buildings[id];
    expect({
      age: building.age,
      cost: building.cost,
      buildTime: building.buildTime,
      hp: building.hp,
    }).toEqual({ age, cost, buildTime, hp });
  });

  it('keeps building requirements', () => {
    const required = (id: string): string[] => [...data.buildings[id].requires.buildings];
    expect(required('house')).toEqual(['town_center']);
    expect(required('farm')).toEqual(['market']);
    expect(required('archery_range')).toEqual(['barracks']);
    expect(required('stable')).toEqual(['barracks']);
    expect(required('market')).toEqual(['granary']);
    expect(required('academy')).toEqual(['stable']);
    expect(required('government_center')).toEqual(['market']);
    expect(required('siege_workshop')).toEqual(['archery_range']);
    expect(required('temple')).toEqual(['market']);
    expect(data.buildings.town_center.requiresWhenOwned).toEqual(['government_center']);
    for (const id of [
      'small_wall',
      'medium_wall',
      'fortification',
      'watch_tower',
      'sentry_tower',
      'guard_tower',
      'ballista_tower',
    ]) {
      expect(data.buildings[id].requires.technologies).toEqual([id]);
    }
  });

  it.each([
    ['watch_tower', 3, 1.5, 5],
    ['sentry_tower', 4, 1.5, 6],
    ['guard_tower', 6, 1.5, 7],
    ['ballista_tower', 20, 3, 7],
  ])('%s has the appendix attack', (id, attack, attackInterval, range) => {
    const tower = data.buildings[id];
    expect([tower.attack, tower.attackInterval, tower.range]).toEqual([
      attack,
      attackInterval,
      range,
    ]);
  });

  it('keeps housing and drop-off rules', () => {
    expect(data.buildings.town_center.housing).toBe(4);
    expect(data.buildings.house.housing).toBe(4);
    expect([...data.buildings.town_center.dropOff].sort()).toEqual(
      ['farm', 'forage', 'gold', 'hunt', 'shore_fish', 'stone', 'wood'].sort(),
    );
    expect([...data.buildings.granary.dropOff].sort()).toEqual(['farm', 'forage']);
    expect([...data.buildings.storage_pit.dropOff].sort()).toEqual(
      ['gold', 'hunt', 'shore_fish', 'stone', 'wood'].sort(),
    );
    expect([...data.buildings.dock.dropOff].sort()).toEqual(['boat_fish', 'trade']);
    expect(data.buildings.dock.placement).toBe('shore');
    for (const id of ['town_center', 'wonder', 'small_wall', 'watch_tower', 'ballista_tower']) {
      expect(data.buildings[id].convertible).toBe(false);
    }
  });
});

describe('Appendix B units', () => {
  it('contains exactly the appendix units, animals aside', () => {
    const trainable = Object.values(data.units)
      .filter((unit) => !unit.class.includes('animal'))
      .map((unit) => unit.id);
    expect(trainable.sort()).toEqual(UNIT_ROWS.map((row) => row[1]).sort());
    const animals = Object.values(data.units)
      .filter((unit) => unit.class.includes('animal'))
      .map((unit) => unit.id);
    expect(animals.sort()).toEqual(['alligator', 'elephant', 'gazelle', 'lion']);
  });

  it.each(UNIT_ROWS)(
    '%s / %s matches the appendix',
    (building, id, cost, trainTime, hp, attack, attackInterval, armor, pierceArmor, range, speed) => {
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
      }).toEqual({
        building,
        cost,
        trainTime,
        hp,
        attack,
        attackInterval,
        armor,
        pierceArmor,
        range,
        speed,
      });
    },
  );

  it('assigns ages from the appendix note', () => {
    const expected = new Map<string, AgeId>();
    for (const [age, ids] of Object.entries(UNIT_AGES)) {
      for (const id of ids) expected.set(id, age as AgeId);
    }
    for (const [, id] of UNIT_ROWS) {
      expect([id, data.units[id].age]).toEqual([id, expected.get(id) ?? 'iron']);
    }
  });

  it('keeps combat bonuses and special traits', () => {
    for (const id of ['cavalry', 'heavy_cavalry', 'cataphract']) {
      expect(data.units[id].bonuses).toEqual([{ targetClass: 'barracks_infantry', add: 5 }]);
    }
    expect(data.units.chariot.bonuses).toEqual([{ targetClass: 'priest', multiply: 2 }]);
    expect(data.units.chariot_archer.bonuses).toEqual([{ targetClass: 'priest', multiply: 3 }]);
    expect(data.units.chariot.conversionResistance).toBeGreaterThan(1);
    expect(data.units.chariot_archer.conversionResistance).toBeGreaterThan(1);
    expect(data.units.war_elephant.trample).toBe(true);
    expect(data.units.scout.lineOfSight).toBeGreaterThan(data.units.cavalry.lineOfSight);
    expect(data.units.priest.healRate).toBeGreaterThan(0);
    expect(data.units.light_transport.transportCapacity).toBeGreaterThan(0);
    expect(data.units.heavy_transport.transportCapacity).toBeGreaterThan(
      data.units.light_transport.transportCapacity ?? 0,
    );
    const blast = (id: string): number => data.units[id].blastRadius;
    expect(blast('stone_thrower')).toBeGreaterThan(0);
    expect(blast('catapult')).toBeGreaterThan(blast('stone_thrower'));
    expect(blast('heavy_catapult')).toBeGreaterThan(blast('catapult'));
    expect(blast('juggernaut')).toBeGreaterThan(blast('catapult_trireme'));
    for (const unit of Object.values(data.units)) {
      if (unit.class.includes('siege')) expect(unit.minRange).toBeGreaterThan(0);
      if (unit.class.includes('ship')) expect(unit.domain).toBe('water');
    }
  });

  it('follows the appendix upgrade lines', () => {
    const lines = [
      ['clubman', 'axeman'],
      ['short_swordsman', 'broad_swordsman', 'long_swordsman', 'legion'],
      ['hoplite', 'phalanx', 'centurion'],
      ['cavalry', 'heavy_cavalry', 'cataphract'],
      ['bowman'],
      ['improved_bowman', 'composite_bowman'],
      ['horse_archer', 'heavy_horse_archer'],
      ['stone_thrower', 'catapult', 'heavy_catapult'],
      ['ballista', 'helepolis'],
      ['fishing_boat', 'fishing_ship'],
      ['trade_boat', 'merchant_ship'],
      ['light_transport', 'heavy_transport'],
      ['scout_ship', 'war_galley', 'trireme'],
      ['catapult_trireme', 'juggernaut'],
    ];
    for (const line of lines) {
      line.forEach((id, index) => {
        expect([id, data.units[id].upgradesTo]).toEqual([id, line[index + 1] ?? null]);
      });
    }
  });
});

describe('Appendix C technologies', () => {
  it('contains exactly the appendix technologies', () => {
    expect(Object.keys(data.technologies).sort()).toEqual(TECH_ROWS.map((row) => row[1]).sort());
  });

  it.each(TECH_ROWS)(
    '%s / %s matches the appendix',
    (building, id, age, cost, researchTime, unavailable) => {
      const tech = data.technologies[id];
      expect({
        building: tech.building,
        age: tech.age,
        cost: tech.cost,
        researchTime: tech.researchTime,
      }).toEqual({ building, age, cost, researchTime });
      const expected = unavailable
        .split(' ')
        .filter(Boolean)
        .map((code) => CIV_CODES[code])
        .sort();
      const actual = Object.values(data.civilizations)
        .filter((civ) => civ.disabledTechs.includes(id))
        .map((civ) => civ.id)
        .sort();
      expect(actual).toEqual(expected);
    },
  );

  it('keeps the stated prerequisites', () => {
    const requires = (id: string): readonly string[] => data.technologies[id].requires;
    expect(requires('ballista_tower')).toContain('ballistics');
    expect(requires('legion')).toContain('fanaticism');
    expect(requires('catapult_trireme')).toContain('trireme');
    expect(requires('juggernaut')).toContain('engineering');
    expect(requires('heavy_horse_archer')).toContain('chain_mail_archers');
    expect(requires('cataphract')).toContain('metallurgy');
    expect(requires('centurion')).toContain('aristocracy');
    expect(requires('heavy_catapult')).toContain('siegecraft');
    expect(requires('helepolis')).toContain('craftsmanship');
  });

  it('applies the villager modifiers of Wheel and Jihad', () => {
    const villagerEffects = (id: string) =>
      data.technologies[id].effects.filter(
        (effect) => effect.type === 'modify_stat' && effect.target.unitClasses?.includes('villager'),
      );
    expect(villagerEffects('wheel')).toEqual([
      expect.objectContaining({ stat: 'speed', op: 'set', value: 1.8, condition: { lacksTech: 'jihad' } }),
      expect.objectContaining({ stat: 'speed', op: 'set', value: 2.1, condition: { hasTech: 'jihad' } }),
    ]);
    expect(villagerEffects('jihad')).toEqual([
      expect.objectContaining({ stat: 'hp', op: 'set', value: 65 }),
      expect.objectContaining({ stat: 'attack', op: 'set', value: 10 }),
      expect.objectContaining({ stat: 'speed', op: 'set', value: 1.42, condition: { lacksTech: 'wheel' } }),
      expect.objectContaining({ stat: 'speed', op: 'set', value: 2.1, condition: { hasTech: 'wheel' } }),
    ]);
    expect(data.technologies.jihad.effects).toContainEqual(
      expect.objectContaining({ type: 'modify_carry_capacity', op: 'add', value: -8 }),
    );
    expect(data.technologies.wheel.effects).toContainEqual({ type: 'enable_unit', unit: 'chariot' });
    expect(data.technologies.wheel.effects).toContainEqual({
      type: 'enable_unit',
      unit: 'chariot_archer',
    });
  });
});

describe('Appendix D civilizations', () => {
  it('contains the twelve civilizations with their architecture sets', () => {
    const sets = Object.fromEntries(
      Object.values(data.civilizations).map((civ) => [civ.id, civ.architectureSet]),
    );
    expect(sets).toEqual({
      assyrian: 'egyptian',
      babylonian: 'mesopotamian',
      choson: 'asian',
      egyptian: 'egyptian',
      greek: 'greek',
      hittite: 'mesopotamian',
      minoan: 'greek',
      persian: 'mesopotamian',
      phoenician: 'greek',
      shang: 'asian',
      sumerian: 'egyptian',
      yamato: 'asian',
    });
  });

  it('gives every civilization its bonuses', () => {
    const counts = Object.fromEntries(
      Object.values(data.civilizations).map((civ) => [civ.id, civ.bonuses.length]),
    );
    expect(counts).toEqual({
      assyrian: 2,
      babylonian: 3,
      choson: 3,
      egyptian: 3,
      greek: 1,
      hittite: 3,
      minoan: 3,
      persian: 4,
      phoenician: 3,
      shang: 2,
      sumerian: 3,
      yamato: 3,
    });
  });

  it('never disables a unit through both a technology and disabledUnits', () => {
    for (const civ of Object.values(data.civilizations)) {
      for (const id of civ.disabledUnits) {
        const tech = data.units[id].requiresTech;
        expect(tech == null || tech === 'wheel').toBe(true);
      }
    }
  });
});

describe('game rules', () => {
  it('matches the spec constants', () => {
    const { game } = data;
    expect(game.tickRate).toBe(20);
    expect(game.speedMultipliers).toEqual({ slow: 1, normal: 1.5, fast: 2 });
    const secondsFor2000Years =
      (2000 * game.ticksPerGameYear) / (game.tickRate * game.speedMultipliers.normal);
    expect(secondsFor2000Years).toBe(600);
    expect(game.tributeTax).toBe(0.25);
    expect(game.conversion).toMatchObject({
      attemptInterval: 1.5,
      guaranteedFailures: 3,
      chance: 0.3,
      faithMax: 100,
      faithRechargeRate: 2,
    });
    expect([game.trade.minGold, game.trade.maxGold]).toEqual([7, 75]);
    expect(game.populationLimits).toEqual([50, 75, 100, 150, 200]);
    expect(game.start).toEqual({ building: 'town_center', unit: 'villager', unitCount: 3 });
    expect(game.elevation.highGroundMultiplier).toBeGreaterThan(1);
    expect(game.elevation.lowGroundMultiplier).toBeLessThan(1);
    expect(game.ages.slice(1).map((age) => age.requiredBuildingCount)).toEqual([2, 2, 2]);
  });

  it('defines every resource source the spec lists', () => {
    for (const id of ['berry_bush', 'tree', 'gold_mine', 'stone_mine', 'shore_fish', 'deep_fish']) {
      expect(data.resourceSources[id].amount).toBeGreaterThan(0);
    }
    expect(data.resources.carcassDecayRate).toBeGreaterThan(0);
    expect(Object.keys(data.mapObjects).sort()).toEqual(['artifact', 'ruin']);
  });
});
