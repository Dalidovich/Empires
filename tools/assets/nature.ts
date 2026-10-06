import { Canvas, hash2, lighten, randomOf, rgb, team } from './raster';
import type { Frame, Image, Paint } from './raster';
import { Scene } from './scene';
import type { P2, P3 } from './scene';

const TAU = Math.PI * 2;
const LEAVES = [0x3f7a34, 0x4c8a3a, 0x356a2c, 0x5a9440];

function oak(seed: number): Image {
  const random = randomOf(seed);
  const scene = new Scene(0, true);
  scene.shadow([0, 0, 0], 13, 5.5);
  const lean = (random() - 0.5) * 3;
  scene.limb([0, 0, 0], [lean, 0, 15], 4.4, 3, rgb(0x6a4a2c));
  const count = 6 + Math.floor(random() * 3);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * TAU;
    const reach = random() * 7;
    const center: P3 = [lean + Math.cos(angle) * reach, Math.sin(angle) * reach * 0.8, 19 + random() * 13];
    scene.ball(center, 6 + random() * 3, rgb(LEAVES[Math.floor(random() * LEAVES.length)], 1, 0.14));
  }
  return scene.render({ width: 72, height: 84, anchorX: 36, anchorY: 70 });
}

function pine(seed: number): Image {
  const random = randomOf(seed);
  const scene = new Scene(0, false);
  scene.shadow([0, 0, 0], 11, 4.8);
  scene.limb([0, 0, 0], [0, 0, 12], 3.6, 2.6, rgb(0x5a3e26));
  const green = rgb(random() > 0.5 ? 0x2f5f3a : 0x376a36, 1, 0.14);
  const tiers = 4;
  for (let i = 0; i < tiers; i += 1) {
    const base = 7 + i * 8;
    const half = 12 - i * 2.5 + random();
    const apex: P3 = [0, 0, base + 15];
    scene.poly([[-half, 0, base], [0, 0, base - 2], apex], lighten(green, 1.08));
    scene.poly([[0, 0, base - 2], [half, 0, base], apex], lighten(green, 0.74));
  }
  return scene.render({ width: 72, height: 84, anchorX: 36, anchorY: 70 });
}

function bush(seed: number): Image {
  const random = randomOf(seed);
  const scene = new Scene(0, true);
  scene.shadow([0, 0, 0], 11, 4.5);
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * TAU + random();
    scene.ball([Math.cos(angle) * 5, Math.sin(angle) * 4, 4.5 + random() * 3], 5 + random() * 1.5, rgb(LEAVES[i % 3], 1, 0.14));
  }
  scene.ball([0, 0, 8], 5.5, rgb(0x4c8a3a, 1, 0.14));
  for (let i = 0; i < 9; i += 1) {
    const angle = random() * TAU;
    const reach = random() * 8;
    scene.ball([Math.cos(angle) * reach, 6 + random() * 3, 4 + random() * 7 + 3], 1.4, rgb(0xd8344a), {
      flat: true,
      bias: 20,
    });
  }
  return scene.render({ width: 48, height: 44, anchorX: 24, anchorY: 32 });
}

function boulder(scene: Scene, at: P2, size: number, paint: Paint, random: () => number): void {
  const shape: P2[] = [];
  const sides = 6;
  const turn = random() * TAU;
  for (let i = 0; i < sides; i += 1) {
    const angle = turn + (i / sides) * TAU;
    const reach = size * (0.75 + random() * 0.35);
    shape.push([at[0] + Math.cos(angle) * reach, at[1] + Math.sin(angle) * reach]);
  }
  scene.prism(shape, 0, size * (0.9 + random() * 0.5), paint, lighten(paint, 1.2), {
    topScale: 0.5,
    contrast: 0.3,
  });
}

