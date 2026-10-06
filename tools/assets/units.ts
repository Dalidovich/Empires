import { AtlasBuilder } from './atlas';
import {
  alligator,
  BRONZE,
  DARK_WOOD,
  elephant,
  gazelle,
  HOWDAH,
  horse,
  human,
  IRON,
  LEATHER,
  LIGHT_WOOD,
  LINEN,
  lion,
  SADDLE,
  STONE,
  WOOD,
} from './figures';
import type { HorseLook, HumanLook, HumanPose, Load, WeaponKind } from './figures';
import { fade, lighten, mix, rgb, team } from './raster';
import type { Image, Paint } from './raster';
import { Scene } from './scene';
import type { P2, P3 } from './scene';

type Death = 'fall' | 'roll' | 'sink' | 'squash';

export interface UnitSpec {
  id: string;
  canvas: [number, number, number, number];
  death: Death;
  shadow: [number, number] | null;
  footprint?: [number, number];
  animations: Record<string, number>;
  aliases?: Record<string, string>;
  build(scene: Scene, animation: string, t: number, heading: number): void;
}

const TAU = Math.PI * 2;
const DIRECTIONS: [string, number][] = [
  ['e', 0],
  ['se', Math.PI / 4],
  ['s', Math.PI / 2],
  ['ne', -Math.PI / 4],
  ['n', -Math.PI / 2],
];
const ONE_SHOT = new Set(['die', 'decay']);
const DECAY_TONE = rgb(0x4a3a2a);

const SKIN = 0xd6a274;
const SKIN_DARK = 0xb98556;
const HAIR = 0x2e2018;

function deathTransform(death: Death, k: number): (p: P3) => P3 {
  switch (death) {
    case 'fall': {
      const angle = k * 1.5;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return (p) => [p[0] * cos - p[2] * sin, p[1], Math.max(0.6, p[0] * sin + p[2] * cos + k * 2)];
    }
    case 'roll': {
      const angle = k * 1.45;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return (p) => [p[0], p[1] * cos + p[2] * sin * 0.9, Math.max(0.6, -p[1] * sin + p[2] * cos + k * 4)];
    }
    case 'sink': {
      const angle = k * 0.6;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return (p) => [p[0], p[1] * cos + p[2] * sin, -p[1] * sin + p[2] * cos - k * 13];
    }
    case 'squash':
      return (p) => [p[0] * (1 + 0.12 * k), p[1] * (1 + 0.12 * k), p[2] * (1 - 0.72 * k)];
  }
}

function waterExtent(spec: UnitSpec, heading: number): [number, number] {
  const [length, beam] = spec.footprint ?? [0, 0];
  const cos = Math.abs(Math.cos(heading));
  const sin = Math.abs(Math.sin(heading));
  return [length * cos + beam * sin + 3, (length * sin + beam * cos) * 0.5 + 2];
}

function renderFrame(spec: UnitSpec, animation: string, t: number, heading: number): Image {
  const scene = new Scene(heading);
  const [width, height, anchorX, anchorY] = spec.canvas;
  let alpha = 1;
  let waterline: number | undefined;
  if (spec.shadow) {
    scene.shadow([0, 0, 0], spec.shadow[0], spec.shadow[1]);
  }
  if (spec.footprint) {
    const [rx, ry] = waterExtent(spec, heading);
    scene.shadow([0, 0, 0], rx, ry, 0.2, 0xffffff);
    waterline = ry - 1;
  }
  if (animation === 'die' || animation === 'decay') {
    const k = animation === 'die' ? t : 1;
    scene.push(deathTransform(spec.death, k));
    if (animation === 'decay' || spec.death === 'squash') {
      const amount = animation === 'decay' ? 0.3 + t * 0.45 : k * 0.3;
      scene.filter = (paint: Paint): Paint =>
        paint.team >= 0 ? lighten(paint, 1 - amount * 0.8) : mix(paint, DECAY_TONE, amount);
    }
    if (animation === 'decay') {
      alpha = 1 - t * 0.5;
    }
    spec.build(scene, 'dead', 0, heading);
  } else {
    waterline = undefined;
    spec.build(scene, animation, t, heading);
  }
  const image = scene.render({ width, height, anchorX, anchorY, waterline });
  if (alpha < 1) {
    fade(image, alpha);
  }
  return image;
}

