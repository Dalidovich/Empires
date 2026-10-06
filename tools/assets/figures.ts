import { lighten, rgb, team } from './raster';
import type { Paint } from './raster';
import { add, lerp } from './scene';
import type { P3, Scene } from './scene';

export type WeaponKind =
  | 'club'
  | 'axe'
  | 'sword'
  | 'spear'
  | 'bow'
  | 'staff'
  | 'pick'
  | 'hoe'
  | 'hammer'
  | 'rod'
  | 'basket';

export type Load = 'food' | 'wood' | 'stone' | 'gold';

export interface ShieldLook {
  radius: number;
  paint: Paint;
  tall?: boolean;
}

export interface HumanLook {
  skin: number;
  hair: number;
  torso: Paint;
  skirt?: Paint;
  robe?: Paint;
  helmet?: Paint;
  crest?: Paint;
  cape?: Paint;
  shield?: ShieldLook;
  weapon?: WeaponKind;
  reach?: number;
  quiver?: boolean;
}

export interface HumanPose {
  breathe?: number;
  walk?: number;
  swing?: number;
  thrust?: number;
  shoot?: number;
  pray?: number;
  reach?: number;
  carry?: Load;
  seat?: boolean;
}

export const WOOD = 0x6e4a2a;
export const DARK_WOOD = 0x4e3520;
export const LIGHT_WOOD = 0xa87c4a;
export const STONE = 0x9c9a94;
export const BRONZE = 0xc28a3a;
export const IRON = 0xb4bcc6;
export const GOLD = 0xe8c040;
export const LINEN = 0xe6dcc0;
export const LEATHER = 0x8a5a34;

const TAU = Math.PI * 2;

function swingAngle(t: number): number {
  if (t < 0.4) {
    return lerp(1.2, 2.2, t / 0.4);
  }
  if (t < 0.6) {
    return lerp(2.2, -0.3, (t - 0.4) / 0.2);
  }
  return lerp(-0.3, 1.2, (t - 0.6) / 0.4);
}

function thrustReach(t: number): number {
  if (t < 0.3) {
    return lerp(-1, -3, t / 0.3);
  }
  if (t < 0.5) {
    return lerp(-3, 6, (t - 0.3) / 0.2);
  }
  return lerp(6, -1, (t - 0.5) / 0.5);
}

function drawWeapon(scene: Scene, kind: WeaponKind, hand: P3, dir: P3, length: number): void {
  const at = (k: number): P3 => [hand[0] + dir[0] * k, hand[1] + dir[1] * k, hand[2] + dir[2] * k];
  const perp: P3 = [-dir[2], 0, dir[0]];
  const side = (p: P3, k: number): P3 => [p[0] + perp[0] * k, p[1], p[2] + perp[2] * k];
  const wood = rgb(WOOD);
  const metal = rgb(0xd4dae0);
  const stone = rgb(STONE);
  const flat = { flat: true };
  switch (kind) {
    case 'club':
      scene.limb(at(-1), at(length), 1.6, 3.6, rgb(LEATHER), flat);
      break;
    case 'axe':
      scene.limb(at(-1.5), at(length), 1.3, 1.3, wood, flat);
      scene.limb(side(at(length - 1), -0.5), side(at(length - 1), 2.6), 3, 2.2, stone, flat);
      break;
    case 'pick':
      scene.limb(at(-1.5), at(length), 1.3, 1.3, wood, flat);
      scene.limb(side(at(length), -2.8), side(at(length), 2.8), 1.5, 1.1, stone, flat);
      break;
    case 'hoe':
      scene.limb(at(-1.5), at(length), 1.3, 1.3, wood, flat);
      scene.limb(at(length), side(at(length), -3), 2.2, 1.6, stone, flat);
      break;
    case 'hammer':
      scene.limb(at(-1), at(length), 1.3, 1.3, wood, flat);
      scene.limb(side(at(length), -1.7), side(at(length), 1.7), 3, 3, stone, flat);
      break;
    case 'sword':
      scene.limb(at(1), at(length), 2.3, 1.5, metal, flat);
      scene.ball(at(0.8), 1.3, rgb(BRONZE), flat);
      break;
    case 'spear':
      scene.limb(at(-length * 0.4), at(length * 0.6), 1.2, 1.2, wood, flat);
      scene.limb(at(length * 0.6), at(length * 0.6 + 3.2), 2, 0.6, metal, flat);
      break;
    case 'staff':
      scene.limb(at(-length * 0.45), at(length * 0.55), 1.3, 1.3, wood, flat);
      scene.ball(at(length * 0.55 + 1), 1.9, rgb(GOLD));
      break;
    case 'rod': {
      scene.limb(at(-1), at(length), 1.1, 0.8, wood, flat);
      const tip = at(length);
      scene.limb(tip, [tip[0] + 1, tip[1], Math.max(0.5, tip[2] - length)], 0.6, 0.6, rgb(0xe8e8e8), flat);
      break;
    }
    case 'basket':
      scene.ball(at(1.5), 2.6, rgb(LIGHT_WOOD));
      break;
    case 'bow':
      break;
  }
}

