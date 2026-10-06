import type { AgeId, ArchitectureSet } from '../../src/data/types';
import { AtlasBuilder } from './atlas';
import { Canvas, compositeOver, lighten, randomOf, rgb, seedOf, team } from './raster';
import type { Image, Paint } from './raster';
import { Scene } from './scene';
import type { P3 } from './scene';

export interface BuildingInfo {
  id: string;
  size: number;
  age: AgeId;
  classes: readonly string[];
}

export interface BuildingSprite {
  key: string;
  aliases: Record<string, string>;
}

type RoofKind = 'thatch' | 'flat' | 'step' | 'gable' | 'hip';
type Set = ArchitectureSet | 'common';

interface Style {
  set: Set;
  tier: number;
  wall: Paint;
  roof: Paint;
  roofKind: RoofKind;
  trim: Paint;
  base: Paint;
  column: Paint;
}

interface HallOptions {
  door?: 'l' | 'r' | 'wide';
  portico?: boolean;
  z?: number;
  plain?: boolean;
}

const AGES: readonly AgeId[] = ['stone', 'tool', 'bronze', 'iron'];
const SETS: readonly ArchitectureSet[] = ['egyptian', 'mesopotamian', 'greek', 'asian'];
const TAU = Math.PI * 2;
const RIGHT = 0.72;
const TOP = 1.1;
const DOOR = rgb(0x2a1c12);
const WOOD = rgb(0x6e4a2a, 1, 0.08);
const DARK_WOOD = rgb(0x4e3520);
const STRAW = rgb(0xcaa858, 1, 0.14);
const DIRT = rgb(0x9a8460, 0.6, 0.1);
const GOLD = rgb(0xe8c040);

function wallPaint(hex: number): Paint {
  return rgb(hex, 1, 0.07);
}

const STYLES: Record<string, Style> = {
  common: {
    set: 'common',
    tier: 0,
    wall: rgb(0x9a7a50, 1, 0.12),
    roof: STRAW,
    roofKind: 'thatch',
    trim: WOOD,
    base: rgb(0x8a7454),
    column: WOOD,
  },
  'egyptian.tool': style('egyptian', 1, 0xcaa978, 0xb89868, 'flat', 0x8a6a44, 0xb89868),
  'mesopotamian.tool': style('mesopotamian', 1, 0xb88c5c, 0xa07c50, 'flat', 0x7a5a3a, 0xa07c50),
  'greek.tool': style('greek', 1, 0xd8ccb2, 0xb89a58, 'gable', 0x8a6a44, 0xb8ac94),
  'asian.tool': style('asian', 1, 0x94633e, 0xa08c52, 'hip', 0x5e3c24, 0x8a8478),
  'egyptian.bronze': style('egyptian', 2, 0xe2ca92, 0xd0b47c, 'flat', 0xb0522e, 0xcdb680),
  'mesopotamian.bronze': style('mesopotamian', 2, 0xc89a64, 0xb4884f, 'step', 0x1f6a6a, 0xb08a58),
  'greek.bronze': style('greek', 2, 0xece6d8, 0xb5523a, 'gable', 0xf4f0e6, 0xd4cec0),
  'asian.bronze': style('asian', 2, 0xa8402e, 0x4c5c54, 'hip', 0x3a2a20, 0xa8a49a),
  'egyptian.iron': style('egyptian', 3, 0xeedcae, 0xdcc48c, 'flat', 0xe0b040, 0xd8c490),
  'mesopotamian.iron': style('mesopotamian', 3, 0xd0a670, 0xbc9258, 'step', 0x1a7a70, 0xb89460),
  'greek.iron': style('greek', 3, 0xf6f2ea, 0xa8442f, 'gable', 0xffffff, 0xdcd8cc),
  'asian.iron': style('asian', 3, 0xb8382a, 0x3c4a46, 'hip', 0xe0b040, 0xb4b0a6),
};

function style(
  set: ArchitectureSet,
  tier: number,
  wall: number,
  roof: number,
  roofKind: RoofKind,
  trim: number,
  base: number,
): Style {
  return {
    set,
    tier,
    wall: wallPaint(wall),
    roof: rgb(roof, 1, 0.1),
    roofKind,
    trim: rgb(trim),
    base: wallPaint(base),
    column: set === 'greek' ? rgb(trim) : wallPaint(wall),
  };
}

const FORT_STONE: Record<ArchitectureSet, number> = {
  egyptian: 0xdcc690,
  mesopotamian: 0xc09a68,
  greek: 0xd4d0c4,
  asian: 0xa8a49a,
};

function iso(x: number, y: number, z: number): P3 {
  return [(x - y) * 32, (x + y) * 32, z];
}

class Builder {
  readonly scene = new Scene(0, false);
  readonly phase: number;
  readonly size: number;

  constructor(size: number, phase: number) {
    this.size = size;
    this.phase = phase;
  }

  quad(a: P3, b: P3, c: P3, d: P3, paint: Paint): void {
    this.scene.poly([a, b, c, d], paint);
  }

  tri(a: P3, b: P3, c: P3, paint: Paint): void {
    this.scene.poly([a, b, c], paint);
  }

  ground(x0: number, y0: number, x1: number, y1: number, paint: Paint, z = 0.2): void {
    this.quad(iso(x0, y0, z), iso(x1, y0, z), iso(x1, y1, z), iso(x0, y1, z), paint);
  }

  faceL(x0: number, x1: number, y: number, z0: number, z1: number, paint: Paint): void {
    this.quad(iso(x0, y, z0), iso(x1, y, z0), iso(x1, y, z1), iso(x0, y, z1), paint);
  }

  faceR(x: number, y0: number, y1: number, z0: number, z1: number, paint: Paint): void {
    this.quad(iso(x, y0, z0), iso(x, y1, z0), iso(x, y1, z1), iso(x, y0, z1), lighten(paint, RIGHT));
  }

  block(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z0: number,
    z1: number,
    wall: Paint,
    top: Paint = lighten(wall, TOP),
    inset = 0,
    courses = 0,
  ): void {
    const t = inset;
    this.quad(iso(x0, y1, z0), iso(x1, y1, z0), iso(x1 - t, y1 - t, z1), iso(x0 + t, y1 - t, z1), wall);
    this.quad(
      iso(x1, y1, z0),
      iso(x1, y0, z0),
      iso(x1 - t, y0 + t, z1),
      iso(x1 - t, y1 - t, z1),
      lighten(wall, RIGHT),
    );
    this.quad(
      iso(x0 + t, y0 + t, z1),
      iso(x1 - t, y0 + t, z1),
      iso(x1 - t, y1 - t, z1),
      iso(x0 + t, y1 - t, z1),
      top,
    );
    if (courses > 0) {
      const line = rgb(0x000000, 0.13);
      for (let z = z0 + courses; z < z1 - 1; z += courses) {
        const k = ((z - z0) / (z1 - z0)) * t;
        this.faceL(x0 + k, x1 - k, y1 - k, z, z + 0.7, line);
        this.quad(
          iso(x1 - k, y0 + k, z),
          iso(x1 - k, y1 - k, z),
          iso(x1 - k, y1 - k, z + 0.7),
          iso(x1 - k, y0 + k, z + 0.7),
          line,
        );
      }
    }
  }