export function buildUnitAtlas(spec: UnitSpec): AtlasBuilder {
  const atlas = new AtlasBuilder(`units/${spec.id}`);
  for (const [animation, count] of Object.entries(spec.animations)) {
    for (const [suffix, heading] of DIRECTIONS) {
      const images: Image[] = [];
      for (let i = 0; i < count; i += 1) {
        const t = ONE_SHOT.has(animation) ? (count > 1 ? i / (count - 1) : 1) : i / count;
        images.push(renderFrame(spec, animation, t, heading));
      }
      atlas.addAnimation(`${animation}_${suffix}`, images);
    }
  }
  return atlas;
}

export function renderUnitPose(spec: UnitSpec, animation: string, t: number, heading: number): Image {
  return renderFrame(spec, animation, t, heading);
}

type Strike = 'swing' | 'thrust' | 'shoot' | 'pray';

function humanPose(animation: string, t: number, strike: Strike): HumanPose {
  switch (animation) {
    case 'walk':
      return { walk: t };
    case 'attack':
    case 'heal':
      return { [strike]: t };
    case 'idle':
      return { breathe: t };
    default:
      return {};
  }
}

const FOOT_ANIMATIONS = { idle: 4, walk: 8, attack: 8, die: 4, decay: 3 };

function soldier(id: string, look: HumanLook, strike: Strike): UnitSpec {
  return {
    id,
    canvas: [72, 72, 36, 52],
    death: 'fall',
    shadow: [7, 3.2],
    animations: FOOT_ANIMATIONS,
    build(scene, animation, t) {
      human(scene, look, humanPose(animation, t, strike));
    },
  };
}

function villager(): UnitSpec {
  const base: HumanLook = { skin: SKIN, hair: HAIR, torso: team(0.8), skirt: rgb(0xd8c8a0) };
  const tool = (weapon: WeaponKind, reach: number): HumanLook => ({ ...base, weapon, reach });
  const work: Record<string, [HumanLook, Strike | 'reach']> = {
    work_forage: [tool('basket', 2), 'reach'],
    work_farm: [tool('hoe', 9), 'swing'],
    work_wood: [tool('axe', 8), 'swing'],
    work_stone: [tool('pick', 8), 'swing'],
    work_hunt: [tool('spear', 16), 'thrust'],
    work_shore_fish: [tool('rod', 13), 'thrust'],
    work_build: [tool('hammer', 6), 'swing'],
  };
  const animations: Record<string, number> = { ...FOOT_ANIMATIONS };
  for (const name of Object.keys(work)) {
    animations[name] = 8;
  }
  for (const load of ['food', 'wood', 'stone', 'gold']) {
    animations[`carry_${load}`] = 8;
  }
  return {
    id: 'villager',
    canvas: [72, 72, 36, 52],
    death: 'fall',
    shadow: [7, 3.2],
    animations,
    aliases: { work_gold: 'work_stone' },
    build(scene, animation, t) {
      const job = work[animation];
      if (job) {
        const [look, motion] = job;
        human(scene, look, motion === 'reach' ? { reach: t } : { [motion]: motion === 'thrust' ? (t * 2) % 1 : t });
        return;
      }
      if (animation.startsWith('carry_')) {
        human(scene, base, { walk: t, carry: animation.slice(6) as Load });
        return;
      }
      if (animation === 'attack') {
        human(scene, base, { thrust: t });
        return;
      }
      human(scene, base, humanPose(animation, t, 'swing'));
    },
  };
}

function priest(): UnitSpec {
  const look: HumanLook = {
    skin: SKIN,
    hair: 0xd8d8d0,
    torso: team(0.85),
    robe: rgb(LINEN),
    cape: team(0.65),
    weapon: 'staff',
    reach: 22,
  };
  return {
    id: 'priest',
    canvas: [72, 72, 36, 52],
    death: 'fall',
    shadow: [7, 3.2],
    animations: { idle: 4, walk: 8, heal: 8, die: 4, decay: 3 },
    aliases: { convert: 'heal' },
    build(scene, animation, t) {
      human(scene, look, humanPose(animation, t, 'pray'));
    },
  };
}

const MOUNT_ANIMATIONS = { idle: 4, walk: 8, attack: 8, die: 4, decay: 3 };