function drawLoad(scene: Scene, load: Load, at: P3): void {
  switch (load) {
    case 'food':
      scene.ball(at, 3.1, rgb(0xa8452f));
      scene.ball(add(at, [0.5, 0.5, 1.2]), 1.4, rgb(0xe8d8c0), { flat: true });
      break;
    case 'wood':
      scene.limb(add(at, [-5.5, 0, 0]), add(at, [5.5, 0, 0]), 3.6, 3.6, rgb(0x7a5230));
      scene.ball(add(at, [5.5, 0, 0]), 1.7, rgb(0xd0a870), { flat: true, bias: 0.2 });
      scene.ball(add(at, [-5.5, 0, 0]), 1.7, rgb(0xd0a870), { flat: true, bias: 0.2 });
      break;
    case 'stone':
      scene.ball(at, 3.3, rgb(0xa9a9a4));
      break;
    case 'gold':
      scene.ball(at, 3, rgb(GOLD));
      break;
  }
}

export function human(scene: Scene, look: HumanLook, pose: HumanPose, origin: P3 = [0, 0, 0]): void {
  const P = (f: number, l: number, u: number): P3 => [origin[0] + f, origin[1] + l, origin[2] + u];
  const skin = rgb(look.skin);
  const seat = pose.seat === true;
  const hipU = seat ? 0 : 9.5;
  const walking = pose.walk !== undefined;
  const s = walking ? Math.sin((pose.walk ?? 0) * TAU) : 0;
  const c = walking ? Math.cos((pose.walk ?? 0) * TAU) : 0;
  const breath = pose.breathe !== undefined ? Math.sin(pose.breathe * TAU) * 0.45 : 0;
  const bob = walking ? Math.abs(c) * 0.7 : breath;
  let leanF = 0;
  let leanU = 0;
  if (pose.reach !== undefined) {
    leanF = 3.5 + Math.sin(pose.reach * TAU) * 1.2;
    leanU = 2;
  } else if (pose.swing !== undefined) {
    leanF = pose.swing > 0.4 && pose.swing < 0.75 ? 1.6 : 0;
  } else if (pose.thrust !== undefined) {
    leanF = Math.max(0, thrustReach(pose.thrust)) * 0.3;
  }
  const shoulderU = hipU + 7.8 - leanU + bob;
  const center = P(leanF, 0, shoulderU);

  if (seat) {
    for (const sideSign of [-1, 1]) {
      scene.limb(P(0, 2.4 * sideSign, 0.5), P(2, 4.6 * sideSign, -6), 3.1, 2.4, skin);
    }
  } else if (look.robe) {
    scene.ball(P(1 + s * 1.5, 1.8, 0.8), 1.4, rgb(LEATHER), { flat: true });
    scene.ball(P(1 - s * 1.5, -1.8, 0.8), 1.4, rgb(LEATHER), { flat: true });
    scene.limb(P(0, 0, 2.2), P(0, 0, hipU + 6), 10, 7.6, look.robe);
  } else {
    const stride = 4.2;
    const feet: [number, number, number][] = [
      [s * stride, 2.2, Math.max(0, c) * 1.8],
      [-s * stride, -2.2, Math.max(0, -c) * 1.8],
    ];
    for (const [footF, footL, footU] of feet) {
      scene.limb(P(0, footL * 0.9, hipU), P(footF, footL, footU + 1), 3.3, 2.5, skin);
      scene.ball(P(footF + 0.8, footL, footU + 0.9), 1.5, rgb(LEATHER), { flat: true });
    }
  }
  if (look.cape) {
    scene.limb(add(center, [-2.4, 0, -0.5]), P(-3.2 - Math.abs(s), 0, hipU - 4), 7, 8.4, look.cape, { flat: true });
  }
  if (look.skirt && !look.robe) {
    scene.limb(P(0, 0, hipU + 1), P(0, 0, hipU - 2.6), 7.8, 8.6, look.skirt);
  }
  scene.limb(P(0, 0, hipU + 0.8), add(center, [0, 0, -1.2]), 8, 9, look.torso);
  if (look.quiver) {
    scene.limb(add(center, [-2.8, 1.5, 2]), add(center, [-2.8, -1.2, -5]), 2.4, 2.4, rgb(LEATHER), { flat: true });
  }

  const head = add(center, [leanF * 0.3 + 0.3, 0, 4.6]);
  scene.ball(head, 3.8, skin);
  if (look.helmet) {
    scene.ball(add(head, [-1.2, 0, 0.3]), 3.7, look.helmet, { flat: true });
    scene.dome(add(head, [-0.2, 0, 0.5]), 4.4, look.helmet);
    if (look.crest) {
      scene.limb(add(head, [-2.6, 0, 3.6]), add(head, [2, 0, 4.4]), 2.4, 2.4, look.crest, { flat: true });
    }
  } else {
    scene.ball(add(head, [-1.1, 0, 0.5]), 3.6, rgb(look.hair), { flat: true });
    scene.dome(add(head, [-0.3, 0, 0.5]), 4, rgb(look.hair), { flat: true });
  }

  const right = add(center, [0, 5, -0.8]);
  const left = add(center, [0, -5, -0.8]);
  let rightHand: P3 = P(-s * 3, 5.2, hipU + 1.5 + bob);
  let leftHand: P3 = P(s * 3, -5.2, hipU + 1.5 + bob);
  let weaponDir: P3 = [0.45, 0, 0.9];
  const kind = look.weapon;
  const length = look.reach ?? 8;
  if (kind === 'spear' || kind === 'staff') {
    weaponDir = [0.08, 0, 1];
    rightHand = P(1.5 - s * 1.5, 5.2, hipU + 4 + bob);
  }
  if (pose.swing !== undefined) {
    const angle = swingAngle(pose.swing);
    rightHand = add(right, [Math.cos(angle) * 5.2, 0.6, Math.sin(angle) * 5.2]);
    weaponDir = [Math.cos(angle - 0.2), 0, Math.sin(angle - 0.2)];
  } else if (pose.thrust !== undefined) {
    rightHand = add(right, [thrustReach(pose.thrust), 0.5, -3]);
    weaponDir = [1, 0, 0.04];
  } else if (pose.pray !== undefined) {
    const wave = Math.sin(pose.pray * TAU) * 1.4;
    rightHand = add(right, [3, 0, 5 + wave]);
    leftHand = add(left, [3, 0, 5 - wave]);
    weaponDir = [0.1, 0, 1];
  } else if (pose.reach !== undefined) {
    const dip = Math.sin(pose.reach * TAU) * 2;
    rightHand = P(leanF + 4, 2.6, hipU - 2 + dip);
    leftHand = P(leanF + 4, -2.6, hipU - 2 - dip);
    weaponDir = [0.9, 0, -0.4];
  } else if (pose.carry) {
    rightHand = add(right, [0.6, -0.4, 4]);
  }

  if (kind === 'bow') {
    const shooting = pose.shoot !== undefined;
    const draw = shooting && (pose.shoot ?? 0) < 0.65 ? (pose.shoot ?? 0) / 0.65 : 0;
    if (shooting) {
      leftHand = add(left, [6.5, 1.5, 0.4]);
      rightHand = add(center, [2 - draw * 5, 3, -0.6]);
    } else {
      leftHand = P(2 + s * 2, -5.4, hipU + 4 + bob);
    }
    const bowColor = rgb(WOOD);
    const tipTop = add(leftHand, [-2.6, 0, 6.5]);
    const tipBottom = add(leftHand, [-2.6, 0, -6.5]);
    scene.limb(tipTop, add(leftHand, [0, 0, 2.5]), 1, 1.5, bowColor, { flat: true });
    scene.limb(add(leftHand, [0, 0, 2.5]), add(leftHand, [0, 0, -2.5]), 1.5, 1.5, bowColor, { flat: true });
    scene.limb(add(leftHand, [0, 0, -2.5]), tipBottom, 1.5, 1, bowColor, { flat: true });
    const stringPaint = rgb(0xe8e4d8);
    if (draw > 0) {
      scene.limb(tipTop, rightHand, 0.6, 0.6, stringPaint, { flat: true });
      scene.limb(rightHand, tipBottom, 0.6, 0.6, stringPaint, { flat: true });
      scene.limb(rightHand, add(leftHand, [2.5, 0, 0]), 0.9, 0.9, rgb(LIGHT_WOOD), { flat: true });
    } else {
      scene.limb(tipTop, tipBottom, 0.6, 0.6, stringPaint, { flat: true });
    }
  } else if (kind) {
    drawWeapon(scene, kind, rightHand, weaponDir, length);
  }
  if (pose.carry) {
    drawLoad(scene, pose.carry, add(center, [0, 3.6, 3.8]));
  }

  scene.limb(right, rightHand, 2.8, 2.5, skin, { flat: true });
  scene.limb(left, leftHand, 2.8, 2.5, skin, { flat: true });

  if (look.shield) {
    const shield = look.shield;
    const anchor = add(leftHand, [1.2, -0.8, 2.6]);
    const points: P3[] = [];
    if (shield.tall) {
      const half = shield.radius * 0.72;
      for (const [k, v] of [
        [-1, -1.25],
        [1, -1.25],
        [1, 1.25],
        [-1, 1.25],
      ]) {
        points.push(add(anchor, [0.8 * half * k, 0.6 * half * k, shield.radius * v]));
      }
    } else {
      for (let i = 0; i < 16; i += 1) {
        const angle = (i / 16) * TAU;
        const along = Math.cos(angle) * shield.radius;
        points.push(add(anchor, [0.8 * along, 0.6 * along, Math.sin(angle) * shield.radius]));
      }
    }
    scene.poly(points, shield.paint, { bias: -0.6 });
    scene.ball(add(anchor, [0.4, -0.6, 0]), 1.3, rgb(BRONZE), { flat: true, bias: -0.5 });
  }
}