function mine(seed: number, ore: Paint | null): Image {
  const random = randomOf(seed);
  const scene = new Scene(0, true);
  scene.shadow([0, 0, 0], 16, 6.5);
  const rock = ore ? rgb(0x8a7c68, 1, 0.1) : rgb(0xa09e98, 1, 0.1);
  const spots: P2[] = [
    [-7, -4],
    [6, -5],
    [-2, 3],
    [9, 4],
    [-10, 5],
  ];
  spots.forEach((spot, index) => {
    boulder(scene, spot, 6 + random() * 3, lighten(rock, 0.9 + random() * 0.2), random);
    if (ore && index % 2 === 0) {
      boulder(scene, [spot[0] + 2, spot[1] + 4], 3 + random() * 1.5, ore, random);
    }
  });
  if (ore) {
    boulder(scene, [2, 8], 3.6, ore, random);
  }
  return scene.render({ width: 72, height: 56, anchorX: 36, anchorY: 38 });
}

function fish(seed: number, deep: boolean): Image {
  const random = randomOf(seed);
  const scene = new Scene(0, true);
  scene.shadow([0, 0, 0], deep ? 17 : 14, deep ? 8 : 6.5, 0.16, 0xffffff);
  scene.shadow([0, 0, 0], deep ? 11 : 9, deep ? 5 : 4, 0.14, 0xffffff);
  const body = deep ? rgb(0x4a6a86, 0.9) : rgb(0x6a8a94, 0.9);
  const count = deep ? 3 : 4;
  for (let i = 0; i < count; i += 1) {
    const angle = random() * TAU;
    const at: P3 = [(random() - 0.5) * 16, (random() - 0.5) * 10, deep && i === 0 ? 5 : 0.5];
    const length = deep ? 8 : 5.5;
    const head: P3 = [at[0] + Math.cos(angle) * length * 0.5, at[1] + Math.sin(angle) * length * 0.5, at[2]];
    const tail: P3 = [at[0] - Math.cos(angle) * length * 0.5, at[1] - Math.sin(angle) * length * 0.5, at[2]];
    scene.limb(head, tail, deep ? 3.6 : 2.6, 1, body, { flat: true, edge: false });
    scene.ball([tail[0] - Math.cos(angle) * 1.2, tail[1] - Math.sin(angle) * 1.2, at[2]], 1.5, body, {
      flat: true,
      edge: false,
    });
    if (deep && i === 0) {
      scene.ball([head[0], head[1], 1], 2.2, rgb(0xffffff, 0.5), { flat: true, edge: false });
    }
  }
  return scene.render({ width: 56, height: 44, anchorX: 28, anchorY: 26, outline: false });
}

export function treeImages(): Image[] {
  return [oak(11), oak(23), pine(5), oak(37), pine(9), oak(51)];
}

export function bushImages(): Image[] {
  return [bush(3), bush(8)];
}

export function goldImages(): Image[] {
  return [mine(4, rgb(0xe8c040)), mine(17, rgb(0xf0cc50))];
}

export function stoneImages(): Image[] {
  return [mine(6, null), mine(29, null)];
}

export function fishImages(deep: boolean): Image[] {
  return [fish(deep ? 12 : 2, deep), fish(deep ? 31 : 21, deep)];
}

function iso(x: number, y: number, z: number): P3 {
  return [(x - y) * 32, (x + y) * 32, z];
}

export function ruinImages(): Image[] {
  const images: Image[] = [];
  const stone = rgb(0xb8b0a0, 1, 0.1);
  for (let frame = 0; frame < 3; frame += 1) {
    const scene = new Scene(0, false);
    const slab = (half: number, z0: number, z1: number): void => {
      scene.prism(
        [
          [-half * 64, 0],
          [0, -half * 64],
          [half * 64, 0],
          [0, half * 64],
        ],
        z0,
        z1,
        stone,
        lighten(stone, 1.15),
      );
    };
    slab(0.92, 0, 3);
    slab(0.8, 3, 5.5);
    const columns: [number, number, number][] = [
      [-0.55, -0.55, 30],
      [0.45, -0.55, 13],
      [-0.55, 0.45, 22],
    ];
    for (const [x, y, top] of columns) {
      scene.limb(iso(x, y, 7), iso(x, y, 5.5 + top), 5.2, 4.8, rgb(0xd0c8b8));
      scene.ball(iso(x, y, 5.5 + top), 2.2, rgb(0x8a8478), { flat: true });
    }
    scene.limb(iso(0.1, 0.55, 7.5), iso(0.62, 0.2, 7.5), 5, 5, rgb(0xc4bcac));
    scene.ball(iso(0.3, -0.1, 7), 2.6, rgb(0xa8a092));
    scene.ball(iso(-0.1, 0.2, 6.6), 2, rgb(0x98907f));
    const base = iso(0.62, 0.62, 5.5);
    const top: P3 = [base[0], base[1], base[2] + 22];
    scene.limb(base, top, 1.3, 1.3, rgb(0x4e3520), { flat: true });
    const wave = (offset: number): number => Math.sin((frame / 3) * TAU + offset) * 1.3;
    const at = (dx: number, dy: number): P3 => [top[0] + dx, top[1] + 0.01, top[2] - dy];
    scene.poly([at(0.5, 0), at(5.5, wave(0)), at(5.5, 6 + wave(0)), at(0.5, 6)], team(0.95));
    scene.poly([at(5.5, wave(0)), at(10.5, wave(1.6)), at(10.5, 6 + wave(1.6)), at(5.5, 6 + wave(0))], team(0.72));
    images.push(scene.render({ width: 168, height: 128, anchorX: 84, anchorY: 80 }));
  }
  return images;
}

