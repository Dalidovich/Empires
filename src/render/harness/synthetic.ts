import type { AgeId, GameData } from '../../data/types';
import type { SimEvent } from '../../sim/events';
import type {
  EntityView,
  PlayerPublicView,
  PlayerView,
  ProjectileView,
} from '../../sim/snapshot';
import { GAIA_PLAYER_ID, TERRAIN } from '../../sim/types';
import type { EntityKind, EntityState, Settings, Vec2 } from '../../sim/types';

export interface SyntheticOptions {
  size: number;
  units: number;
  spread: number;
}

interface Mover {
  id: number;
  type: string;
  owner: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  facing: number;
  hp: number;
  maxHp: number;
  state: EntityState;
  busyTicks: number;
}

interface PlayerSeed {
  civilization: string;
  color: number;
  age: AgeId;
}

const PLAYERS: PlayerSeed[] = [
  { civilization: 'assyrian', color: 0x2f6fde, age: 'stone' },
  { civilization: 'babylonian', color: 0xd9412f, age: 'tool' },
  { civilization: 'greek', color: 0xe6c228, age: 'bronze' },
  { civilization: 'shang', color: 0x37b24d, age: 'iron' },
];

const VIEWER = 0;
const UNIT_SPEED = 0.06;
const UNIT_SIGHT = 6;
const BUILDING_SIGHT = 9;
const FOG_INTERVAL = 4;
const DEATH_INTERVAL = 10;
const BUSY_STATES: EntityState[] = ['attacking', 'gathering', 'building', 'idle'];

const SETTINGS: Settings = {
  mapType: 'inland',
  mapSize: 'huge',
  victoryMode: 'conquest',
  populationLimit: 200,
  startingAge: 'stone',
  revealMap: false,
  lockTeams: true,
  speed: 'normal',
};

export class SyntheticWorld {
  readonly size: number;
  private readonly data: GameData;
  private readonly spread: number;
  private readonly terrain: number[];
  private readonly elevation: number[];
  private readonly explored: number[];
  private visible: number[];
  private readonly statics: EntityView[] = [];
  private readonly movers: Mover[] = [];
  private readonly unitTypes: string[];
  private projectiles: ProjectileView[] = [];
  private tick = 0;
  private nextId = 1;
  private nextProjectileId = 1;

  constructor(data: GameData, options: SyntheticOptions) {
    this.data = data;
    this.size = options.size;
    this.spread = Math.min(options.spread, options.size / 2 - 4);
    const tiles = this.size * this.size;
    this.terrain = new Array<number>(tiles).fill(TERRAIN.grass);
    this.elevation = new Array<number>(tiles).fill(0);
    this.explored = new Array<number>(tiles).fill(0);
    this.visible = new Array<number>(tiles).fill(0);
    this.unitTypes = Object.values(data.units)
      .filter((unit) => unit.domain === 'land' && !unit.class.includes('animal'))
      .map((unit) => unit.id);
    this.paintTerrain();
    this.raiseHills();
    this.placeStatics();
    for (let i = 0; i < options.units; i += 1) {
      this.movers.push(this.spawnMover(i));
    }
    this.markExplored();
    this.updateVisibility();
  }

  get center(): Vec2 {
    return { x: this.size / 2, y: this.size / 2 };
  }

  get unitCount(): number {
    return this.movers.length;
  }

  step(): { view: PlayerView; events: SimEvent[] } {
    this.tick += 1;
    const events: SimEvent[] = [];
    for (const mover of this.movers) {
      this.advance(mover);
    }
    if (this.tick % DEATH_INTERVAL === 0 && this.movers.length > 0) {
      const index = Math.floor(Math.random() * this.movers.length);
      const victim = this.movers[index];
      events.push({
        type: 'entityDied',
        entityId: victim.id,
        entityKind: 'unit',
        entityType: victim.type,
        owner: victim.owner,
        killerOwner: null,
        position: { x: victim.x, y: victim.y },
      });
      this.movers[index] = this.spawnMover(index);
    }
    this.launchProjectiles();
    if (this.tick % FOG_INTERVAL === 0) {
      this.updateVisibility();
    }
    return { view: this.buildView(), events };
  }

  private index(x: number, y: number): number {
    return y * this.size + x;
  }