export interface HorseLook {
  coat: number;
  mane: number;
  cloth?: Paint;
  armor?: Paint;
}

function gaitFeet(gait: number | null, reach: number, lift: number): [number, number, number, number] {
  if (gait === null) {
    return [0, 0, 0, 0];
  }
  const s = Math.sin(gait * TAU);
  const c = Math.cos(gait * TAU);
  return [s * reach, Math.max(0, c) * lift, -s * reach, Math.max(0, -c) * lift];
}

export function horse(scene: Scene, look: HorseLook, gait: number | null, origin: P3 = [0, 0, 0]): void {
  const P = (f: number, l: number, u: number): P3 => [origin[0] + f, origin[1] + l, origin[2] + u];
  const coat = rgb(look.coat);
  const dark = lighten(coat, 0.72);
  const [fa, ua, fb, ub] = gaitFeet(gait, 3.6, 2.2);
  const bob = gait === null ? 0 : Math.abs(Math.cos(gait * TAU)) * 0.6;
  const legs: [number, number, number, number][] = [
    [5.5, 2.4, fa, ua],
    [5.5, -2.4, fb, ub],
    [-5.5, 2.4, fb, ub],
    [-5.5, -2.4, fa, ua],
  ];
  for (const [hipF, hipL, shift, lift] of legs) {
    scene.limb(P(hipF, hipL, 10.5), P(hipF + shift, hipL, lift + 1), 2.8, 1.9, dark);
    scene.ball(P(hipF + shift, hipL, lift + 0.8), 1.3, rgb(0x2a2018), { flat: true });
  }
  scene.limb(P(-7.5, 0, 12.5 + bob), P(-11, 0, 6.5), 2.6, 1, rgb(look.mane), { flat: true });
  scene.limb(P(-6, 0, 12.5 + bob), P(6, 0, 13 + bob), 8.6, 8.2, look.armor ?? coat);
  if (look.cloth) {
    scene.limb(P(-3.2, 0, 13.2 + bob), P(2.6, 0, 13.4 + bob), 9.6, 9.6, look.cloth);
  }
  scene.limb(P(6, 0, 14 + bob), P(10, 0, 20 + bob), 5.2, 3.8, look.armor ?? coat);
  scene.limb(P(5.2, 0, 16.5 + bob), P(8.8, 0, 22 + bob), 2, 2, rgb(look.mane), { flat: true });
  scene.limb(P(9.8, 0, 20.8 + bob), P(14, 0, 18.6 + bob), 3.8, 2.6, coat);
  scene.ball(P(9.6, 1.1, 23 + bob), 0.9, dark, { flat: true });
  scene.ball(P(9.6, -1.1, 23 + bob), 0.9, dark, { flat: true });
}