function rider(id: string, mount: HorseLook, look: HumanLook, strike: Strike): UnitSpec {
  return {
    id,
    canvas: [96, 88, 48, 66],
    death: 'roll',
    shadow: [14, 5.5],
    animations: MOUNT_ANIMATIONS,
    build(scene, animation, t) {
      const gait = animation === 'walk' ? t : null;
      horse(scene, mount, gait);
      const bob = gait === null ? 0 : Math.abs(Math.cos(t * TAU)) * 0.6;
      const pose = animation === 'walk' ? {} : humanPose(animation, t, strike);
      human(scene, look, { ...pose, seat: true }, [SADDLE[0], SADDLE[1], SADDLE[2] + bob]);
    },
  };
}

function wheel(scene: Scene, center: P3, radius: number, turn: number): void {
  const bias = center[1] > 0 ? 0.6 : -0.6;
  scene.disc(center, 'l', radius, rgb(DARK_WOOD), { bias });
  scene.disc(center, 'l', radius * 0.62, rgb(LIGHT_WOOD), { bias: bias + 0.01 });
  for (const offset of [0, Math.PI / 2]) {
    const angle = turn * TAU + offset;
    const dx = Math.cos(angle) * radius * 0.9;
    const du = Math.sin(angle) * radius * 0.9;
    scene.limb(
      [center[0] - dx, center[1], center[2] - du],
      [center[0] + dx, center[1], center[2] + du],
      1,
      1,
      rgb(DARK_WOOD),
      { flat: true, bias: bias + 0.02 },
    );
  }
}

function rect(f0: number, f1: number, half: number): P2[] {
  return [
    [f0, -half],
    [f1, -half],
    [f1, half],
    [f0, half],
  ];
}

function chariot(id: string, look: HumanLook, strike: Strike): UnitSpec {
  const mount: HorseLook = { coat: 0x8a5a36, mane: 0x2a1c12, cloth: team(0.8) };
  return {
    id,
    canvas: [112, 88, 56, 66],
    death: 'roll',
    shadow: [20, 7],
    animations: MOUNT_ANIMATIONS,
    build(scene, animation, t) {
      const gait = animation === 'walk' ? t : null;
      horse(scene, mount, gait, [9, 0, 0]);
      scene.limb([-4, 0, 6], [5, 0, 11.5], 1.3, 1.3, rgb(WOOD), { flat: true });
      const turn = gait === null ? 0 : t;
      wheel(scene, [-9, 5.6, 4.6], 4.6, turn);
      wheel(scene, [-9, -5.6, 4.6], 4.6, turn);
      const pose = animation === 'walk' ? {} : humanPose(animation, t, strike);
      human(scene, look, pose, [-9, 0, 5]);
      scene.prism(rect(-13, -5, 4.4), 4, 11, team(0.8), rgb(DARK_WOOD), { bias: 0.05 });
    },
  };
}

function elephantRider(id: string, look: HumanLook, strike: Strike, tower: boolean): UnitSpec {
  return {
    id,
    canvas: [120, 112, 60, 84],
    death: 'roll',
    shadow: [22, 8],
    animations: MOUNT_ANIMATIONS,
    build(scene, animation, t) {
      const gait = animation === 'walk' ? t : null;
      const trunk = animation === 'attack' && strike !== 'shoot' ? Math.sin(t * Math.PI) : 0;
      elephant(scene, 0x8c8a86, gait, team(0.8), trunk);
      const pose = animation === 'walk' ? {} : humanPose(animation, t, strike);
      if (tower) {
        human(scene, look, pose, [HOWDAH[0], 0, HOWDAH[2] - 6]);
        scene.prism(rect(-6, 4, 4.6), 25, 31, rgb(LIGHT_WOOD), rgb(DARK_WOOD), { bias: 0.05 });
      } else {
        human(scene, look, { ...pose, seat: true }, HOWDAH);
      }
    },
  };
}

function pennant(scene: Scene, base: P3, height: number): void {
  const top: P3 = [base[0], base[1], base[2] + height];
  scene.limb(base, top, 1, 1, rgb(DARK_WOOD), { flat: true });
  scene.poly(
    [top, [top[0] - 5.5, top[1], top[2] - 1.6], [top[0], top[1], top[2] - 3.4]],
    team(0.95),
    { bias: 0.1 },
  );
}