  private disc(centerX: number, centerY: number, radius: number, visit: (i: number, d: number) => void): void {
    const minX = Math.max(0, Math.floor(centerX - radius));
    const maxX = Math.min(this.size - 1, Math.ceil(centerX + radius));
    const minY = Math.max(0, Math.floor(centerY - radius));
    const maxY = Math.min(this.size - 1, Math.ceil(centerY + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const distance = Math.hypot(x + 0.5 - centerX, y + 0.5 - centerY);
        if (distance <= radius) {
          visit(this.index(x, y), distance);
        }
      }
    }
  }

  private lake(centerX: number, centerY: number, radius: number): void {
    this.disc(centerX, centerY, radius, (i, distance) => {
      if (distance < radius * 0.55) {
        this.terrain[i] = TERRAIN.deepWater;
      } else if (distance < radius * 0.82) {
        this.terrain[i] = TERRAIN.shallows;
      } else {
        this.terrain[i] = TERRAIN.shore;
      }
    });
  }

  private paintTerrain(): void {
    const size = this.size;
    const half = size / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        if (x > size * 0.62 && y < size * 0.38) {
          this.terrain[this.index(x, y)] = TERRAIN.desert;
        }
        const wave = Math.sin(x * 0.19) * Math.cos(y * 0.23) + Math.sin((x + y) * 0.07);
        const distance = Math.hypot(x - half, y - half);
        if (wave > 1.1 && distance > 26) {
          this.terrain[this.index(x, y)] = TERRAIN.forest;
        }
      }
    }
    this.disc(half - 15, half + 9, 7, (i) => {
      this.terrain[i] = TERRAIN.desert;
    });
    this.disc(half - 7, half - 17, 5, (i) => {
      this.terrain[i] = TERRAIN.forest;
    });
    this.lake(half + 15, half - 7, 7);
    this.lake(size * 0.28, size * 0.72, size * 0.11);
  }

  private raiseHills(): void {
    const size = this.size;
    const half = size / 2;
    const hills: [number, number, number, number][] = [
      [half + 3, half + 15, 9, 4],
      [half - 20, half - 6, 8, 3],
      [size * 0.75, size * 0.7, 18, 7],
      [size * 0.2, size * 0.25, 14, 5],
    ];
    for (const [centerX, centerY, radius, height] of hills) {
      this.disc(centerX, centerY, radius, (i, distance) => {
        const level = Math.round(height * (1 - distance / radius));
        if (this.terrain[i] === TERRAIN.grass || this.terrain[i] === TERRAIN.desert || this.terrain[i] === TERRAIN.forest) {
          this.elevation[i] = Math.max(this.elevation[i], level);
        }
      });
    }
    for (let pass = 0; pass < 8; pass += 1) {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          let lowest = Infinity;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
                lowest = Math.min(lowest, this.elevation[this.index(nx, ny)]);
              }
            }
          }
          const i = this.index(x, y);
          this.elevation[i] = Math.min(this.elevation[i], lowest + 1);
        }
      }
    }
  }

  private addStatic(
    kind: EntityKind,
    type: string,
    owner: number,
    position: Vec2,
    extra: Partial<EntityView> = {},
  ): EntityView {
    const maxHp =
      kind === 'building'
        ? (this.data.buildings[type]?.hp ?? 100)
        : kind === 'unit'
          ? (this.data.units[type]?.hp ?? 25)
          : 1;
    const view: EntityView = {
      id: this.nextId,
      kind,
      type,
      owner,
      position,
      facing: 0,
      hp: maxHp,
      maxHp,
      state: 'idle',
      target: null,
      buildProgress: null,
      amount: kind === 'resource' ? 100 : null,
      heldBy: null,
      remembered: false,
      own: null,
      ...extra,
    };
    this.nextId += 1;
    this.statics.push(view);
    return view;
  }

  private placeStatics(): void {
    const size = this.size;
    const half = size / 2;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const code = this.terrain[this.index(x, y)];
        if (code === TERRAIN.forest && (x * 7 + y * 13) % 3 !== 0) {
          this.addStatic('resource', 'tree', GAIA_PLAYER_ID, { x: x + 0.5, y: y + 0.5 });
        } else if (code === TERRAIN.shallows && (x * 5 + y * 11) % 17 === 0) {
          this.addStatic('resource', 'shore_fish', GAIA_PLAYER_ID, { x: x + 0.5, y: y + 0.5 });
        } else if (code === TERRAIN.deepWater && (x * 3 + y * 7) % 23 === 0) {
          this.addStatic('resource', 'deep_fish', GAIA_PLAYER_ID, { x: x + 0.5, y: y + 0.5 });
        }
      }
    }
    const clusters: [string, number, number][] = [
      ['gold_mine', half + 6, half + 4],
      ['stone_mine', half - 6, half + 5],
      ['berry_bush', half + 2, half - 8],
      ['gazelle_carcass', half - 3, half - 4],
    ];
    for (const [type, cx, cy] of clusters) {
      for (let i = 0; i < 5; i += 1) {
        this.addStatic('resource', type, GAIA_PLAYER_ID, {
          x: Math.floor(cx) + (i % 3) + 0.5,
          y: Math.floor(cy) + Math.floor(i / 3) + 0.5,
        });
      }
    }
    ['gazelle', 'elephant', 'lion', 'alligator'].forEach((type, i) => {
      this.addStatic('unit', type, GAIA_PLAYER_ID, { x: half + 9 + i * 2, y: half + 9 });
    });
    this.addStatic('object', 'ruin', GAIA_PLAYER_ID, { x: half - 10, y: half + 2 });
    this.addStatic('object', 'ruin', 1, { x: half - 14, y: half + 2 });
    this.addStatic('object', 'artifact', GAIA_PLAYER_ID, { x: half - 9.5, y: half + 5.5 });
    this.addStatic('object', 'artifact', VIEWER, { x: half - 7.5, y: half + 5.5 });
    this.addStatic('unit', 'fishing_boat', VIEWER, { x: half + 15.5, y: half - 6.5 });
    this.addStatic('unit', 'war_galley', 1, { x: half + 13.5, y: half - 8.5 });

    const types = Object.keys(this.data.buildings);
    const corners: [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    PLAYERS.forEach((_, owner) => {
      const [sx, sy] = corners[owner];
      const originX = Math.floor(half + sx * 30) - 12;
      const originY = Math.floor(half + sy * 30) - 12;
      types.forEach((type, i) => {
        const def = this.data.buildings[type];
        const tileX = originX + (i % 5) * 6;
        const tileY = originY + Math.floor(i / 5) * 6;
        const extra: Partial<EntityView> = {};
        if ((i + owner) % 6 === 1) {
          extra.buildProgress = [0.15, 0.5, 0.85][(i + owner) % 3];
          extra.state = 'foundation';
          extra.hp = Math.round(def.hp * (extra.buildProgress ?? 1));
        } else if ((i + owner) % 5 === 2) {
          extra.hp = Math.round(def.hp * ((i + owner) % 2 === 0 ? 0.5 : 0.2));
        }
        this.addStatic(
          'building',
          type,
          owner,
          { x: tileX + def.size / 2, y: tileY + def.size / 2 },
          extra,
        );
      });
    });
  }

  private randomTarget(): Vec2 {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * this.spread;
    return {
      x: this.size / 2 + Math.cos(angle) * radius,
      y: this.size / 2 + Math.sin(angle) * radius,
    };
  }

  private spawnMover(index: number): Mover {
    const type = this.unitTypes[index % this.unitTypes.length] ?? 'villager';
    const start = this.randomTarget();
    const target = this.randomTarget();
    const maxHp = this.data.units[type]?.hp ?? 25;
    const mover: Mover = {
      id: this.nextId,
      type,
      owner: index % PLAYERS.length,
      x: start.x,
      y: start.y,
      targetX: target.x,
      targetY: target.y,
      facing: 0,
      hp: index % 4 === 0 ? Math.ceil(maxHp * (0.2 + Math.random() * 0.7)) : maxHp,
      maxHp,
      state: 'moving',
      busyTicks: 0,
    };
    this.nextId += 1;
    return mover;
  }

  private advance(mover: Mover): void {
    if (mover.busyTicks > 0) {
      mover.busyTicks -= 1;
      if (mover.busyTicks === 0) {
        mover.state = 'moving';
      }
      return;
    }
    const dx = mover.targetX - mover.x;
    const dy = mover.targetY - mover.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= UNIT_SPEED) {
      const target = this.randomTarget();
      mover.targetX = target.x;
      mover.targetY = target.y;
      if (Math.random() < 0.5) {
        mover.state = BUSY_STATES[Math.floor(Math.random() * BUSY_STATES.length)];
        mover.busyTicks = 40 + Math.floor(Math.random() * 60);
      }
      return;
    }
    mover.x += (dx / distance) * UNIT_SPEED;
    mover.y += (dy / distance) * UNIT_SPEED;
    mover.facing = Math.atan2(dy, dx);
  }

  private launchProjectiles(): void {
    this.projectiles = this.projectiles.filter((projectile) => projectile.arriveTick >= this.tick);
    for (let i = 0; i < 3 && this.movers.length > 0; i += 1) {
      const source = this.movers[Math.floor(Math.random() * this.movers.length)];
      const angle = Math.random() * Math.PI * 2;
      const reach = 3 + Math.random() * 5;
      this.projectiles.push({
        id: this.nextProjectileId,
        owner: source.owner,
        sourceType: i === 0 ? 'stone_thrower' : 'bowman',
        origin: { x: source.x, y: source.y },
        destination: { x: source.x + Math.cos(angle) * reach, y: source.y + Math.sin(angle) * reach },
        launchTick: this.tick,
        arriveTick: this.tick + 10 + Math.floor(reach * 2),
      });
      this.nextProjectileId += 1;
    }
  }

  private markExplored(): void {
    this.disc(this.size / 2, this.size / 2, this.spread + 22, (i) => {
      this.explored[i] = 1;
    });
  }

  private updateVisibility(): void {
    const visible = new Array<number>(this.size * this.size).fill(0);
    const reveal = (x: number, y: number, radius: number): void => {
      this.disc(x, y, radius, (i) => {
        visible[i] = 1;
        this.explored[i] = 1;
      });
    };
    for (const mover of this.movers) {
      if (mover.owner === VIEWER) {
        reveal(mover.x, mover.y, UNIT_SIGHT);
      }
    }
    for (const entity of this.statics) {
      if (entity.owner === VIEWER) {
        reveal(entity.position.x, entity.position.y, BUILDING_SIGHT);
      }
    }
    this.visible = visible;
  }

  private fogIndex(position: Vec2): number {
    const x = Math.min(this.size - 1, Math.max(0, Math.floor(position.x)));
    const y = Math.min(this.size - 1, Math.max(0, Math.floor(position.y)));
    return this.index(x, y);
  }

  private buildView(): PlayerView {
    const entities: EntityView[] = [];
    for (const entity of this.statics) {
      const i = this.fogIndex(entity.position);
      if (entity.owner === VIEWER || this.visible[i] > 0) {
        entities.push(entity);
      } else if (this.explored[i] > 0) {
        if (entity.kind === 'building') {
          entities.push({ ...entity, remembered: true });
        } else if (entity.kind === 'resource' || entity.type === 'ruin') {
          entities.push(entity);
        }
      }
    }
    for (const mover of this.movers) {
      if (mover.owner !== VIEWER && !(this.visible[this.fogIndex(mover)] > 0)) {
        continue;
      }
      entities.push({
        id: mover.id,
        kind: 'unit',
        type: mover.type,
        owner: mover.owner,
        position: { x: mover.x, y: mover.y },
        facing: mover.facing,
        hp: mover.hp,
        maxHp: mover.maxHp,
        state: mover.state,
        target: null,
        buildProgress: null,
        amount: null,
        heldBy: null,
        remembered: false,
        own: null,
      });
    }
    const players: PlayerPublicView[] = PLAYERS.map((player, id) => ({
      id,
      kind: id === VIEWER ? 'human' : 'ai',
      civilization: player.civilization,
      team: null,
      color: player.color,
      difficulty: id === VIEWER ? null : 'moderate',
      age: player.age,
      defeated: false,
      stanceTowardViewer: id === VIEWER ? null : 'enemy',
      score: 0,
    }));
    return {
      tick: this.tick,
      playerId: VIEWER,
      settings: SETTINGS,
      speed: 'normal',
      paused: false,
      self: {
        resources: { food: 0, wood: 0, stone: 0, gold: 0 },
        age: PLAYERS[VIEWER].age,
        researched: [],
        population: 0,
        housing: 0,
        populationLimit: SETTINGS.populationLimit,
        diplomacy: {},
        flags: {},
      },
      players,
      map: { size: this.size, terrain: this.terrain, elevation: this.elevation },
      fog: { explored: this.explored, visible: this.visible },
      entities,
      projectiles: this.projectiles,
      victoryTimers: [],
      outcome: null,
    };
  }
}