  gable(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    z: number,
    rise: number,
    axis: 'x' | 'y',
    roof: Paint,
    wall: Paint,
    over = 0.1,
  ): void {
    const o = over;
    if (axis === 'x') {
      const ym = (y0 + y1) / 2;
      this.quad(iso(x0 - o, y0 - o, z), iso(x1 + o, y0 - o, z), iso(x1 + o, ym, z + rise), iso(x0 - o, ym, z + rise), lighten(roof, 0.78));
      this.tri(iso(x1, y0, z), iso(x1, y1, z), iso(x1, ym, z + rise), lighten(wall, RIGHT));
      this.quad(iso(x0 - o, y1 + o, z - 1.5), iso(x1 + o, y1 + o, z - 1.5), iso(x1 + o, ym, z + rise), iso(x0 - o, ym, z + rise), roof);
    } else {
      const xm = (x0 + x1) / 2;
      this.quad(iso(x0 - o, y0 - o, z), iso(x0 - o, y1 + o, z), iso(xm, y1 + o, z + rise), iso(xm, y0 - o, z + rise), lighten(roof, 0.9));
      this.tri(iso(x0, y1, z), iso(x1, y1, z), iso(xm, y1, z + rise), wall);
      this.quad(iso(x1 + o, y0 - o, z - 1.5), iso(x1 + o, y1 + o, z - 1.5), iso(xm, y1 + o, z + rise), iso(xm, y0 - o, z + rise), lighten(roof, RIGHT));
    }
  }

  hip(x0: number, y0: number, x1: number, y1: number, z: number, rise: number, roof: Paint, over = 0.1): void {
    const a = x0 - over;
    const b = y0 - over;
    const c = x1 + over;
    const d = y1 + over;
    const apex = iso((x0 + x1) / 2, (y0 + y1) / 2, z + rise);
    this.tri(iso(a, b, z), iso(a, d, z), apex, lighten(roof, 0.86));
    this.tri(iso(a, b, z), iso(c, b, z), apex, lighten(roof, 0.7));
    this.tri(iso(a, d, z), iso(c, d, z), apex, lighten(roof, 1.04));
    this.tri(iso(c, d, z), iso(c, b, z), apex, lighten(roof, RIGHT));
  }

  private arc(x: number, y: number, r: number, z: number, from: number, to: number): P3[] {
    const points: P3[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const angle = from + ((to - from) * i) / 6;
      points.push(iso(x + Math.cos(angle) * r, y + Math.sin(angle) * r, z));
    }
    return points;
  }

  cone(x: number, y: number, r: number, z: number, height: number, paint: Paint): void {
    const apex = iso(x, y, z + height);
    this.scene.poly([apex, ...this.arc(x, y, r, z, Math.PI * 0.75, Math.PI * 0.25)], paint);
    this.scene.poly([apex, ...this.arc(x, y, r, z, Math.PI * 0.25, -Math.PI * 0.25)], lighten(paint, RIGHT));
  }

  cylinder(x: number, y: number, r: number, z0: number, z1: number, paint: Paint): void {
    const left = this.arc(x, y, r, z0, Math.PI * 0.75, Math.PI * 0.25);
    const right = this.arc(x, y, r, z0, Math.PI * 0.25, -Math.PI * 0.25);
    this.scene.poly([...left, ...this.arc(x, y, r, z1, Math.PI * 0.25, Math.PI * 0.75)], paint);
    this.scene.poly([...right, ...this.arc(x, y, r, z1, -Math.PI * 0.25, Math.PI * 0.25)], lighten(paint, RIGHT));
    this.scene.poly(
      [...this.arc(x, y, r, z1, 0, Math.PI), ...this.arc(x, y, r, z1, Math.PI, TAU)],
      lighten(paint, TOP),
    );
  }

  column(x: number, y: number, z0: number, z1: number, width: number, paint: Paint): void {
    this.scene.limb(iso(x, y, z0 + width / 2), iso(x, y, z1), width, width, paint);
  }

  post(x: number, y: number, z0: number, z1: number, width = 1.6): void {
    this.scene.limb(iso(x, y, z0), iso(x, y, z1), width, width, DARK_WOOD, { flat: true });
  }

  rail(xa: number, ya: number, xb: number, yb: number, z: number, paint: Paint = WOOD): void {
    this.scene.limb(iso(xa, ya, z), iso(xb, yb, z), 1.3, 1.3, paint, { flat: true });
  }

  flag(x: number, y: number, z: number, height: number): void {
    const base = iso(x, y, z);
    const top: P3 = [base[0], base[1], base[2] + height];
    this.scene.limb(base, top, 1.3, 1.3, DARK_WOOD, { flat: true });
    const wave = (offset: number): number => Math.sin(this.phase * TAU + offset) * 1.3;
    const at = (dx: number, dy: number): P3 => [top[0] + dx, top[1] + 0.01, top[2] - dy];
    this.scene.poly([at(0.5, 0), at(5.5, wave(0)), at(5.5, 6 + wave(0)), at(0.5, 6)], team(0.95));
    this.scene.poly(
      [at(5.5, wave(0)), at(10.5, wave(1.6)), at(10.5, 6 + wave(1.6)), at(5.5, 6 + wave(0))],
      team(0.72),
    );
  }

  smoke(x: number, y: number, z: number): void {
    for (let i = 0; i < 3; i += 1) {
      const rise = ((this.phase + i / 3) % 1) * 14;
      const at = iso(x, y, z + rise);
      this.scene.ball([at[0] + rise * 0.25, at[1], at[2]], 1.6 + rise * 0.16, rgb(0xe4e0d8, 0.5 - rise * 0.03), {
        flat: true,
        edge: false,
      });
    }
  }

  crenels(x0: number, y0: number, x1: number, y1: number, z: number, paint: Paint): void {
    const step = 0.28;
    const w = 0.13;
    for (let y = y0; y < y1 - w; y += step) {
      this.block(x0, y, x0 + w, y + w, z, z + 3.5, paint);
    }
    for (let x = x0; x < x1 - w; x += step) {
      this.block(x, y0, x + w, y0 + w, z, z + 3.5, paint);
    }
    for (let x = x0; x < x1 - w; x += step) {
      this.block(x, y1 - w, x + w, y1, z, z + 3.5, paint);
    }
    for (let y = y0; y < y1 - w + 0.01; y += step) {
      this.block(x1 - w, y, x1, y + w, z, z + 3.5, paint);
    }
  }