function throwAngle(t: number): number {
  const rest = 3.6;
  const fire = 1.15;
  if (t < 0.45) {
    return rest + 0.08 * Math.sin((t / 0.45) * Math.PI);
  }
  if (t < 0.6) {
    return rest + (fire - rest) * ((t - 0.45) / 0.15);
  }
  if (t < 0.8) {
    return fire;
  }
  return fire + (rest - fire) * ((t - 0.8) / 0.2);
}

function thrower(id: string, scale: number, tone: number, banded: boolean): UnitSpec {
  const wood = rgb(tone, 1, 0.06);
  return {
    id,
    canvas: [104, 96, 52, 68],
    death: 'squash',
    shadow: [15 * scale, 6 * scale],
    animations: { idle: 1, walk: 4, attack: 10, die: 4, decay: 3 },
    build(scene, animation, t) {
      const k = scale;
      const turn = animation === 'walk' ? t * 0.25 : 0;
      for (const f of [-6, 6]) {
        for (const l of [-5.8, 5.8]) {
          wheel(scene, [f * k, l * k, 3.6 * k], 3.6 * k, turn);
        }
      }
      scene.prism(rect(-9 * k, 9 * k, 4.8 * k), 3.6 * k, 6 * k, wood, lighten(wood, 1.15));
      if (banded) {
        scene.prism(rect(-2 * k, 2 * k, 5 * k), 3.4 * k, 6.2 * k, rgb(IRON), rgb(IRON), { bias: 0.02 });
      }
      const pivot: P3 = [0, 0, 15 * k];
      for (const l of [-3.6, 3.6]) {
        scene.limb([-3 * k, l * k, 6 * k], [0, l * k, 15 * k], 2, 2, wood, { flat: true });
        scene.limb([3 * k, l * k, 6 * k], [0, l * k, 15 * k], 2, 2, wood, { flat: true });
      }
      scene.limb([0, -3.6 * k, 15 * k], [0, 3.6 * k, 15 * k], 1.8, 1.8, rgb(DARK_WOOD), { flat: true });
      const angle = animation === 'attack' ? throwAngle(t) : 3.6;
      const reach = 10.5 * k;
      const tip: P3 = [pivot[0] + Math.cos(angle) * reach, 0, pivot[2] + Math.sin(angle) * reach];
      const tail: P3 = [pivot[0] - Math.cos(angle) * 4 * k, 0, pivot[2] - Math.sin(angle) * 4 * k];
      scene.limb(tail, tip, 2.4, 1.6, lighten(wood, 1.1), { flat: true, bias: 0.05 });
      scene.ball(tail, 2.6 * k, rgb(STONE), { bias: 0.05 });
      scene.ball(tip, 2.2 * k, rgb(DARK_WOOD), { flat: true, bias: 0.06 });
      if (animation !== 'attack' || t < 0.55) {
        scene.ball([tip[0], tip[1], tip[2] + 1], 1.8 * k, rgb(0xb4b2ac), { bias: 0.07 });
      }
      pennant(scene, [-8 * k, 0, 6 * k], 9);
    },
  };
}

