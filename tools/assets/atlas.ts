import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodePng } from './png';
import { baseFrame, hasMask, maskFrame } from './raster';
import type { Frame, Image } from './raster';

export const MASK_SUFFIX = '_mask';
const PADDING = 1;
const MAX_SIDE = 4096;

interface Entry {
  name: string;
  frame: Frame;
  x: number;
  y: number;
}

export interface AtlasStats {
  file: string;
  width: number;
  height: number;
  frames: number;
  bytes: number;
}

export class AtlasBuilder {
  readonly name: string;
  private readonly entries: Entry[] = [];
  private readonly animations = new Map<string, string[]>();
  private readonly prefix: string;

  constructor(name: string, prefix = `${name.replace(/[^a-z0-9]+/gi, '_')}__`) {
    this.name = name;
    this.prefix = prefix;
  }

  get animationNames(): string[] {
    return [...this.animations.keys()];
  }

  has(animation: string): boolean {
    return this.animations.has(animation);
  }

  addAnimation(animation: string, images: readonly Image[], hold = 1): void {
    const masked = images.some(hasMask);
    const names: string[] = [];
    const maskNames: string[] = [];
    images.forEach((image, index) => {
      const name = `${this.prefix}${animation}_${index}`;
      this.entries.push({ name, frame: baseFrame(image), x: 0, y: 0 });
      for (let k = 0; k < hold; k += 1) {
        names.push(name);
      }
      if (masked) {
        const maskName = `${this.prefix}${animation}${MASK_SUFFIX}_${index}`;
        this.entries.push({ name: maskName, frame: maskFrame(image), x: 0, y: 0 });
        for (let k = 0; k < hold; k += 1) {
          maskNames.push(maskName);
        }
      }
    });
    this.animations.set(animation, names);
    if (masked) {
      this.animations.set(`${animation}${MASK_SUFFIX}`, maskNames);
    }
  }

  addFrame(name: string, frame: Frame): void {
    this.entries.push({ name, frame, x: 0, y: 0 });
  }

  write(root: string): AtlasStats {
    const size = this.pack();
    const pixels = new Uint8ClampedArray(size.width * size.height * 4);
    const frames: Record<string, unknown> = {};
    for (const entry of this.entries) {
      const { frame } = entry;
      for (let y = 0; y < frame.height; y += 1) {
        pixels.set(
          frame.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4),
          ((entry.y + y) * size.width + entry.x) * 4,
        );
      }
      frames[entry.name] = {
        frame: { x: entry.x, y: entry.y, w: frame.width, h: frame.height },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: frame.width, h: frame.height },
        sourceSize: { w: frame.width, h: frame.height },
        anchor: {
          x: Number((frame.anchorX / frame.width).toFixed(4)),
          y: Number((frame.anchorY / frame.height).toFixed(4)),
        },
      };
    }
    const imageName = `${this.name.split('/').pop() ?? this.name}.png`;
    const json = {
      frames,
      animations: Object.fromEntries(this.animations),
      meta: {
        image: imageName,
        format: 'RGBA8888',
        size: { w: size.width, h: size.height },
        scale: '1',
      },
    };
    const png = encodePng(size.width, size.height, pixels);
    const jsonPath = join(root, `${this.name}.json`);
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify(json)}\n`);
    writeFileSync(join(root, `${this.name}.png`), png);
    return {
      file: `${this.name}.json`,
      width: size.width,
      height: size.height,
      frames: this.entries.length,
      bytes: png.length,
    };
  }

  private pack(): { width: number; height: number } {
    const order = this.entries.slice().sort((a, b) => b.frame.height - a.frame.height || b.frame.width - a.frame.width);
    let area = 0;
    let widest = 0;
    for (const entry of order) {
      area += (entry.frame.width + PADDING) * (entry.frame.height + PADDING);
      widest = Math.max(widest, entry.frame.width);
    }
    let width = Math.max(widest + PADDING * 2, Math.ceil(Math.sqrt(area * 1.1) / 32) * 32);
    for (;;) {
      const height = this.shelve(order, width);
      if (height <= MAX_SIDE && height <= width * 1.25) {
        return { width, height };
      }
      if (width >= MAX_SIDE) {
        if (height > MAX_SIDE) {
          throw new Error(`Atlas ${this.name} does not fit into ${MAX_SIDE}x${MAX_SIDE}`);
        }
        return { width, height };
      }
      width = Math.min(MAX_SIDE, width + 32);
    }
  }

  private shelve(order: readonly Entry[], width: number): number {
    let x = PADDING;
    let y = PADDING;
    let row = 0;
    for (const entry of order) {
      if (x + entry.frame.width + PADDING > width) {
        x = PADDING;
        y += row + PADDING;
        row = 0;
      }
      entry.x = x;
      entry.y = y;
      x += entry.frame.width + PADDING;
      row = Math.max(row, entry.frame.height);
    }
    return y + row + PADDING;
  }
}