export const SADDLE: P3 = [-0.5, 0, 16.6];

export function elephant(scene: Scene, hide: number, gait: number | null, cloth: Paint | null, attack = 0): void {
  const skin = rgb(hide);
  const dark = lighten(skin, 0.78);
  const [fa, ua, fb, ub] = gaitFeet(gait, 2.6, 1.6);
  const bob = gait === null ? 0 : Math.abs(Math.cos(gait * TAU)) * 0.5;
  const legs: [number, number, number, number][] = [
    [7, 4.6, fa, ua],
    [7, -4.6, fb, ub],
    [-7, 4.6, fb, ub],
    [-7, -4.6, fa, ua],
  ];
  for (const [hipF, hipL, shift, lift] of legs) {
    scene.limb([hipF, hipL, 12], [hipF + shift, hipL, lift + 2.4], 6, 5.4, dark);
  }
  scene.limb([-12, 0, 17 + bob], [-14, 0, 9], 1.3, 0.9, dark, { flat: true });
  scene.limb([-8, 0, 17 + bob], [7, 0, 18 + bob], 17, 16, skin);
  if (cloth) {
    scene.limb([-5, 0, 19.5 + bob], [3, 0, 20 + bob], 16.6, 16.6, cloth);
  }
  const lift = attack * 5;
  scene.ball([10.5, 6.6, 21 + bob], 4.6, dark);
  scene.ball([10.5, -6.6, 21 + bob], 4.6, dark);
  scene.ball([12.5, 0, 20.5 + bob + lift * 0.3], 7.2, skin);
  scene.limb([17, 0, 19 + bob + lift * 0.3], [20, 0, 12 + lift], 4.4, 3.2, skin);
  scene.limb([20, 0, 12 + lift], [19.5 + attack * 3, 0, 5 + lift * 1.6], 3.2, 2.2, skin);
  for (const sideSign of [-1, 1]) {
    scene.limb([15.5, 3 * sideSign, 15.5 + bob], [20.5, 3.6 * sideSign, 13 + lift * 0.5], 1.9, 1, rgb(0xf0ead8), {
      flat: true,
    });
  }
}