function ballista(id: string, scale: number, housing: boolean): UnitSpec {
  const wood = rgb(WOOD, 1, 0.06);
  return {
    id,
    canvas: [104, 96, 52, 68],
    death: 'squash',
    shadow: [14 * scale, 6 * scale],
    animations: { idle: 1, walk: 4, attack: 8, die: 4, decay: 3 },
    build(scene, animation, t) {
      const k = scale;
      const turn = animation === 'walk' ? t * 0.25 : 0;
      wheel(scene, [-1 * k, 5.4 * k, 4.4 * k], 4.4 * k, turn);
      wheel(scene, [-1 * k, -5.4 * k, 4.4 * k], 4.4 * k, turn);
      scene.prism(rect(-7 * k, 7 * k, 3.8 * k), 3.6 * k, 5.8 * k, wood, lighten(wood, 1.15));
      if (housing) {
        scene.prism(rect(-7 * k, 2 * k, 4.2 * k), 5.8 * k, 10.5 * k, team(0.8), rgb(DARK_WOOD), { bias: 0.02 });
      }
      const deck = (housing ? 12 : 11) * k;
      scene.limb([0, 0, 5.8 * k], [0, 0, deck], 2.4, 2.4, wood, { flat: true });
      scene.limb([-8 * k, 0, deck], [8 * k, 0, deck + 1.6], 2.6, 2.2, lighten(wood, 1.1), { bias: 0.04 });
      const draw = animation === 'attack' ? (t < 0.6 ? t / 0.6 : 0) : 0.6;
      const nock: P3 = [(4 - draw * 9) * k, 0, deck + 0.9];
      for (const sideSign of [-1, 1]) {
        const armTip: P3 = [(4.5 - draw * 1.5) * k, 8.5 * k * sideSign, deck + 1.2];
        scene.limb([6.5 * k, 0, deck + 1.4], armTip, 1.9, 1.2, rgb(DARK_WOOD), { flat: true, bias: 0.05 });
        scene.limb(armTip, nock, 0.6, 0.6, rgb(0xe8e4d8), { flat: true, bias: 0.05 });
      }
      if (animation !== 'attack' || t < 0.6) {
        scene.limb(nock, [nock[0] + 12 * k, 0, nock[2] + 1.2], 1.2, 0.8, rgb(0xd8d2c0), { flat: true, bias: 0.06 });
      }
      if (!housing) {
        pennant(scene, [-7 * k, 0, 5.8 * k], 9);
      }
    },
  };
}

type Cargo = 'none' | 'crates' | 'net' | 'canopy' | 'catapult';

interface ShipLook {
  length: number;
  beam: number;
  height: number;
  hull: number;
  mast: number;
  oars: number;
  ram: boolean;
  cargo: Cargo;
}

function hullShape(length: number, beam: number): P2[] {
  return [
    [length, 0],
    [length * 0.55, beam],
    [-length * 0.8, beam],
    [-length, beam * 0.5],
    [-length, -beam * 0.5],
    [-length * 0.8, -beam],
    [length * 0.55, -beam],
  ];
}