export function artifactImages(): Image[] {
  const images: Image[] = [];
  const gold = rgb(0xe8c040);
  for (let frame = 0; frame < 4; frame += 1) {
    const scene = new Scene(0, true);
    scene.shadow([0, 0, 0], 9, 4);
    const box: P2[] = [
      [-5, -3.6],
      [5, -3.6],
      [5, 3.6],
      [-5, 3.6],
    ];
    scene.prism(box, 0, 5, rgb(0x7a5230), rgb(0x9a6e42));
    scene.prism(box, 1.6, 3.4, team(0.9), team(0.9), { bias: 0.01, topScale: 1.04, bottomScale: 1.04 });
    scene.limb([0, 0, 5.5], [0, 0, 12], 5.4, 4.2, gold, { bias: 0.1 });
    scene.ball([0, 0, 15], 3.2, gold, { bias: 0.1 });
    const spark: P3[] = [
      [3, 2, 16],
      [-3, 3, 11],
      [2, 3, 8],
      [-1, 3, 18],
    ];
    scene.ball(spark[frame], 1.3, rgb(0xffffff), { flat: true, edge: false, bias: 30 });
    scene.ball(spark[(frame + 2) % 4], 0.8, rgb(0xfff4c0), { flat: true, edge: false, bias: 30 });
    images.push(scene.render({ width: 44, height: 48, anchorX: 22, anchorY: 36 }));
  }
  return images;
}

function projectile(width: number, draw: (canvas: Canvas) => void): Image {
  const canvas = new Canvas(width, 12, width / 2, 6);
  draw(canvas);
  return canvas.toImage();
}

export function arrowImage(): Image {
  return projectile(22, (canvas) => {
    canvas.capsule(-8, 0, 5, 0, 1.3, 1.3, rgb(0x8a6a44));
    canvas.polygon([4.5, -2, 9.5, 0, 4.5, 2], rgb(0xc8ccd0));
    canvas.polygon([-9.5, -2, -6, 0, -9.5, 2], rgb(0xf0ead8));
  });
}

export function boltImage(): Image {
  return projectile(30, (canvas) => {
    canvas.capsule(-12, 0, 8, 0, 2, 2, rgb(0x7a5a38));
    canvas.polygon([7, -3, 14, 0, 7, 3], rgb(0xc8ccd0));
    canvas.polygon([-13.5, -2.8, -9, 0, -13.5, 2.8], rgb(0xd8402e));
  });
}

export function stoneImage(): Image {
  return projectile(14, (canvas) => {
    canvas.ellipse(0, 0, 5, 5, rgb(0x5a5852));
    canvas.ellipse(0, 0, 4.2, 4.2, rgb(0x9a9892, 1, 0.15));
    canvas.ellipse(-1.2, -1.4, 2, 1.8, rgb(0xc4c2bc));
  });
}

const TERRAIN_SIZE = 64;

function lattice(x: number, y: number, cells: number, seed: number): number {
  const size = TERRAIN_SIZE / cells;
  const fx = x / size;
  const fy = y / size;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const at = (cx: number, cy: number): number => hash2((cx % cells) + seed * 131, (cy % cells) + seed * 57);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
  return top + (bottom - top) * sy;
}

