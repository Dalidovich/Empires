import type { AgeId, ArchitectureSet, GameData } from '../data/types';
import type { EntityView } from '../sim/snapshot';
import type { AnimationClip, SpriteLibrary } from './assets';
import type { CanvasAtlas, CanvasSpriteSpec, SpriteFrame } from './canvasAtlas';
import { resourceShape } from './metrics';
import {
  arrowPlaceholder,
  artifactPlaceholder,
  buildingPlaceholder,
  diamondPlaceholder,
  genericPlaceholder,
  resourcePlaceholder,
  ringPlaceholder,
  ruinPlaceholder,
  stonePlaceholder,
  unitPlaceholder,
} from './placeholders';
import type { BuildingStage } from './placeholders';

export type Motion = 'none' | 'walk' | 'attack' | 'work';

export interface UnitAnimation {
  names: readonly string[];
  loop: boolean;
  motion: Motion;
}

export interface Visual {
  clip: AnimationClip | null;
  frame: SpriteFrame;
}

const IDLE: UnitAnimation = { names: ['idle'], loop: true, motion: 'none' };
const WALK: UnitAnimation = { names: ['walk', 'idle'], loop: true, motion: 'walk' };
const ATTACK: UnitAnimation = { names: ['attack', 'idle'], loop: true, motion: 'attack' };
const CONVERT: UnitAnimation = {
  names: ['convert', 'attack', 'idle'],
  loop: true,
  motion: 'work',
};
const HEAL: UnitAnimation = { names: ['heal', 'attack', 'idle'], loop: true, motion: 'work' };
const WORK: UnitAnimation = { names: ['work', 'attack', 'idle'], loop: true, motion: 'work' };
const BUILD: UnitAnimation = {
  names: ['work_build', 'work', 'attack', 'idle'],
  loop: true,
  motion: 'work',
};
const REPAIR: UnitAnimation = {
  names: ['work_repair', 'work_build', 'work', 'attack', 'idle'],
  loop: true,
  motion: 'work',
};
const DIE: UnitAnimation = { names: ['die', 'idle'], loop: false, motion: 'none' };
const DECAY: UnitAnimation = { names: ['decay', 'die', 'idle'], loop: false, motion: 'none' };

export const DIE_ANIMATION: readonly string[] = ['die'];
export const DECAY_ANIMATION: readonly string[] = ['decay'];

const BUILDING_ANIMATIONS: Record<BuildingStage, readonly string[]> = {
  c0: ['build_0', 'build', 'idle'],
  c1: ['build_1', 'build', 'idle'],
  c2: ['build_2', 'build', 'idle'],
  full: ['idle'],
  d1: ['damaged_1', 'idle'],
  d2: ['damaged_2', 'damaged_1', 'idle'],
};

const STATIC_ANIMATIONS: readonly string[] = ['idle'];

const STONE_PROJECTILE_CLASSES = ['stone_thrower_line', 'catapult_ship'] as const;

export function unitAnimation(view: EntityView): UnitAnimation {
  switch (view.state) {
    case 'moving':
    case 'fleeing':
    case 'trading':
    case 'loading':
    case 'unloading':
      return WALK;
    case 'returning': {
      const carry = view.own?.carry;
      return carry
        ? { names: [`carry_${carry.resource}`, 'walk', 'idle'], loop: true, motion: 'walk' }
        : WALK;
    }
    case 'attacking':
      return ATTACK;
    case 'converting':
      return CONVERT;
    case 'healing':
      return HEAL;
    case 'gathering': {
      const carry = view.own?.carry;
      return carry
        ? { names: [`work_${carry.kind}`, 'work', 'attack', 'idle'], loop: true, motion: 'work' }
        : WORK;
    }
    case 'building':
      return BUILD;
    case 'repairing':
      return REPAIR;
    case 'dying':
      return DIE;
    case 'dead':
      return DECAY;
    default:
      return IDLE;
  }
}