function ship(id: string, look: ShipLook): UnitSpec {
  const { length, beam, height } = look;
  const hull = rgb(look.hull, 1, 0.05);
  const deck = rgb(0xb89362, 1, 0.05);
  const hasOars = look.oars > 0;
  return {
    id,
    canvas: [136, 128, 68, 88],
    death: 'sink',
    shadow: null,
    footprint: [length, beam],
    animations: { idle: 4, walk: hasOars ? 6 : 4, attack: look.cargo === 'catapult' ? 8 : 4, die: 5, decay: 2 },
    build(scene, animation, t) {
      const bob = animation === 'dead' ? 0 : Math.sin(t * TAU) * 0.6;
      const tilt = animation === 'dead' ? 0 : Math.cos(t * TAU) * 0.05;
      scene.push((p) => [p[0], p[1] + p[2] * tilt, p[2] + bob]);
      const shape = hullShape(length, beam);
      scene.prism(shape, -1.5, height - 1.6, hull, deck, { bottomScale: 0.78 });
      scene.prism(shape, height - 1.6, height, team(0.85), deck, { bias: 0.01 });
      if (look.ram) {
        scene.limb([length - 1, 0, 1.2], [length + 4.5, 0, 0.4], 2.6, 1, rgb(BRONZE), { flat: true });
      }
      const sweep = animation === 'walk' ? Math.sin(t * TAU) : 0.2;
      const dip = animation === 'walk' ? Math.max(0, Math.cos(t * TAU)) * 2 : 0;
      for (let i = 0; i < look.oars; i += 1) {
        const f = -length * 0.6 + ((i + 0.5) / look.oars) * length * 1.1;
        for (const sideSign of [-1, 1]) {
          scene.limb(
            [f, beam * sideSign, height - 0.8],
            [f - 1 - sweep * 3, (beam + 6) * sideSign, 0.2 + dip],
            1,
            1,
            rgb(LIGHT_WOOD),
            { flat: true, bias: sideSign * 0.3 },
          );
        }
      }
      const aft = -length * 0.5;
      switch (look.cargo) {
        case 'crates':
          scene.prism(rect(aft - 3, aft + 3, 2.6), height, height + 4, rgb(LIGHT_WOOD), rgb(0xc8a474), { bias: 0.3 });
          scene.prism(rect(aft + 4, aft + 8, 2), height, height + 3, rgb(LEATHER), rgb(0xa87850), { bias: 0.3 });
          break;
        case 'net':
          scene.ball([aft, 0, height + 1.8], 3, rgb(0xcfc8b4, 1, 0.2), { bias: 0.3 });
          break;
        case 'canopy':
          for (const f of [aft - 4, aft + 5]) {
            for (const l of [-beam * 0.7, beam * 0.7]) {
              scene.limb([f, l, height], [f, l, height + 6], 1, 1, rgb(DARK_WOOD), { flat: true, bias: 0.3 });
            }
          }
          scene.prism(rect(aft - 5, aft + 6, beam * 0.85), height + 6, height + 7.4, team(0.7), team(0.95), {
            bias: 0.4,
          });
          break;
        case 'catapult': {
          const pivot: P3 = [length * 0.25, 0, height + 6];
          const angle = animation === 'attack' ? throwAngle(t) : 3.6;
          scene.limb([pivot[0] - 2, 0, height], pivot, 1.8, 1.8, rgb(DARK_WOOD), { flat: true, bias: 0.3 });
          scene.limb([pivot[0] + 2, 0, height], pivot, 1.8, 1.8, rgb(DARK_WOOD), { flat: true, bias: 0.3 });
          const tip: P3 = [pivot[0] + Math.cos(angle) * 8, 0, pivot[2] + Math.sin(angle) * 8];
          scene.limb(pivot, tip, 1.8, 1.4, rgb(LIGHT_WOOD), { flat: true, bias: 0.35 });
          scene.ball(tip, 1.9, rgb(STONE), { bias: 0.36 });
          break;
        }
        case 'none':
          break;
      }
      if (look.mast > 0) {
        const top = height + look.mast;
        const span = beam + 3;
        const sail = (l: number, u: number): P3 => [1.5 + l * 0.45 + (1 - (l / span) ** 2) * 1.6, l, u];
        scene.limb([1, 0, height], [1, 0, top + 1.5], 1.9, 1.5, rgb(DARK_WOOD), { flat: true, bias: 0.5 });
        scene.limb(sail(-span, top), sail(span, top), 1.3, 1.3, rgb(DARK_WOOD), { flat: true, bias: 0.6 });
        const low = height + 3.5;
        const bands: [number, number, Paint][] = [
          [-span, -span * 0.3, rgb(0xe8dfc6)],
          [-span * 0.3, span * 0.3, team(0.9)],
          [span * 0.3, span, rgb(0xe8dfc6)],
        ];
        for (const [from, to, paint] of bands) {
          scene.poly([sail(from, low), sail(to, low), sail(to, top), sail(from, top)], paint, { bias: 0.7 });
        }
      }
      pennant(scene, [-length + 1.5, 0, height], look.mast > 0 ? 8 : 11);
      scene.pop();
    },
  };
}

function animal(
  id: string,
  canvas: [number, number, number, number],
  shadow: [number, number],
  attacks: boolean,
  build: (scene: Scene, gait: number | null, attack: number) => void,
): UnitSpec {
  const animations: Record<string, number> = attacks
    ? { idle: 1, walk: 8, attack: 6, die: 4, decay: 3 }
    : { idle: 1, walk: 8, die: 4, decay: 3 };
  return {
    id,
    canvas,
    death: 'roll',
    shadow,
    animations,
    build(scene, animation, t) {
      build(scene, animation === 'walk' ? t : null, animation === 'attack' ? Math.sin(t * Math.PI) : 0);
    },
  };
}

const BARE = rgb(SKIN);
const TUNIC = team(0.8);
const BRONZE_PLATE = rgb(BRONZE);
const IRON_PLATE = rgb(IRON);