function fbm(x: number, y: number, seed: number): number {
  return lattice(x, y, 4, seed) * 0.5 + lattice(x, y, 8, seed + 1) * 0.3 + lattice(x, y, 16, seed + 2) * 0.2;
}

type Shader = (x: number, y: number) => [number, number, number];

function tone(hex: number, factor: number): [number, number, number] {
  return [((hex >> 16) & 0xff) * factor, ((hex >> 8) & 0xff) * factor, (hex & 0xff) * factor];
}

function blend(a: [number, number, number], hex: number, t: number): [number, number, number] {
  const b = tone(hex, 1);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const TERRAIN_SHADERS: Record<string, Shader> = {
  grass(x, y) {
    let color = tone(0x64963c, 0.9 + fbm(x, y, 1) * 0.22);
    const speck = hash2(x + 900, y + 17);
    if (speck < 0.07) {
      color = blend(color, 0x3f6e2a, 0.5);
    } else if (speck > 0.94) {
      color = blend(color, 0x9abf5a, 0.45);
    }
    return blend(color, 0x8a8a3c, Math.max(0, fbm(x, y, 9) - 0.62) * 0.9);
  },
  desert(x, y) {
    const ripple = Math.sin(((x + y * 0.5 + fbm(x, y, 3) * 10) / 16) * TAU) * 0.035;
    let color = tone(0xd0b478, 0.94 + fbm(x, y, 2) * 0.12 + ripple);
    if (hash2(x + 300, y + 41) < 0.03) {
      color = blend(color, 0x9a8458, 0.5);
    }
    return color;
  },
  forest(x, y) {
    let color = tone(0x466f30, 0.84 + fbm(x, y, 4) * 0.3);
    const speck = hash2(x + 120, y + 77);
    if (speck < 0.09) {
      color = blend(color, 0x5c4a2a, 0.5);
    } else if (speck > 0.93) {
      color = blend(color, 0x2a4a22, 0.6);
    }
    return color;
  },
  shallows(x, y) {
    const ridge = 1 - Math.abs(2 * fbm(x, y, 5) - 1);
    const color = tone(0x58a8ba, 0.95 + fbm(x, y, 6) * 0.1);
    return blend(color, 0xd8f4f4, ridge ** 6 * 0.5);
  },
  deepWater(x, y) {
    const ridge = 1 - Math.abs(2 * fbm(x, y, 7) - 1);
    const color = tone(0x2a609a, 0.92 + fbm(x, y, 8) * 0.14);
    return blend(color, 0x9ac8e8, ridge ** 7 * 0.4);
  },
  shore(x, y) {
    let color = tone(0xdccb96, 0.95 + fbm(x, y, 10) * 0.1);
    const speck = hash2(x + 500, y + 3);
    if (speck < 0.04) {
      color = blend(color, 0xa89870, 0.5);
    } else if (speck > 0.97) {
      color = blend(color, 0xf4ecd0, 0.6);
    }
    return color;
  },
  cliff(x, y) {
    const strata = Math.sin(((y + fbm(x, y, 11) * 14) / 9) * TAU) * 0.08;
    let color = tone(0x7a7266, 0.9 + fbm(x, y, 12) * 0.26 + strata);
    const speck = hash2(x + 700, y + 29);
    if (speck < 0.06) {
      color = blend(color, 0x4a443c, 0.55);
    } else if (speck > 0.95) {
      color = blend(color, 0xb4aa98, 0.5);
    }
    return color;
  },
};

export function terrainFrames(): Record<string, Frame> {
  const frames: Record<string, Frame> = {};
  for (const [name, shader] of Object.entries(TERRAIN_SHADERS)) {
    const data = new Uint8ClampedArray(TERRAIN_SIZE * TERRAIN_SIZE * 4);
    for (let y = 0; y < TERRAIN_SIZE; y += 1) {
      for (let x = 0; x < TERRAIN_SIZE; x += 1) {
        const [r, g, b] = shader(x, y);
        const o = (y * TERRAIN_SIZE + x) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }
    frames[name] = { width: TERRAIN_SIZE, height: TERRAIN_SIZE, anchorX: 0, anchorY: 0, data };
  }
  return frames;
}