export function buildingStage(view: EntityView): BuildingStage {
  if (view.buildProgress !== null && view.buildProgress < 1) {
    if (view.buildProgress < 0.34) {
      return 'c0';
    }
    return view.buildProgress < 0.67 ? 'c1' : 'c2';
  }
  const health = view.maxHp > 0 ? view.hp / view.maxHp : 1;
  if (health < 0.34) {
    return 'd2';
  }
  return health < 0.67 ? 'd1' : 'full';
}

export function buildingSpriteIds(type: string, architecture: ArchitectureSet, age: AgeId): string[] {
  return [`${type}.${architecture}.${age}`, `${type}.${architecture}`, `${type}.${age}`, type];
}

export class SpriteResolver {
  readonly ring: SpriteFrame;
  readonly diamond: SpriteFrame;
  private readonly data: GameData;
  private readonly library: SpriteLibrary;
  private readonly atlas: CanvasAtlas;
  private readonly placeholders = new Map<string, SpriteFrame>();

  constructor(data: GameData, library: SpriteLibrary, atlas: CanvasAtlas) {
    this.data = data;
    this.library = library;
    this.atlas = atlas;
    this.ring = atlas.add(ringPlaceholder());
    this.diamond = atlas.add(diamondPlaceholder());
  }

  unit(type: string, animations: readonly string[], direction: number): Visual {
    const clip = this.library.clip(type, animations, direction);
    if (clip) {
      return { clip, frame: clip.frames[0] };
    }
    const def = this.data.units[type];
    const frame = this.placeholder(`unit:${type}:${direction}`, () =>
      def ? unitPlaceholder(def, direction) : genericPlaceholder(type),
    );
    return { clip: null, frame };
  }

  unitClip(type: string, animations: readonly string[], direction: number): AnimationClip | null {
    return this.library.clip(type, animations, direction);
  }

  building(
    type: string,
    architecture: ArchitectureSet,
    age: AgeId,
    stage: BuildingStage,
  ): Visual {
    const id = this.library.firstAvailable(buildingSpriteIds(type, architecture, age));
    const clip = id === null ? null : this.library.clip(id, BUILDING_ANIMATIONS[stage], 0);
    if (clip) {
      return { clip, frame: clip.frames[0] };
    }
    const def = this.data.buildings[type];
    const frame = this.placeholder(`building:${type}:${architecture}:${age}:${stage}`, () =>
      def ? buildingPlaceholder(def, architecture, age, stage) : genericPlaceholder(type),
    );
    return { clip: null, frame };
  }

  resource(type: string): Visual {
    const clip = this.library.clip(type, STATIC_ANIMATIONS, 0);
    if (clip) {
      return { clip, frame: clip.frames[0] };
    }
    const frame = this.placeholder(`resource:${type}`, () =>
      resourcePlaceholder(type, resourceShape(type, this.data)),
    );
    return { clip: null, frame };
  }

  object(type: string): Visual {
    const clip = this.library.clip(type, STATIC_ANIMATIONS, 0);
    if (clip) {
      return { clip, frame: clip.frames[0] };
    }
    const def = this.data.mapObjects[type];
    const frame = this.placeholder(`object:${type}`, () =>
      def?.kind === 'ruin' ? ruinPlaceholder(type, def.size) : artifactPlaceholder(type),
    );
    return { clip: null, frame };
  }

  projectile(sourceType: string): Visual {
    const id = this.library.firstAvailable([`projectile.${sourceType}`, 'projectile']);
    const clip = id === null ? null : this.library.clip(id, STATIC_ANIMATIONS, 0);
    if (clip) {
      return { clip, frame: clip.frames[0] };
    }
    const classes = this.data.units[sourceType]?.class ?? [];
    const stone = STONE_PROJECTILE_CLASSES.some((tag) => classes.includes(tag));
    const frame = stone
      ? this.placeholder('projectile:stone', stonePlaceholder)
      : this.placeholder('projectile:arrow', arrowPlaceholder);
    return { clip: null, frame };
  }

  private placeholder(key: string, build: () => CanvasSpriteSpec): SpriteFrame {
    let frame = this.placeholders.get(key);
    if (!frame) {
      frame = this.atlas.add(build());
      this.placeholders.set(key, frame);
    }
    return frame;
  }
}