export function unitSpecs(): UnitSpec[] {
  const brown: HorseLook = { coat: 0x8a5a36, mane: 0x2a1c12 };
  const bay: HorseLook = { coat: 0x6e4428, mane: 0x1e140c, cloth: team(0.8) };
  const grey: HorseLook = { coat: 0xa8a49c, mane: 0x4a4640, cloth: team(0.8) };
  const armored: HorseLook = { coat: 0x5a4030, mane: 0x1e140c, cloth: team(0.8), armor: rgb(0x9aa2aa, 1, 0.12) };
  const shipWood = 0x7a5232;
  const darkShip = 0x5c3c26;
  return [
    villager(),
    soldier('clubman', { skin: SKIN, hair: HAIR, torso: BARE, skirt: TUNIC, weapon: 'club', reach: 7 }, 'swing'),
    soldier('axeman', { skin: SKIN_DARK, hair: HAIR, torso: rgb(LEATHER), skirt: TUNIC, weapon: 'axe', reach: 8 }, 'swing'),
    soldier(
      'short_swordsman',
      {
        skin: SKIN,
        hair: HAIR,
        torso: TUNIC,
        skirt: rgb(LINEN),
        weapon: 'sword',
        reach: 7,
        shield: { radius: 3.6, paint: rgb(LEATHER) },
      },
      'swing',
    ),
    soldier(
      'broad_swordsman',
      {
        skin: SKIN,
        hair: HAIR,
        torso: TUNIC,
        skirt: rgb(LINEN),
        helmet: BRONZE_PLATE,
        weapon: 'sword',
        reach: 8,
        shield: { radius: 4.4, paint: team(0.95) },
      },
      'swing',
    ),
    soldier(
      'long_swordsman',
      {
        skin: SKIN,
        hair: HAIR,
        torso: BRONZE_PLATE,
        skirt: TUNIC,
        helmet: BRONZE_PLATE,
        crest: team(1),
        weapon: 'sword',
        reach: 9.5,
        shield: { radius: 4.6, paint: team(0.95) },
      },
      'swing',
    ),
    soldier(
      'legion',
      {
        skin: SKIN,
        hair: HAIR,
        torso: IRON_PLATE,
        skirt: TUNIC,
        helmet: IRON_PLATE,
        crest: team(1),
        weapon: 'sword',
        reach: 8,
        shield: { radius: 4.6, paint: team(0.95), tall: true },
      },
      'swing',
    ),
    soldier(
      'hoplite',
      {
        skin: SKIN,
        hair: HAIR,
        torso: BRONZE_PLATE,
        skirt: TUNIC,
        helmet: BRONZE_PLATE,
        crest: team(1),
        weapon: 'spear',
        reach: 20,
        shield: { radius: 5.2, paint: team(0.95) },
      },
      'thrust',
    ),
    soldier(
      'phalanx',
      {
        skin: SKIN,
        hair: HAIR,
        torso: IRON_PLATE,
        skirt: TUNIC,
        helmet: IRON_PLATE,
        crest: team(1),
        weapon: 'spear',
        reach: 25,
        shield: { radius: 5.4, paint: team(0.95) },
      },
      'thrust',
    ),
    soldier(
      'centurion',
      {
        skin: SKIN,
        hair: HAIR,
        torso: IRON_PLATE,
        skirt: TUNIC,
        helmet: rgb(0xe0c060),
        crest: team(1),
        cape: team(0.7),
        weapon: 'spear',
        reach: 25,
        shield: { radius: 5.6, paint: team(0.95) },
      },
      'thrust',
    ),
    soldier('bowman', { skin: SKIN_DARK, hair: HAIR, torso: BARE, skirt: TUNIC, weapon: 'bow' }, 'shoot'),
    soldier(
      'improved_bowman',
      { skin: SKIN, hair: HAIR, torso: TUNIC, skirt: rgb(LINEN), weapon: 'bow', quiver: true },
      'shoot',
    ),
    soldier(
      'composite_bowman',
      { skin: SKIN, hair: HAIR, torso: TUNIC, skirt: rgb(LEATHER), helmet: BRONZE_PLATE, weapon: 'bow', quiver: true },
      'shoot',
    ),
    priest(),
    rider('scout', brown, { skin: SKIN, hair: HAIR, torso: TUNIC, skirt: TUNIC, weapon: 'club', reach: 6 }, 'swing'),
    rider(
      'cavalry',
      bay,
      { skin: SKIN, hair: HAIR, torso: TUNIC, skirt: TUNIC, helmet: BRONZE_PLATE, weapon: 'sword', reach: 9 },
      'swing',
    ),
    rider(
      'heavy_cavalry',
      grey,
      {
        skin: SKIN,
        hair: HAIR,
        torso: IRON_PLATE,
        skirt: TUNIC,
        helmet: IRON_PLATE,
        crest: team(1),
        weapon: 'sword',
        reach: 10,
      },
      'swing',
    ),
    rider(
      'cataphract',
      armored,
      {
        skin: SKIN,
        hair: HAIR,
        torso: IRON_PLATE,
        skirt: TUNIC,
        helmet: IRON_PLATE,
        crest: team(1),
        cape: team(0.7),
        weapon: 'spear',
        reach: 22,
      },
      'thrust',
    ),
    chariot('chariot', { skin: SKIN, hair: HAIR, torso: TUNIC, helmet: BRONZE_PLATE, weapon: 'spear', reach: 20 }, 'thrust'),
    elephantRider(
      'war_elephant',
      { skin: SKIN_DARK, hair: HAIR, torso: TUNIC, skirt: TUNIC, helmet: BRONZE_PLATE, weapon: 'spear', reach: 20 },
      'thrust',
      false,
    ),
    chariot('chariot_archer', { skin: SKIN, hair: HAIR, torso: TUNIC, weapon: 'bow', quiver: true }, 'shoot'),
    elephantRider(
      'elephant_archer',
      { skin: SKIN_DARK, hair: HAIR, torso: TUNIC, helmet: BRONZE_PLATE, weapon: 'bow', quiver: true },
      'shoot',
      true,
    ),
    rider('horse_archer', brown, { skin: SKIN, hair: HAIR, torso: TUNIC, skirt: TUNIC, weapon: 'bow', quiver: true }, 'shoot'),
    rider(
      'heavy_horse_archer',
      grey,
      { skin: SKIN, hair: HAIR, torso: IRON_PLATE, skirt: TUNIC, helmet: IRON_PLATE, crest: team(1), weapon: 'bow', quiver: true },
      'shoot',
    ),
    thrower('stone_thrower', 0.9, 0x8a6238, false),
    thrower('catapult', 1.05, 0x7a5230, false),
    thrower('heavy_catapult', 1.2, 0x5e4028, true),
    ballista('ballista', 1, false),
    ballista('helepolis', 1.2, true),
    ship('fishing_boat', { length: 13, beam: 4.4, height: 4, hull: shipWood, mast: 0, oars: 2, ram: false, cargo: 'net' }),
    ship('fishing_ship', { length: 16, beam: 5, height: 4.6, hull: shipWood, mast: 20, oars: 0, ram: false, cargo: 'net' }),
    ship('trade_boat', { length: 15, beam: 5, height: 4.6, hull: shipWood, mast: 20, oars: 0, ram: false, cargo: 'crates' }),
    ship('merchant_ship', { length: 20, beam: 6.6, height: 5.4, hull: darkShip, mast: 26, oars: 0, ram: false, cargo: 'crates' }),
    ship('light_transport', { length: 17, beam: 6.4, height: 4.8, hull: shipWood, mast: 0, oars: 3, ram: false, cargo: 'canopy' }),
    ship('heavy_transport', { length: 22, beam: 8, height: 5.6, hull: darkShip, mast: 0, oars: 4, ram: false, cargo: 'canopy' }),
    ship('scout_ship', { length: 16, beam: 4.4, height: 4.4, hull: shipWood, mast: 20, oars: 0, ram: false, cargo: 'none' }),
    ship('war_galley', { length: 20, beam: 5, height: 5, hull: shipWood, mast: 22, oars: 4, ram: true, cargo: 'none' }),
    ship('trireme', { length: 24, beam: 5.6, height: 5.6, hull: darkShip, mast: 26, oars: 6, ram: true, cargo: 'none' }),
    ship('catapult_trireme', { length: 24, beam: 6.2, height: 5.6, hull: darkShip, mast: 0, oars: 5, ram: true, cargo: 'catapult' }),
    ship('juggernaut', { length: 27, beam: 7.2, height: 6.4, hull: 0x4a3222, mast: 0, oars: 6, ram: true, cargo: 'catapult' }),
    animal('gazelle', [72, 64, 36, 44], [9, 3.4], false, (scene, gait) => gazelle(scene, gait)),
    animal('elephant', [120, 96, 60, 70], [22, 8], true, (scene, gait, attack) =>
      elephant(scene, 0x8c8a86, gait, null, attack),
    ),
    animal('lion', [80, 64, 40, 44], [12, 4.4], true, lion),
    animal('alligator', [88, 56, 44, 34], [15, 5], true, alligator),
  ];
}
