export const SCALE = 4;

export interface Paint {
  r: number;
  g: number;
  b: number;
  a: number;
  team: number;
  noise: number;
}

export interface Image {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  data: Uint8ClampedArray;
  mask: Uint8ClampedArray;
}

export interface Frame {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  data: Uint8ClampedArray;
}

const TEAM_BASE = 190;

export function rgb(hex: number, alpha = 1, noise = 0): Paint {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff, a: alpha, team: -1, noise };
}

export function team(shade = 0.8): Paint {
  const value = TEAM_BASE * shade;
  return { r: value, g: value, b: value, a: 1, team: Math.min(1, shade), noise: 0 };
}

export function lighten(paint: Paint, factor: number): Paint {
  if (paint.team >= 0) {
    const shade = Math.min(1, Math.max(0.05, paint.team * factor));
    return { ...team(shade), a: paint.a };
  }
  return {
    ...paint,
    r: Math.min(255, paint.r * factor),
    g: Math.min(255, paint.g * factor),
    b: Math.min(255, paint.b * factor),
  };
}

export function withAlpha(paint: Paint, alpha: number): Paint {
  return { ...paint, a: alpha };
}

export function withNoise(paint: Paint, noise: number): Paint {
  return { ...paint, noise };
}

export function mix(a: Paint, b: Paint, t: number): Paint {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: a.a + (b.a - a.a) * t,
    team: a.team,
    noise: a.noise,
  };
}

export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