  hall(s: Style, x0: number, y0: number, x1: number, y1: number, height: number, options: HallOptions = {}): number {
    const z = options.z ?? 0;
    const longX = x1 - x0 >= y1 - y0;
    const span = Math.min(x1 - x0, y1 - y0);
    const p = options.portico ? 0.24 : 0;
    const bx1 = x1 - p;
    const by1 = y1 - p;
    let top = z + height;
    const doorOn = (wallTop: number): void => {
      const doorH = Math.min(wallTop - z - 3, 13);
      if (options.door === 'l') {
        const xm = (x0 + bx1) / 2;
        this.faceL(xm - 0.17, xm + 0.17, by1 + 0.005, z, z + doorH, DOOR);
      } else if (options.door === 'r') {
        const ym = (y0 + by1) / 2;
        this.faceR(bx1 + 0.005, ym - 0.17, ym + 0.17, z, z + doorH, lighten(DOOR, 1 / RIGHT));
      } else if (options.door === 'wide') {
        const ym = (y0 + by1) / 2;
        this.faceR(bx1 + 0.005, ym - 0.55, ym + 0.55, z, z + (wallTop - z) * 0.72, lighten(DOOR, 1 / RIGHT));
      }
    };
    const band = (wallTop: number): void => {
      if (s.tier >= 2 && !options.plain) {
        this.faceL(x0, bx1, by1 + 0.004, wallTop - 6, wallTop - 3, team(0.9));
        this.faceR(bx1 + 0.004, y0, by1, wallTop - 6, wallTop - 3, team(0.9 / RIGHT));
      }
    };
    const columns = (wallTop: number): void => {
      if (!options.portico) {
        return;
      }
      for (let y = y0 + 0.12; y < y1; y += 0.36) {
        this.column(x1 - 0.06, y, z, wallTop, 3, s.column);
      }
      for (let x = x0 + 0.12; x < x1 - 0.2; x += 0.36) {
        this.column(x, y1 - 0.06, z, wallTop, 3, s.column);
      }
    };
    switch (s.roofKind) {
      case 'thatch': {
        const wallTop = z + height * 0.62;
        this.block(x0, y0, bx1, by1, z, wallTop, s.wall);
        doorOn(wallTop);
        columns(wallTop);
        this.hip(x0, y0, x1, y1, wallTop - 1, height * 0.5 + span * 9, s.roof, 0.14);
        top = wallTop + height * 0.5 + span * 9;
        break;
      }
      case 'flat': {
        const inset = s.set === 'egyptian' ? 0.07 : 0;
        this.block(x0, y0, bx1, by1, z, top, s.wall, lighten(s.roof, 1.05), inset, s.tier >= 2 ? 5 : 0);
        this.ground(x0 + 0.16 + inset, y0 + 0.16 + inset, bx1 - 0.16 - inset, by1 - 0.16 - inset, lighten(s.roof, 0.84), top);
        doorOn(top);
        band(top);
        columns(top);
        break;
      }
      case 'step': {
        const lower = z + height * 0.7;
        this.block(x0, y0, bx1, by1, z, lower, s.wall, lighten(s.roof, 1.05), 0, 5);
        doorOn(lower);
        band(lower);
        const k = span * 0.2;
        top = z + height * 1.15;
        this.block(x0 + k, y0 + k, bx1 - k, by1 - k, lower, top, s.wall, lighten(s.roof, 1.05), 0, 5);
        this.faceL(x0 + k, bx1 - k, by1 - k + 0.004, top - 4.5, top - 2, s.trim);
        this.faceR(bx1 - k + 0.004, y0 + k, by1 - k, top - 4.5, top - 2, lighten(s.trim, 1 / RIGHT));
        this.crenels(x0 + k, y0 + k, bx1 - k, by1 - k, top, s.wall);
        columns(lower);
        top += 3.5;
        break;
      }
      case 'gable': {
        this.block(x0, y0, bx1, by1, z, top, s.wall, lighten(s.wall, TOP), 0, 0);
        doorOn(top);
        band(top);
        columns(top);
        const rise = Math.min(22, span * 13);
        this.gable(x0, y0, x1, y1, top, rise, longX ? 'x' : 'y', s.roof, s.wall, 0.1);
        top += rise;
        break;
      }
      case 'hip': {
        if (s.tier >= 2) {
          this.block(x0 - 0.08, y0 - 0.08, x1 + 0.08, y1 + 0.08, z, z + 3, s.base);
        }
        this.block(x0, y0, bx1, by1, z, top, s.wall);
        if (s.tier >= 2) {
          for (let x = x0; x <= bx1 + 0.01; x += (bx1 - x0) / 3) {
            this.faceL(x - 0.03, x + 0.03, by1 + 0.004, z, top, s.trim);
          }
        }
        doorOn(top);
        columns(top);
        const rise = height * 0.45 + span * 6;
        this.hip(x0, y0, x1, y1, top - 1.5, rise, s.roof, 0.22);
        top += rise - 1.5;
        if (s.tier >= 3) {
          this.scene.ball(iso((x0 + x1) / 2, (y0 + y1) / 2, top + 1), 1.8, GOLD);
        }
        break;
      }
    }
    return top;
  }

  pile(x: number, y: number, kind: 'logs' | 'stone' | 'gold' | 'sacks' | 'crates' | 'hay'): void {
    switch (kind) {
      case 'logs':
        for (let i = 0; i < 3; i += 1) {
          this.scene.limb(iso(x - 0.25, y + i * 0.1 - 0.1, 2), iso(x + 0.25, y + i * 0.1 - 0.1, 2), 3.2, 3.2, rgb(0x7a5230));
        }
        this.scene.limb(iso(x - 0.25, y, 4.6), iso(x + 0.25, y, 4.6), 3.2, 3.2, rgb(0x8a6238));
        break;
      case 'stone':
        this.scene.ball(iso(x - 0.1, y, 2.5), 3.4, rgb(0xa4a29c));
        this.scene.ball(iso(x + 0.12, y + 0.05, 2), 2.8, rgb(0x8f8d88));
        break;
      case 'gold':
        this.scene.ball(iso(x, y, 2.2), 3, rgb(0xa4a29c));
        this.scene.ball(iso(x + 0.06, y + 0.06, 3.4), 2, GOLD);
        break;
      case 'sacks':
        this.scene.ball(iso(x - 0.1, y, 2.4), 3, rgb(0xd8caa4));
        this.scene.ball(iso(x + 0.1, y + 0.06, 2.2), 2.8, rgb(0xc8b88c));
        break;
      case 'crates':
        this.block(x - 0.14, y - 0.14, x + 0.14, y + 0.14, 0, 6, rgb(0xa87c4a), rgb(0xc09458));
        break;
      case 'hay':
        this.cone(x, y, 0.2, 0, 11, STRAW);
        break;
    }
  }

  render(maxHeight: number): Image {
    const width = this.size * 64 + 72;
    const height = this.size * 32 + maxHeight + 48;
    return this.scene.render({
      width,
      height,
      anchorX: width / 2,
      anchorY: height - this.size * 16 - 16,
    });
  }
}