export const HOWDAH: P3 = [-1, 0, 26.5];

export function gazelle(scene: Scene, gait: number | null): void {
  const coat = rgb(0xc89a5a);
  const belly = rgb(0xeee2c8);
  const [fa, ua, fb, ub] = gaitFeet(gait, 3.4, 2.4);
  const bob = gait === null ? 0 : Math.abs(Math.cos(gait * TAU)) * 0.8;
  const legs: [number, number, number, number][] = [
    [4, 1.5, fa, ua],
    [4, -1.5, fb, ub],
    [-4, 1.5, fb, ub],
    [-4, -1.5, fa, ua],
  ];
  for (const [hipF, hipL, shift, lift] of legs) {
    scene.limb([hipF, hipL, 9], [hipF + shift, hipL, lift + 0.6], 1.7, 1.1, coat, { flat: true });
  }
  scene.limb([-4.5, 0, 9.4 + bob], [4, 0, 9.8 + bob], 4.6, 4.6, belly);
  scene.limb([-4.5, 0, 10.6 + bob], [4, 0, 11 + bob], 4.8, 4.8, coat);
  scene.ball([-6.4, 0, 11 + bob], 1.3, belly, { flat: true });
  scene.limb([4.5, 0, 11.5 + bob], [6.8, 0, 16 + bob], 2.8, 2.2, coat);
  scene.limb([6.6, 0, 16.6 + bob], [9.4, 0, 15.6 + bob], 2.9, 1.9, coat);
  for (const sideSign of [-1, 1]) {
    scene.limb([6.4, 0.9 * sideSign, 18 + bob], [5, 1.4 * sideSign, 22.5 + bob], 0.9, 0.6, rgb(0x3a2c1e), {
      flat: true,
    });
  }
}