export function randomOf(seed: number): () => number {
  let state = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function seedOf(text: string): number {
  let seed = 7;
  for (let i = 0; i < text.length; i += 1) {
    seed = (Math.imul(seed, 31) + text.charCodeAt(i)) >>> 0;
  }
  return seed;
}

export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly anchorX: number;
  readonly anchorY: number;
  private readonly w: number;
  private readonly h: number;
  private readonly color: Uint8ClampedArray;
  private readonly mask: Uint8Array;

  constructor(width: number, height: number, anchorX: number, anchorY: number) {
    this.width = width;
    this.height = height;
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.w = width * SCALE;
    this.h = height * SCALE;
    this.color = new Uint8ClampedArray(this.w * this.h * 4);
    this.mask = new Uint8Array(this.w * this.h);
  }

  polygon(points: readonly number[], paint: Paint): void {
    const count = points.length / 2;
    if (count < 3) {
      return;
    }
    const xs = new Float64Array(count);
    const ys = new Float64Array(count);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i += 1) {
      xs[i] = (points[i * 2] + this.anchorX) * SCALE;
      ys[i] = (points[i * 2 + 1] + this.anchorY) * SCALE;
      minY = Math.min(minY, ys[i]);
      maxY = Math.max(maxY, ys[i]);
    }
    const rowStart = Math.max(0, Math.floor(minY));
    const rowEnd = Math.min(this.h - 1, Math.ceil(maxY));
    const crossings: number[] = [];
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const y = row + 0.5;
      crossings.length = 0;
      for (let i = 0; i < count; i += 1) {
        const j = (i + 1) % count;
        const y0 = ys[i];
        const y1 = ys[j];
        if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
          crossings.push(xs[i] + ((y - y0) / (y1 - y0)) * (xs[j] - xs[i]));
        }
      }
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.ceil(crossings[k] - 0.5));
        const to = Math.min(this.w - 1, Math.floor(crossings[k + 1] - 0.5));
        for (let x = from; x <= to; x += 1) {
          this.put(x, row, paint);
        }
      }
    }
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, paint: Paint, cutBelow = Infinity): void {
    if (rx <= 0 || ry <= 0) {
      return;
    }
    const centerX = (cx + this.anchorX) * SCALE;
    const centerY = (cy + this.anchorY) * SCALE;
    const radiusX = rx * SCALE;
    const radiusY = ry * SCALE;
    const limit = (cutBelow + this.anchorY) * SCALE;
    const rowStart = Math.max(0, Math.floor(centerY - radiusY));
    const rowEnd = Math.min(this.h - 1, Math.ceil(Math.min(centerY + radiusY, limit)));
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const dy = (row + 0.5 - centerY) / radiusY;
      const span = 1 - dy * dy;
      if (span <= 0 || row + 0.5 > limit) {
        continue;
      }
      const half = Math.sqrt(span) * radiusX;
      const from = Math.max(0, Math.ceil(centerX - half - 0.5));
      const to = Math.min(this.w - 1, Math.floor(centerX + half - 0.5));
      for (let x = from; x <= to; x += 1) {
        this.put(x, row, paint);
      }
    }
  }

  capsule(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width0: number,
    width1: number,
    paint: Paint,
  ): void {
    const ax = (x0 + this.anchorX) * SCALE;
    const ay = (y0 + this.anchorY) * SCALE;
    const bx = (x1 + this.anchorX) * SCALE;
    const by = (y1 + this.anchorY) * SCALE;
    const r0 = (width0 / 2) * SCALE;
    const r1 = (width1 / 2) * SCALE;
    const reach = Math.max(r0, r1);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const rowStart = Math.max(0, Math.floor(Math.min(ay, by) - reach));
    const rowEnd = Math.min(this.h - 1, Math.ceil(Math.max(ay, by) + reach));
    const colStart = Math.max(0, Math.floor(Math.min(ax, bx) - reach));
    const colEnd = Math.min(this.w - 1, Math.ceil(Math.max(ax, bx) + reach));
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const py = row + 0.5 - ay;
      for (let col = colStart; col <= colEnd; col += 1) {
        const px = col + 0.5 - ax;
        let t = lengthSq > 0 ? (px * dx + py * dy) / lengthSq : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ox = px - dx * t;
        const oy = py - dy * t;
        const radius = r0 + (r1 - r0) * t;
        if (ox * ox + oy * oy <= radius * radius) {
          this.put(col, row, paint);
        }
      }
    }
  }

  toImage(): Image {
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    const mask = new Uint8ClampedArray(this.width * this.height * 4);
    const samples = SCALE * SCALE;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        let shade = 0;
        let covered = 0;
        for (let sy = 0; sy < SCALE; sy += 1) {
          const rowBase = (y * SCALE + sy) * this.w + x * SCALE;
          for (let sx = 0; sx < SCALE; sx += 1) {
            const index = rowBase + sx;
            const o = index * 4;
            const alpha = this.color[o + 3];
            r += this.color[o] * alpha;
            g += this.color[o + 1] * alpha;
            b += this.color[o + 2] * alpha;
            a += alpha;
            const m = this.mask[index];
            if (m > 0) {
              shade += m;
              covered += 1;
            }
          }
        }
        const out = (y * this.width + x) * 4;
        if (a > 0) {
          data[out] = r / a;
          data[out + 1] = g / a;
          data[out + 2] = b / a;
          data[out + 3] = a / samples;
        }
        if (covered > 0) {
          const value = shade / covered;
          mask[out] = value;
          mask[out + 1] = value;
          mask[out + 2] = value;
          mask[out + 3] = (covered / samples) * 255;
        }
      }
    }
    return { width: this.width, height: this.height, anchorX: this.anchorX, anchorY: this.anchorY, data, mask };
  }

  private put(x: number, y: number, paint: Paint): void {
    const index = y * this.w + x;
    const o = index * 4;
    let r = paint.r;
    let g = paint.g;
    let b = paint.b;
    if (paint.noise > 0) {
      const n = 1 + (hash2(Math.floor(x / SCALE), Math.floor(y / SCALE)) - 0.5) * 2 * paint.noise;
      r *= n;
      g *= n;
      b *= n;
    }
    if (paint.a >= 1) {
      this.color[o] = r;
      this.color[o + 1] = g;
      this.color[o + 2] = b;
      this.color[o + 3] = 255;
      this.mask[index] = paint.team >= 0 ? Math.max(1, Math.round(paint.team * 255)) : 0;
      return;
    }
    const sa = paint.a;
    const da = this.color[o + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 0) {
      return;
    }
    this.color[o] = (r * sa + this.color[o] * da * (1 - sa)) / outA;
    this.color[o + 1] = (g * sa + this.color[o + 1] * da * (1 - sa)) / outA;
    this.color[o + 2] = (b * sa + this.color[o + 2] * da * (1 - sa)) / outA;
    this.color[o + 3] = outA * 255;
    if (this.mask[index] > 0) {
      const luminance = (r + g + b) / 765;
      const target = this.mask[index] * (1 - sa) + this.mask[index] * luminance * sa;
      this.mask[index] = Math.max(1, Math.round(target));
    }
  }
}