type Compose = (b: Builder, s: Style) => void;

function yard(b: Builder): void {
  const h = b.size / 2 - 0.08;
  b.ground(-h, -h, h, h, DIRT);
}

const COMPOSERS: Record<string, Compose> = {
  town_center(b, s) {
    yard(b);
    const top = b.hall(s, -1.3, -1.3, 0.3, 1.3, 27 + s.tier * 2, { door: 'r' });
    b.smoke(-0.5, -0.4, top - 4);
    b.hall(s, 0.3, -1.3, 1.3, -0.05, 17 + s.tier * 2, { door: 'l' });
    b.pile(0.75, 0.95, s.tier === 0 ? 'logs' : 'crates');
    b.flag(1.05, 0.55, 0, 30);
  },
  house(b, s) {
    b.ground(-0.92, -0.92, 0.92, 0.92, DIRT);
    const top = b.hall(s, -0.72, -0.7, 0.72, 0.62, 13 + s.tier * 2, { door: 'l', plain: true });
    b.smoke(-0.2, -0.2, top - 3);
    if (s.tier >= 2) {
      b.faceL(-0.55, -0.35, 0.624, 7, 11, team(0.9));
    } else {
      b.post(0.82, 0.82, 0, 9);
      b.scene.ball(iso(0.82, 0.82, 10), 1.8, team(0.9), { flat: true });
    }
  },
  barracks(b, s) {
    yard(b);
    b.hall(s, -1.3, -1.3, 1.3, 0.05, 21 + s.tier * 2, { door: 'l' });
    b.post(-0.9, 0.85, 0, 9);
    b.post(-0.1, 0.85, 0, 9);
    b.rail(-0.9, 0.85, -0.1, 0.85, 8.5);
    for (const x of [-0.75, -0.5, -0.25]) {
      b.scene.ball(iso(x, 0.88, 5), 2.7, team(0.9));
    }
    b.post(0.55, 0.75, 0, 12, 2.2);
    b.rail(0.4, 0.75, 0.7, 0.75, 9, rgb(0xd8c8a0));
    b.flag(1.15, 1.15, 0, 26);
  },
  granary(b, s) {
    yard(b);
    b.hall(s, -1.3, -1.3, 0.05, 1.3, 19 + s.tier * 2, { door: 'r' });
    for (const y of [-0.7, 0.5]) {
      b.cylinder(0.75, y, 0.4, 0, 16 + s.tier, s.wall);
      if (s.tier < 2) {
        b.cone(0.75, y, 0.5, 15 + s.tier, 11, STRAW);
      } else {
        b.scene.ball(iso(0.75, y, 17 + s.tier), 13, lighten(s.roof, 1.05));
      }
    }
    b.pile(0.45, 1.1, 'sacks');
    b.flag(1.2, 1.2, 0, 22);
  },
  storage_pit(b, s) {
    yard(b);
    b.ground(-1.15, -1.15, 0.35, 1.15, rgb(0x4a3a2a, 0.85));
    b.pile(-0.6, -0.5, 'logs');
    b.pile(-0.5, 0.4, 'stone');
    for (const [x, y] of [
      [-1.2, -1.2],
      [0.4, -1.2],
      [-1.2, 1.2],
      [0.4, 1.2],
    ]) {
      b.post(x, y, 0, 18, 2.4);
    }
    if (s.roofKind === 'thatch' || s.roofKind === 'hip') {
      b.hip(-1.2, -1.2, 0.4, 1.2, 17, 14, s.roof, 0.16);
    } else if (s.roofKind === 'gable') {
      b.gable(-1.2, -1.2, 0.4, 1.2, 17, 14, 'y', s.roof, s.wall, 0.14);
    } else {
      b.block(-1.3, -1.3, 0.5, 1.3, 17, 20.5, s.wall, lighten(s.roof, 1.05));
    }
    b.pile(0.9, -0.7, 'logs');
    b.pile(0.9, 0.1, 'stone');
    b.pile(0.9, 0.8, 'gold');
    b.flag(1.25, 1.25, 0, 22);
  },
  dock(b, s) {
    const planks = rgb(0x8a6a44, 1, 0.1);
    b.block(-1.4, -1.4, 1.4, 1.4, -2, 3, rgb(0x5e4630), planks, 0, 0);
    for (let x = -1.2; x < 1.4; x += 0.28) {
      b.ground(x, -1.4, x + 0.03, 1.4, rgb(0x000000, 0.16), 3.05);
    }
    b.hall(s, -1.3, -1.3, 0, 0.4, 15 + s.tier * 2, { door: 'r', z: 3 });
    for (const [x, y] of [
      [1.3, -1.3],
      [1.3, 1.3],
      [-1.3, 1.3],
      [1.3, 0],
      [0, 1.3],
    ]) {
      b.post(x, y, -2, 9, 2.6);
    }
    b.scene.limb(iso(0.6, -0.6, 3), iso(0.6, -0.6, 20), 2, 2, DARK_WOOD, { flat: true });
    b.scene.limb(iso(0.6, -0.6, 20), iso(1.25, -0.2, 16), 1.6, 1.6, DARK_WOOD, { flat: true });
    b.scene.limb(iso(1.25, -0.2, 16), iso(1.25, -0.2, 10), 0.7, 0.7, rgb(0xd8d0c0), { flat: true });
    b.block(0.45, 0.5, 0.75, 0.8, 3, 9, rgb(0xa87c4a), rgb(0xc09458));
    b.scene.limb(iso(0.95, 0.95, 5), iso(0.95, 0.95, 8), 5, 5, rgb(0x7a5230));
    b.flag(-0.9, 1.0, 3, 24);
  },
  archery_range(b, s) {
    yard(b);
    b.hall(s, -1.3, -1.3, 1.3, -0.45, 15 + s.tier * 2, { door: 'l' });
    b.pile(1.05, 0.0, 'hay');
    for (const x of [-0.9, -0.2, 0.5]) {
      b.post(x, 0.9, 0, 8, 1.4);
      const at = iso(x, 0.9, 9);
      b.scene.disc(at, 'l', 4.6, rgb(0xf0ead8));
      b.scene.disc([at[0], at[1] + 0.01, at[2]], 'l', 3, rgb(0xc8402e));
      b.scene.disc([at[0], at[1] + 0.02, at[2]], 'l', 1.3, rgb(0xf0ead8));
    }
    b.flag(1.2, 1.2, 0, 24);
  },
  stable(b, s) {
    yard(b);
    const height = 17 + s.tier * 2;
    b.hall(s, -1.3, -1.3, 1.3, -0.25, height, {});
    const wallTop = s.roofKind === 'thatch' ? height * 0.62 : s.roofKind === 'step' ? height * 0.7 : height;
    for (const x of [-0.85, 0, 0.85]) {
      b.faceL(x - 0.22, x + 0.22, -0.245, 0, Math.min(11, wallTop - 2), DOOR);
      b.faceL(x - 0.22, x + 0.22, -0.24, 0, 4.5, WOOD);
    }
    b.pile(-0.8, 0.5, 'hay');
    for (let x = -1.3; x <= 1.31; x += 0.52) {
      b.post(x, 1.3, 0, 7);
    }
    b.rail(-1.3, 1.3, 1.3, 1.3, 6);
    b.rail(-1.3, 1.3, 1.3, 1.3, 3.2);
    for (let y = -0.25; y <= 1.31; y += 0.52) {
      b.post(1.3, y, 0, 7);
    }
    b.rail(1.3, -0.25, 1.3, 1.3, 6);
    b.rail(1.3, -0.25, 1.3, 1.3, 3.2);
    b.flag(-1.2, 1.15, 0, 22);
  },
  market(b, s) {
    yard(b);
    b.hall(s, -1.3, -1.3, -0.05, -0.05, 17 + s.tier * 2, { door: 'l' });
    const stall = (x: number, y: number): void => {
      b.pile(x, y, 'crates');
      b.scene.ball(iso(x + 0.2, y + 0.2, 2.4), 2.4, rgb(0xb8643a));
      for (const [dx, dy] of [
        [-0.32, -0.32],
        [0.32, -0.32],
        [-0.32, 0.32],
        [0.32, 0.32],
      ]) {
        b.post(x + dx, y + dy, 0, dx + dy > 0 ? 10 : 13, 1.3);
      }
      const mid = (x0: number, x1: number, shade: number): void => {
        b.quad(
          iso(x0, y - 0.38, 13.5),
          iso(x1, y - 0.38, 13.5),
          iso(x1, y + 0.38, 10),
          iso(x0, y + 0.38, 10),
          team(shade),
        );
      };
      mid(x - 0.38, x - 0.13, 0.95);
      b.quad(iso(x - 0.13, y - 0.38, 13.5), iso(x + 0.13, y - 0.38, 13.5), iso(x + 0.13, y + 0.38, 10), iso(x - 0.13, y + 0.38, 10), rgb(0xf0ead8));
      mid(x + 0.13, x + 0.38, 0.95);
    };
    stall(0.65, -0.75);
    stall(-0.7, 0.7);
    stall(0.65, 0.65);
    b.flag(1.25, -0.1, 0, 22);
  },
  academy(b, s) {
    b.block(-1.38, -1.38, 1.38, 1.38, 0, 4, s.base);
    b.hall(s, -1.1, -1.15, 1.2, 1.2, 23 + s.tier * 2, { door: 'r', portico: true, z: 4 });
    b.flag(1.3, 1.3, 4, 20);
  },
  government_center(b, s) {
    b.block(-1.4, -1.4, 1.4, 1.4, 0, 3, s.base);
    b.block(-1.25, -1.25, 1.25, 1.25, 3, 6, s.base);
    b.block(-1.1, -1.1, 1.1, 1.1, 6, 21, s.wall, lighten(s.roof, 1.05), s.set === 'egyptian' ? 0.06 : 0, 5);
    b.faceL(-1.1, 1.1, 1.104, 15, 18, team(0.9));
    b.faceR(1.104, -1.1, 1.1, 15, 18, team(0.9 / RIGHT));
    b.faceR(1.105, -0.2, 0.2, 6, 17, lighten(DOOR, 1 / RIGHT));
    b.block(1.1, -0.35, 1.4, 0.35, 0, 6, lighten(s.base, 1.1));
    b.hall(s, -0.65, -0.65, 0.65, 0.65, 13 + s.tier, { z: 21, plain: true });
    b.flag(1.3, -1.2, 3, 24);
    b.flag(-1.2, 1.3, 3, 24);
  },
  siege_workshop(b, s) {
    yard(b);
    b.hall(s, -1.3, -1.3, 0.45, 1.3, 23 + s.tier * 2, { door: 'wide' });
    b.pile(0.95, -0.9, 'logs');
    const hub = iso(1.0, 0.1, 5.5);
    b.scene.disc(hub, 'l', 5.5, DARK_WOOD);
    b.scene.disc([hub[0], hub[1] + 0.01, hub[2]], 'l', 3.6, rgb(0xa87c4a));
    b.scene.disc([hub[0], hub[1] + 0.02, hub[2]], 'l', 1.2, DARK_WOOD);
    b.post(0.8, 0.9, 0, 13, 2);
    b.post(1.2, 0.9, 0, 13, 2);
    b.rail(0.8, 0.9, 1.2, 0.9, 12.5);
    b.scene.limb(iso(1.0, 0.9, 12.5), iso(0.7, 1.15, 4), 1.8, 1.8, WOOD, { flat: true });
    b.flag(1.25, 1.3, 0, 22);
  },
  temple(b, s) {
    switch (s.set) {
      case 'egyptian': {
        yard(b);
        b.hall(s, -1.25, -0.9, 0.6, 0.9, 20 + s.tier, { plain: true });
        const tall = 30 + s.tier * 2;
        b.block(0.6, -1.25, 1.15, -0.2, 0, tall, s.wall, lighten(s.roof, 1.05), 0.09, 5);
        b.block(0.6, 0.2, 1.15, 1.25, 0, tall, s.wall, lighten(s.roof, 1.05), 0.09, 5);
        b.block(0.6, -0.2, 1.05, 0.2, 0, tall * 0.62, s.wall);
        b.faceR(1.055, -0.14, 0.14, 0, tall * 0.45, lighten(DOOR, 1 / RIGHT));
        b.faceR(1.12, -1.1, -0.35, tall - 9, tall - 5, team(0.9 / RIGHT));
        b.faceR(1.12, 0.35, 1.1, tall - 9, tall - 5, team(0.9 / RIGHT));
        b.flag(0.85, -0.7, tall, 12);
        b.flag(0.85, 0.75, tall, 12);
        break;
      }
      case 'mesopotamian': {
        const sizes = [1.38, 1.02, 0.66];
        sizes.forEach((half, i) => {
          b.block(-half, -half, half, half, i * 10, i * 10 + 10, s.wall, lighten(s.roof, 1.05), 0.05, 5);
          b.faceR(half + 0.004 - 0.05 * 0.5, -0.16, 0.16, i * 10, i * 10 + 10, lighten(s.base, 1.3));
        });
        b.block(-0.34, -0.34, 0.34, 0.34, 30, 41 + s.tier, s.trim, lighten(s.trim, 1.2));
        b.faceR(0.345, -0.1, 0.1, 30, 37, lighten(DOOR, 1 / RIGHT));
        b.faceL(-1.3, 1.3, 1.36, 5, 7.5, team(0.9));
        b.flag(0, 0, 41 + s.tier, 14);
        break;
      }
      case 'greek': {
        b.block(-1.4, -1.4, 1.4, 1.4, 0, 3, s.base);
        b.block(-1.3, -1.3, 1.3, 1.3, 3, 6, s.base);
        b.hall(s, -1.05, -1.2, 1.2, 1.2, 24 + s.tier * 2, { door: 'r', portico: true, z: 6 });
        b.flag(1.32, 1.32, 3, 18);
        break;
      }
      default: {
        b.block(-1.35, -1.35, 1.35, 1.35, 0, 4, s.base);
        let z = 4;
        const tiers = s.tier >= 3 ? [0.95, 0.66, 0.4] : [0.95, 0.6];
        for (const half of tiers) {
          b.block(-half, -half, half, half, z, z + 14, s.wall);
          b.faceR(half + 0.004, -0.1, 0.1, z, z + 9, lighten(DOOR, 1 / RIGHT));
          b.faceL(-half, half, half + 0.004, z + 9.5, z + 12, team(0.9));
          b.hip(-half, -half, half, half, z + 13, 9, s.roof, 0.17);
          z += 19;
        }
        b.scene.limb(iso(0, 0, z + 2), iso(0, 0, z + 9), 1.6, 1, GOLD, { flat: true });
        b.flag(1.25, 1.25, 4, 18);
        break;
      }
    }
  },
  wonder(b, s) {
    switch (s.set) {
      case 'egyptian': {
        yard(b);
        const stone = rgb(0xe6d4a0, 1, 0.1);
        b.hip(-2.25, -2.25, 2.25, 2.25, 0, 132, stone, 0);
        b.hip(-0.26, -0.26, 0.26, 0.26, 116.6, 15.4, GOLD, 0);
        for (const [x, y] of [
          [2.35, 0.9],
          [0.9, 2.35],
        ]) {
          b.block(x - 0.09, y - 0.09, x + 0.09, y + 0.09, 0, 34, stone, GOLD, 0.03);
        }
        b.block(1.7, 1.7, 2.3, 2.3, 0, 14, s.wall, lighten(s.roof, 1.05), 0.05);
        b.faceL(1.7, 2.3, 2.26, 8, 11, team(0.9));
        b.flag(2.0, 2.0, 14, 16);
        break;
      }
      case 'mesopotamian': {
        const sizes = [2.35, 1.95, 1.55, 1.15, 0.75];
        sizes.forEach((half, i) => {
          b.block(-half, -half, half, half, i * 20, i * 20 + 20, s.wall, lighten(s.roof, 1.05), 0.06, 5);
          b.faceR(half - 0.03, -0.22, 0.22, i * 20, i * 20 + 20, lighten(s.base, 1.35));
          b.faceL(-half + 0.1, half - 0.1, half - 0.055, i * 20 + 14, i * 20 + 17, i % 2 === 0 ? team(0.9) : s.trim);
        });
        b.block(-0.42, -0.42, 0.42, 0.42, 100, 118, s.trim, lighten(s.trim, 1.25));
        b.faceR(0.425, -0.12, 0.12, 100, 112, lighten(DOOR, 1 / RIGHT));
        b.crenels(-0.42, -0.42, 0.42, 0.42, 118, s.trim);
        b.flag(0, 0, 118, 18);
        break;
      }
      case 'greek': {
        b.block(-2.4, -2.4, 2.4, 2.4, 0, 5, s.base);
        b.block(-2.25, -2.25, 2.25, 2.25, 5, 10, s.base);
        b.block(-2.1, -2.1, 2.1, 2.1, 10, 15, s.base);
        b.hall(s, -1.75, -1.95, 1.95, 1.95, 52, { door: 'r', portico: true, z: 15 });
        b.scene.ball(iso(2.2, 0, 22), 3.4, GOLD);
        b.scene.limb(iso(2.2, 0, 15), iso(2.2, 0, 20), 3.6, 3, GOLD);
        b.flag(2.3, 2.3, 10, 24);
        b.flag(2.3, -2.2, 10, 24);
        break;
      }
      default: {
        b.block(-2.3, -2.3, 2.3, 2.3, 0, 8, s.base, lighten(s.base, 1.1), 0.05, 4);
        let z = 8;
        for (const half of [1.7, 1.42, 1.14, 0.86, 0.58]) {
          b.block(-half, -half, half, half, z, z + 15, s.wall);
          b.faceR(half + 0.004, -0.14, 0.14, z, z + 10, lighten(DOOR, 1 / RIGHT));
          b.faceL(-half, half, half + 0.004, z + 11, z + 13.5, team(0.9));
          b.hip(-half, -half, half, half, z + 14, 11, s.roof, 0.2);
          z += 21;
        }
        b.scene.limb(iso(0, 0, z + 2), iso(0, 0, z + 16), 2.2, 1, GOLD, { flat: true });
        b.flag(2.15, 2.15, 8, 22);
        break;
      }
    }
  },
};

