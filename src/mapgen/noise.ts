import type { RngHolder } from '../sim/rng';
import { nextFloat } from '../sim/rng';

const MIN_CELL = 2;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function addOctave(
  out: Float32Array,
  size: number,
  rng: RngHolder,
  cell: number,
  weight: number,
): void {
  const cols = Math.ceil(size / cell) + 2;
  const lattice = new Float32Array(cols * cols);
  for (let i = 0; i < lattice.length; i++) {
    lattice[i] = nextFloat(rng);
  }
  for (let y = 0; y < size; y++) {
    const gy = y / cell;
    const y0 = Math.floor(gy);
    const ty = smooth(gy - y0);
    for (let x = 0; x < size; x++) {
      const gx = x / cell;
      const x0 = Math.floor(gx);
      const tx = smooth(gx - x0);
      const row = y0 * cols + x0;
      const top = lattice[row] + (lattice[row + 1] - lattice[row]) * tx;
      const bottom = lattice[row + cols] + (lattice[row + cols + 1] - lattice[row + cols]) * tx;
      out[y * size + x] += weight * (top + (bottom - top) * ty);
    }
  }
}

export function noiseField(rng: RngHolder, size: number, scale: number, octaves = 3): Float32Array {
  const out = new Float32Array(size * size);
  let cell = Math.max(MIN_CELL, scale);
  let weight = 1;
  for (let octave = 0; octave < octaves; octave++) {
    addOctave(out, size, rng, cell, weight);
    cell = Math.max(MIN_CELL, cell / 2);
    weight /= 2;
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < out.length; i++) {
    min = Math.min(min, out[i]);
    max = Math.max(max, out[i]);
  }
  const span = max - min || 1;
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i] - min) / span;
  }
  return out;
}