export function outline(image: Image, color = 0x1c1611, alpha = 215): void {
  const { width, height, data } = image;
  const source = data.slice();
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && source[(y * width + x) * 4 + 3] >= 110;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      const own = source[o + 3];
      if (own >= 110) {
        continue;
      }
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        const keep = own / 255;
        data[o] = ((color >> 16) & 0xff) * (1 - keep) + source[o] * keep;
        data[o + 1] = ((color >> 8) & 0xff) * (1 - keep) + source[o + 1] * keep;
        data[o + 2] = (color & 0xff) * (1 - keep) + source[o + 2] * keep;
        data[o + 3] = Math.max(own, alpha);
      }
    }
  }
}

export function compositeOver(target: Image, top: Image): void {
  const count = target.width * target.height;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const sa = top.data[o + 3] / 255;
    if (sa <= 0) {
      continue;
    }
    const da = target.data[o + 3] / 255;
    const outA = sa + da * (1 - sa);
    for (let c = 0; c < 3; c += 1) {
      target.data[o + c] = (top.data[o + c] * sa + target.data[o + c] * da * (1 - sa)) / outA;
    }
    target.data[o + 3] = outA * 255;
    if (top.mask[o + 3] > 0) {
      target.mask[o] = top.mask[o];
      target.mask[o + 1] = top.mask[o + 1];
      target.mask[o + 2] = top.mask[o + 2];
      target.mask[o + 3] = Math.max(target.mask[o + 3] * (1 - sa), top.mask[o + 3]);
    } else {
      target.mask[o + 3] *= 1 - sa;
    }
  }
}

export function compositeUnder(target: Image, bottom: Image): void {
  const count = target.width * target.height;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const ta = target.data[o + 3] / 255;
    const ba = bottom.data[o + 3] / 255;
    if (ba <= 0 || ta >= 1) {
      continue;
    }
    const outA = ta + ba * (1 - ta);
    for (let c = 0; c < 3; c += 1) {
      target.data[o + c] = (target.data[o + c] * ta + bottom.data[o + c] * ba * (1 - ta)) / outA;
    }
    target.data[o + 3] = outA * 255;
  }
}

export function clipBelow(image: Image, line: number): void {
  const start = Math.max(0, Math.round(image.anchorY + line));
  for (let y = start; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const o = (y * image.width + x) * 4;
      image.data[o + 3] = 0;
      image.mask[o + 3] = 0;
    }
  }
}

export function fade(image: Image, factor: number): void {
  const count = image.width * image.height;
  for (let i = 0; i < count; i += 1) {
    image.data[i * 4 + 3] *= factor;
    image.mask[i * 4 + 3] *= factor;
  }
}

function crop(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  anchorX: number,
  anchorY: number,
): Frame {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (source[(y * width + x) * 4 + 3] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) {
    return { width: 1, height: 1, anchorX: 0, anchorY: 0, data: new Uint8ClampedArray(4) };
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const from = ((y + minY) * width + minX) * 4;
    data.set(source.subarray(from, from + w * 4), y * w * 4);
  }
  return { width: w, height: h, anchorX: anchorX - minX, anchorY: anchorY - minY, data };
}

export function hasMask(image: Image): boolean {
  for (let i = 3; i < image.mask.length; i += 4) {
    if (image.mask[i] > 0) {
      return true;
    }
  }
  return false;
}

export function baseFrame(image: Image): Frame {
  return crop(image.data, image.width, image.height, image.anchorX, image.anchorY);
}

export function maskFrame(image: Image): Frame {
  return crop(image.mask, image.width, image.height, image.anchorX, image.anchorY);
}