const HEIGHT_LIMIT: Record<string, number> = { wonder: 190, tower: 110 };

function maxHeight(info: BuildingInfo): number {
  if (info.classes.includes('wonder')) {
    return HEIGHT_LIMIT.wonder;
  }
  if (info.classes.includes('tower')) {
    return HEIGHT_LIMIT.tower;
  }
  return info.classes.includes('wall') ? 56 : 96;
}

function composeWall(b: Builder, id: string, set: ArchitectureSet): void {
  const stone = wallPaint(FORT_STONE[set]);
  if (id === 'small_wall') {
    const timber = rgb(0x8a6a44, 1, 0.1);
    b.block(-0.5, -0.5, 0.5, 0.5, 0, 14, timber, lighten(timber, 1.15));
    for (let k = -0.5; k < 0.5; k += 0.2) {
      b.faceL(k, k + 0.025, 0.502, 0, 14, rgb(0x000000, 0.22));
      b.faceR(0.502, k, k + 0.025, 0, 14, rgb(0x000000, 0.3));
    }
    b.ground(-0.5, -0.5, 0.5, 0.5, team(0.85), 14.1);
    b.ground(-0.38, -0.38, 0.38, 0.38, lighten(timber, 1.15), 14.2);
    return;
  }
  const height = id === 'medium_wall' ? 20 : 27;
  b.block(-0.5, -0.5, 0.5, 0.5, 0, height, stone, lighten(stone, 1.12), 0, 5);
  b.faceL(-0.5, 0.5, 0.502, height - 5, height - 2.5, team(0.9));
  b.faceR(0.502, -0.5, 0.5, height - 5, height - 2.5, team(0.9 / RIGHT));
  if (id === 'fortification') {
    b.crenels(-0.5, -0.5, 0.5, 0.5, height, stone);
  }
}

