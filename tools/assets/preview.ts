import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { encodePng } from './png';
import type { Image } from './raster';

const BACKGROUND = [93, 143, 58];

export function writeSheet(
  file: string,
  images: readonly Image[],
  columns: number,
  tint: number,
  zoom = 2,
  background: readonly number[] = BACKGROUND,
): void {
  if (images.length === 0) {
    return;
  }
  let cellWidth = 0;
  let cellHeight = 0;
  for (const image of images) {
    cellWidth = Math.max(cellWidth, image.width);
    cellHeight = Math.max(cellHeight, image.height);
  }
  const rows = Math.ceil(images.length / columns);
  const width = cellWidth * columns * zoom;
  const height = cellHeight * rows * zoom;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    out[i * 4] = background[0];
    out[i * 4 + 1] = background[1];
    out[i * 4 + 2] = background[2];
    out[i * 4 + 3] = 255;
  }
  const tr = (tint >> 16) & 0xff;
  const tg = (tint >> 8) & 0xff;
  const tb = tint & 0xff;
  images.forEach((image, index) => {
    const left = (index % columns) * cellWidth * zoom;
    const top = Math.floor(index / columns) * cellHeight * zoom;
    for (let y = 0; y < image.height * zoom; y += 1) {
      for (let x = 0; x < image.width * zoom; x += 1) {
        const s = (Math.floor(y / zoom) * image.width + Math.floor(x / zoom)) * 4;
        const o = ((top + y) * width + left + x) * 4;
        const a = image.data[s + 3] / 255;
        let r = out[o] * (1 - a) + image.data[s] * a;
        let g = out[o + 1] * (1 - a) + image.data[s + 1] * a;
        let b = out[o + 2] * (1 - a) + image.data[s + 2] * a;
        const m = image.mask[s + 3] / 255;
        if (m > 0) {
          const shade = image.mask[s] / 255;
          r = r * (1 - m) + tr * shade * m;
          g = g * (1 - m) + tg * shade * m;
          b = b * (1 - m) + tb * shade * m;
        }
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
      }
    }
  });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodePng(width, height, out));
}
