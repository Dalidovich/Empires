import type { FogView } from '../sim/snapshot';
import { FOG } from '../sim/types';
import type { FogState } from '../sim/types';

export const FOG_ALPHA: Record<FogState, number> = {
  [FOG.unexplored]: 255,
  [FOG.explored]: 118,
  [FOG.visible]: 0,
};

export const FOG_DIM = 0.55;

export function fogStateAt(fog: FogView, index: number): FogState {
  if ((fog.visible[index] ?? 0) > 0) {
    return FOG.visible;
  }
  return (fog.explored[index] ?? 0) > 0 ? FOG.explored : FOG.unexplored;
}

export function writeFogPixels(fog: FogView, pixels: Uint8ClampedArray, tiles: number): boolean {
  let changed = false;
  for (let i = 0; i < tiles; i += 1) {
    const alpha = FOG_ALPHA[fogStateAt(fog, i)];
    const at = i * 4 + 3;
    if (pixels[at] !== alpha) {
      pixels[at] = alpha;
      changed = true;
    }
  }
  return changed;
}

export class FogCanvas {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private image: ImageData;
  private size = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1;
    this.canvas.height = 1;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas context is not available');
    }
    this.context = context;
    this.image = context.createImageData(1, 1);
  }

  update(fog: FogView, size: number): boolean {
    let changed = false;
    if (size !== this.size) {
      this.size = size;
      this.canvas.width = Math.max(1, size);
      this.canvas.height = Math.max(1, size);
      this.image = this.context.createImageData(this.canvas.width, this.canvas.height);
      this.image.data.fill(0);
      for (let i = 3; i < this.image.data.length; i += 4) {
        this.image.data[i] = 1;
      }
      changed = true;
    }
    if (writeFogPixels(fog, this.image.data, size * size)) {
      changed = true;
    }
    if (changed) {
      this.context.putImageData(this.image, 0, 0);
    }
    return changed;
  }
}