function composeTower(b: Builder, id: string, set: ArchitectureSet): void {
  b.ground(-0.85, -0.85, 0.85, 0.85, DIRT);
  if (id === 'watch_tower') {
    const timber = rgb(0x8a6a44, 1, 0.1);
    b.block(-0.5, -0.5, 0.5, 0.5, 0, 34, timber, lighten(timber, 1.1), 0.1, 6);
    b.faceL(-0.1, 0.1, 0.502, 0, 9, DOOR);
    b.block(-0.55, -0.55, 0.55, 0.55, 34, 37, DARK_WOOD, rgb(0x8a6a44));
    for (const [x, y] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ]) {
      b.post(x, y, 37, 47, 1.8);
    }
    b.faceL(-0.5, 0.5, 0.552, 37, 40.5, team(0.9));
    b.faceR(0.552, -0.5, 0.5, 37, 40.5, team(0.9 / RIGHT));
    b.hip(-0.55, -0.55, 0.55, 0.55, 46, 12, STRAW, 0.12);
    b.flag(0, 0, 57, 10);
    return;
  }
  const stone = wallPaint(FORT_STONE[set]);
  const height = id === 'sentry_tower' ? 46 : id === 'guard_tower' ? 58 : 52;
  b.block(-0.56, -0.56, 0.56, 0.56, 0, height, stone, lighten(stone, 1.1), 0.1, 5);
  b.faceL(-0.11, 0.11, 0.562, 0, 10, DOOR);
  b.faceR(0.5, -0.05, 0.05, height * 0.55, height * 0.55 + 6, lighten(DOOR, 1 / RIGHT));
  b.block(-0.6, -0.6, 0.6, 0.6, height, height + 6, stone, lighten(stone, 1.12));
  b.faceL(-0.6, 0.6, 0.602, height + 1.5, height + 4, team(0.9));
  b.faceR(0.602, -0.6, 0.6, height + 1.5, height + 4, team(0.9 / RIGHT));
  b.crenels(-0.6, -0.6, 0.6, 0.6, height + 6, stone);
  if (id === 'ballista_tower') {
    const deck = height + 9;
    b.scene.limb(iso(0, 0, height + 6), iso(0, 0, deck), 2, 2, DARK_WOOD, { flat: true });
    b.scene.limb(iso(-0.3, 0.3, deck), iso(0.35, -0.35, deck + 2), 2.4, 2, WOOD, { flat: true });
    b.scene.limb(iso(-0.1, -0.35, deck + 1.5), iso(0.4, 0.15, deck + 1.5), 1.6, 1.6, DARK_WOOD, { flat: true });
    b.flag(-0.45, -0.45, height + 6, 14);
  } else {
    b.flag(0, 0, height + 6, id === 'guard_tower' ? 18 : 14);
  }
}