export function lion(scene: Scene, gait: number | null, attack = 0): void {
  const coat = rgb(0xd2a85a);
  const mane = rgb(0x8a5a2a);
  const [fa, ua, fb, ub] = gaitFeet(gait, 3.2, 1.8);
  const bob = gait === null ? 0 : Math.abs(Math.cos(gait * TAU)) * 0.6;
  const lunge = attack * 3;
  const legs: [number, number, number, number][] = [
    [4.5, 2.2, fa + lunge, ua],
    [4.5, -2.2, fb + lunge, ub],
    [-5, 2.2, fb, ub],
    [-5, -2.2, fa, ua],
  ];
  for (const [hipF, hipL, shift, lift] of legs) {
    scene.limb([hipF, hipL, 8], [hipF + shift, hipL, lift + 1], 2.8, 2.2, lighten(coat, 0.85));
  }
  scene.limb([-7, 0, 9 + bob], [-11, 0, 5], 1.4, 1.2, coat, { flat: true });
  scene.ball([-11.2, 0, 4.8], 1.4, mane, { flat: true });
  scene.limb([-5.5, 0, 9 + bob], [4.5 + lunge, 0, 9.6 + bob], 6.6, 6.8, coat);
  scene.ball([6 + lunge, 0, 12 + bob], 5.2, mane);
  scene.ball([8.2 + lunge, 0, 12.4 + bob + attack], 3.5, coat);
  scene.ball([10.6 + lunge, 0, 11.4 + bob + attack], 1.6, lighten(coat, 1.1), { flat: true });
}

export function alligator(scene: Scene, gait: number | null, attack = 0): void {
  const hide = rgb(0x5a7a3a, 1, 0.1);
  const dark = rgb(0x44602c);
  const sway = gait === null ? 0 : Math.sin(gait * TAU);
  const legs: [number, number, number][] = [
    [5, 1, sway],
    [5, -1, -sway],
    [-5, 1, -sway],
    [-5, -1, sway],
  ];
  for (const [hipF, sideSign, shift] of legs) {
    scene.limb([hipF, 2.6 * sideSign, 2.4], [hipF + 1 + shift * 1.8, 5.6 * sideSign, 0.8], 2.2, 1.6, dark, {
      flat: true,
    });
  }
  scene.limb([-7, 0, 2.6], [-13, sway * 2, 2], 4.6, 2.6, hide);
  scene.limb([-13, sway * 2, 2], [-18, -sway * 2.4, 1.4], 2.6, 0.9, hide);
  scene.limb([-7, 0, 2.9], [6, 0, 2.9], 6.4, 6, hide);
  scene.limb([6, 0, 3], [9, 0, 3.1], 5, 4.4, hide);
  scene.limb([9, 0, 2.2], [15, 0, 1.6], 3.6, 2.4, rgb(0x6a8a48));
  scene.limb([9, 0, 3.6 + attack], [15, 0, 2.8 + attack * 4.5], 3.4, 2.2, hide);
  if (attack > 0.3) {
    scene.limb([10, 0, 2.8 + attack], [14, 0, 2.6 + attack * 2.2], 1.4, 1, rgb(0xd86a6a), { flat: true });
  }
  scene.ball([8.4, 1.4, 5], 0.9, rgb(0xe8d85a), { flat: true });
  scene.ball([8.4, -1.4, 5], 0.9, rgb(0xe8d85a), { flat: true });
}

export function teamCloth(shade = 0.8): Paint {
  return team(shade);
}