function composeFarm(b: Builder, stage: number): void {
  const soil = rgb(0x7a5a36, 1, 0.14);
  b.ground(-1.42, -1.42, 1.42, 1.42, soil);
  const rows = stage === 0 ? 0 : stage === 1 ? 4 : stage === 2 ? 7 : 11;
  for (let i = 0; i < 11; i += 1) {
    const y = -1.3 + i * 0.26;
    b.ground(-1.34, y + 0.11, 1.34, y + 0.15, rgb(0x4e3822, 0.55), 0.3);
    if (i < rows) {
      const crop = i % 3 === 0 ? rgb(0xc8b040, 1, 0.2) : rgb(0x6aa23c, 1, 0.2);
      b.ground(-1.3, y - 0.02, 1.3, y + 0.09, crop, 0.4);
    }
  }
  for (const [x, y] of [
    [-1.42, -1.42],
    [1.42, -1.42],
    [-1.42, 1.42],
    [1.42, 1.42],
  ]) {
    b.post(x, y, 0, 5, 1.8);
    b.scene.ball(iso(x, y, 6), 1.7, team(0.9), { flat: true });
  }
}

function composeSite(b: Builder, info: BuildingInfo, stage: number): void {
  const half = info.size / 2;
  const tower = info.classes.includes('tower');
  const wall = info.classes.includes('wall');
  const inner = wall ? 0.5 : tower ? 0.56 : half - 0.25;
  const target = wall ? 20 : tower ? 50 : info.classes.includes('wonder') ? 70 : 24;
  const stone = rgb(0xb8a888, 1, 0.1);
  b.ground(-half + 0.05, -half + 0.05, half - 0.05, half - 0.05, rgb(0x8a6f4a, 0.85, 0.12));
  if (stage === 0) {
    for (const [x, y] of [
      [-inner, -inner],
      [inner, -inner],
      [-inner, inner],
      [inner, inner],
    ]) {
      b.post(x, y, 0, 6, 1.6);
    }
    b.rail(-inner, inner, inner, inner, 5, rgb(0xd8d0c0));
    b.rail(inner, -inner, inner, inner, 5, rgb(0xd8d0c0));
    b.rail(-inner, -inner, inner, -inner, 5, rgb(0xd8d0c0));
    b.rail(-inner, -inner, -inner, inner, 5, rgb(0xd8d0c0));
    if (!wall) {
      b.block(-inner * 0.5, inner * 0.3, -inner * 0.2, inner * 0.6, 0, 3.5, stone);
      b.block(inner * 0.2, -inner * 0.4, inner * 0.55, -inner * 0.1, 0, 3.5, stone);
    }
    return;
  }
  const height = target * (stage === 1 ? 0.35 : 0.75);
  b.block(-inner, -inner, inner, inner, 0, height, stone, rgb(0x5a4a38), 0, 5);
  if (!wall) {
    const rim = Math.min(0.14, inner * 0.2);
    b.block(-inner, inner - rim, inner, inner, height - 0.01, height, stone, lighten(stone, 1.12));
    b.block(inner - rim, -inner, inner, inner, height - 0.01, height, stone, lighten(stone, 1.12));
    b.block(-inner, -inner, inner, -inner + rim, height - 0.01, height, stone, lighten(stone, 1.12));
    b.block(-inner, -inner, -inner + rim, inner, height - 0.01, height, stone, lighten(stone, 1.12));
  }
  const reach = inner + 0.12;
  const poleTop = height + 9;
  for (const [x, y] of [
    [-reach, reach],
    [reach, reach],
    [reach, -reach],
  ]) {
    b.post(x, y, 0, poleTop, 1.5);
  }
  b.rail(-reach, reach, reach, reach, height + 3, WOOD);
  b.rail(reach, -reach, reach, reach, height + 3, WOOD);
  b.rail(-reach, reach, reach, reach, height * 0.5, WOOD);
  b.rail(reach, -reach, reach, reach, height * 0.5, WOOD);
  if (stage === 2 && !wall && !tower) {
    for (let k = -inner + 0.3; k < inner; k += 0.5) {
      b.rail(k, -inner, k, inner, height + 0.5, DARK_WOOD);
    }
  }
}

function flame(canvas: Canvas, x: number, y: number, size: number, sway: number): void {
  canvas.capsule(x, y, x + sway * 1.6, y - size * 1.9, size, 0.6, rgb(0xe8641c, 0.95));
  canvas.capsule(x, y - 0.3, x + sway, y - size * 1.1, size * 0.55, 0.5, rgb(0xfcd648));
  for (let i = 0; i < 3; i += 1) {
    const rise = size * 2.2 + i * 4.5;
    canvas.ellipse(x + sway * 2 + i * 1.6, y - rise, 2 + i * 0.9, 2 + i * 0.8, rgb(0x3a3632, 0.42 - i * 0.1));
  }
}

function damage(image: Image, level: number, seed: number, phase: number, flat: boolean): Image {
  const out: Image = { ...image, data: image.data.slice(), mask: image.mask.slice() };
  const random = randomOf(seed);
  const { width, height } = out;
  const solid: number[] = [];
  for (let i = 0; i < width * height; i += 1) {
    if (out.data[i * 4 + 3] > 230) {
      solid.push(i);
    }
  }
  if (solid.length === 0) {
    return out;
  }
  const pick = (): [number, number] => {
    const index = solid[Math.floor(random() * solid.length)];
    return [index % width, Math.floor(index / width)];
  };
  const blotches = level === 1 ? 5 : 11;
  for (let n = 0; n < blotches; n += 1) {
    const [cx, cy] = pick();
    const radius = 5 + random() * 8;
    for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, cy + radius); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, cx + radius); x += 1) {
        const distance = Math.hypot(x - cx, (y - cy) * 1.4) / radius;
        if (distance >= 1) {
          continue;
        }
        const o = (y * width + x) * 4;
        const keep = 1 - (1 - distance) * 0.6;
        out.data[o] *= keep;
        out.data[o + 1] *= keep;
        out.data[o + 2] *= keep;
        out.mask[o] *= keep;
        out.mask[o + 1] *= keep;
        out.mask[o + 2] *= keep;
      }
    }
  }
  for (let n = 0; n < blotches; n += 1) {
    let [x, y] = pick();
    for (let step = 0; step < 14; step += 1) {
      x += Math.round(random() * 2 - 1);
      y += 1;
      if (x < 0 || x >= width || y >= height) {
        break;
      }
      const o = (y * width + x) * 4;
      if (out.data[o + 3] < 230) {
        break;
      }
      out.data[o] *= 0.35;
      out.data[o + 1] *= 0.35;
      out.data[o + 2] *= 0.35;
      out.mask[o + 3] = 0;
    }
  }
  if (flat) {
    return out;
  }
  const fires = new Canvas(width, height, 0, 0);
  const count = level === 1 ? 1 : 4;
  for (let n = 0; n < count; n += 1) {
    const [x, y] = pick();
    const size = (level === 1 ? 3.4 : 4.6) + random() * 2;
    const flicker = Math.sin((phase + random()) * TAU);
    flame(fires, x, Math.min(y, image.anchorY - 4), size * (1 + flicker * 0.14), flicker);
  }
  compositeOver(out, fires.toImage());
  return out;
}

function variantsOf(info: BuildingInfo): { name: string; key: string; style: Style; set: ArchitectureSet | null }[] {
  if (info.classes.includes('farm')) {
    return [{ name: 'main', key: info.id, style: STYLES.common, set: null }];
  }
  if (info.classes.includes('wall') || info.classes.includes('tower')) {
    return SETS.map((set) => ({ name: set, key: `${info.id}.${set}`, style: STYLES[`${set}.iron`], set }));
  }
  const out: { name: string; key: string; style: Style; set: ArchitectureSet | null }[] = [];
  for (const age of AGES.slice(AGES.indexOf(info.age))) {
    if (age === 'stone') {
      out.push({ name: 'stone', key: `${info.id}.stone`, style: STYLES.common, set: null });
      continue;
    }
    for (const set of SETS) {
      out.push({ name: `${set}_${age}`, key: `${info.id}.${set}.${age}`, style: STYLES[`${set}.${age}`], set });
    }
  }
  return out;
}

function composeBuilding(info: BuildingInfo, s: Style, set: ArchitectureSet | null, phase: number): Image {
  const b = new Builder(info.size, phase);
  if (info.classes.includes('farm')) {
    composeFarm(b, 3);
  } else if (info.classes.includes('wall')) {
    composeWall(b, info.id, set ?? 'egyptian');
  } else if (info.classes.includes('tower')) {
    composeTower(b, info.id, set ?? 'egyptian');
  } else {
    const compose = COMPOSERS[info.id] ?? COMPOSERS.barracks;
    compose(b, s);
  }
  return b.render(maxHeight(info));
}

export function renderBuilding(info: BuildingInfo, variant: string, phase = 0): Image {
  const found = variantsOf(info).find((candidate) => candidate.name === variant) ?? variantsOf(info)[0];
  return composeBuilding(info, found.style, found.set, phase);
}

export function buildingVariantNames(info: BuildingInfo): string[] {
  return variantsOf(info).map((variant) => variant.name);
}

export function renderSite(info: BuildingInfo, stage: number): Image {
  const b = new Builder(info.size, 0);
  if (info.classes.includes('farm')) {
    composeFarm(b, stage);
  } else {
    composeSite(b, info, stage);
  }
  return b.render(maxHeight(info));
}

export function renderDamaged(info: BuildingInfo, variant: string, level: number, phase: number): Image {
  return damage(
    renderBuilding(info, variant, 0),
    level,
    seedOf(`${info.id}.${variant}`),
    phase,
    info.classes.includes('farm'),
  );
}

const IDLE_PHASES = [0, 1 / 3, 2 / 3];
const FIRE_PHASES = [0, 0.5];

export function buildBuildingAtlas(info: BuildingInfo): { atlas: AtlasBuilder; sprites: BuildingSprite[] } {
  const atlas = new AtlasBuilder(`buildings/${info.id}`);
  const sprites: BuildingSprite[] = [];
  const flat = info.classes.includes('farm');
  for (let stage = 0; stage < 3; stage += 1) {
    atlas.addAnimation(`build_${stage}`, [renderSite(info, stage)]);
  }
  for (const variant of variantsOf(info)) {
    const idle = flat || info.classes.includes('wall') ? [0] : IDLE_PHASES;
    atlas.addAnimation(
      `${variant.name}_idle`,
      idle.map((phase) => composeBuilding(info, variant.style, variant.set, phase)),
      3,
    );
    const still = composeBuilding(info, variant.style, variant.set, 0);
    const seed = seedOf(`${info.id}.${variant.name}`);
    atlas.addAnimation(`${variant.name}_damaged_1`, [damage(still, 1, seed, 0, true)]);
    atlas.addAnimation(
      `${variant.name}_damaged_2`,
      (flat ? [0] : FIRE_PHASES).map((phase) => damage(still, 2, seed, phase, flat)),
      2,
    );
    sprites.push({
      key: variant.key,
      aliases: {
        idle: `${variant.name}_idle`,
        damaged_1: `${variant.name}_damaged_1`,
        damaged_2: `${variant.name}_damaged_2`,
      },
    });
  }
  for (const set of SETS) {
    const earliest = sprites.find((sprite) => sprite.key === `${info.id}.${set}.${info.age}`);
    if (earliest) {
      sprites.push({ key: `${info.id}.${set}`, aliases: earliest.aliases });
    }
  }
  return { atlas, sprites };
}
