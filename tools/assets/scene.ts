import { Canvas, clipBelow, compositeUnder, lighten, outline, rgb } from './raster';
import type { Image, Paint } from './raster';

export type P3 = readonly [number, number, number];
export type P2 = readonly [number, number];

export interface RenderOptions {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  outline?: boolean;
  waterline?: number;
}

export interface DrawOptions {
  bias?: number;
  flat?: boolean;
  edge?: boolean;
}

export interface PrismOptions {
  bias?: number;
  topScale?: number;
  bottomScale?: number;
  contrast?: number;
}

interface Item {
  depth: number;
  seq: number;
  draw(canvas: Canvas): void;
}

interface Shadow {
  x: number;
  y: number;
  rx: number;
  ry: number;
  paint: Paint;
}

type Transform = (point: P3) => P3;

const HIGHLIGHT = 1.22;
const EDGE = rgb(0x1c1611, 0.5);
const EDGE_WIDTH = 0.55;

export function add(a: P3, b: P3): P3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function lerp3(a: P3, b: P3, t: number): P3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class Scene {
  filter: ((paint: Paint) => Paint) | null = null;
  private readonly cos: number;
  private readonly sin: number;
  private readonly sorted: boolean;
  private readonly items: Item[] = [];
  private readonly shadows: Shadow[] = [];
  private readonly transforms: Transform[] = [];

  constructor(heading = 0, sorted = true) {
    this.cos = Math.cos(heading);
    this.sin = Math.sin(heading);
    this.sorted = sorted;
  }

  push(transform: Transform): void {
    this.transforms.push(transform);
  }

  pop(): void {
    this.transforms.pop();
  }

  ground(point: P3): P3 {
    let p = point;
    for (let i = this.transforms.length - 1; i >= 0; i -= 1) {
      p = this.transforms[i](p);
    }
    return [p[0] * this.cos - p[1] * this.sin, p[0] * this.sin + p[1] * this.cos, p[2]];
  }

  ball(center: P3, radius: number, paint: Paint, options: DrawOptions = {}): void {
    const g = this.ground(center);
    const x = g[0];
    const y = g[1] * 0.5 - g[2];
    const fill = this.paint(paint);
    const flat = options.flat === true || radius < 1.6;
    this.add(g[1] + (options.bias ?? 0), (canvas) => {
      if (options.edge !== false) {
        canvas.ellipse(x, y, radius + EDGE_WIDTH, radius + EDGE_WIDTH, EDGE);
      }
      canvas.ellipse(x, y, radius, radius, fill);
      if (!flat) {
        canvas.ellipse(x - radius * 0.28, y - radius * 0.32, radius * 0.52, radius * 0.5, lighten(fill, HIGHLIGHT));
      }
    });
  }

  dome(center: P3, radius: number, paint: Paint, options: DrawOptions = {}): void {
    const g = this.ground(center);
    const x = g[0];
    const y = g[1] * 0.5 - g[2];
    const fill = this.paint(paint);
    this.add(g[1] + (options.bias ?? 0), (canvas) => {
      canvas.ellipse(x, y, radius + EDGE_WIDTH, radius + EDGE_WIDTH, EDGE, y - radius * 0.22);
      canvas.ellipse(x, y, radius, radius, fill, y - radius * 0.3);
      if (options.flat !== true) {
        canvas.ellipse(x - radius * 0.3, y - radius * 0.4, radius * 0.45, radius * 0.4, lighten(fill, HIGHLIGHT));
      }
    });
  }

  limb(a: P3, b: P3, width0: number, width1: number, paint: Paint, options: DrawOptions = {}): void {
    const ga = this.ground(a);
    const gb = this.ground(b);
    const ax = ga[0];
    const ay = ga[1] * 0.5 - ga[2];
    const bx = gb[0];
    const by = gb[1] * 0.5 - gb[2];
    const fill = this.paint(paint);
    const flat = options.flat === true || Math.max(width0, width1) < 3.4;
    this.add((ga[1] + gb[1]) / 2 + (options.bias ?? 0), (canvas) => {
      if (options.edge !== false) {
        canvas.capsule(ax, ay, bx, by, width0 + EDGE_WIDTH * 2, width1 + EDGE_WIDTH * 2, EDGE);
      }
      canvas.capsule(ax, ay, bx, by, width0, width1, fill);
      if (!flat) {
        const shift0 = width0 * 0.2;
        const shift1 = width1 * 0.2;
        canvas.capsule(
          ax - shift0,
          ay - shift0,
          bx - shift1,
          by - shift1,
          width0 * 0.42,
          width1 * 0.42,
          lighten(fill, HIGHLIGHT),
        );
      }
    });
  }

  poly(points: readonly P3[], paint: Paint, options: DrawOptions = {}): void {
    const flatPoints: number[] = [];
    let depth = 0;
    for (const point of points) {
      const g = this.ground(point);
      flatPoints.push(g[0], g[1] * 0.5 - g[2]);
      depth += g[1];
    }
    const fill = this.paint(paint);
    this.add(depth / points.length + (options.bias ?? 0), (canvas) => {
      canvas.polygon(flatPoints, fill);
    });
  }

  disc(center: P3, axis: 'f' | 'l' | 'u', radius: number, paint: Paint, options: DrawOptions = {}): void {
    const points: P3[] = [];
    for (let i = 0; i < 20; i += 1) {
      const angle = (i / 20) * Math.PI * 2;
      const c = Math.cos(angle) * radius;
      const s = Math.sin(angle) * radius;
      if (axis === 'l') {
        points.push([center[0] + c, center[1], center[2] + s]);
      } else if (axis === 'f') {
        points.push([center[0], center[1] + c, center[2] + s]);
      } else {
        points.push([center[0] + c, center[1] + s, center[2]]);
      }
    }
    this.poly(points, paint, options);
  }

  prism(
    shape: readonly P2[],
    u0: number,
    u1: number,
    side: Paint,
    top: Paint,
    options: PrismOptions = {},
  ): void {
    let cf = 0;
    let cl = 0;
    for (const point of shape) {
      cf += point[0];
      cl += point[1];
    }
    cf /= shape.length;
    cl /= shape.length;
    const topScale = options.topScale ?? 1;
    const bottomScale = options.bottomScale ?? 1;
    const contrast = options.contrast ?? 0.22;
    const lower = shape.map((point) =>
      this.ground([cf + (point[0] - cf) * bottomScale, cl + (point[1] - cl) * bottomScale, u0]),
    );
    const upper = shape.map((point) =>
      this.ground([cf + (point[0] - cf) * topScale, cl + (point[1] - cl) * topScale, u1]),
    );
    const center = this.ground([cf, cl, u0]);
    const sidePaint = this.paint(side);
    const topPaint = this.paint(top);
    const faces: { points: number[]; paint: Paint; depth: number }[] = [];
    for (let i = 0; i < shape.length; i += 1) {
      const j = (i + 1) % shape.length;
      const a = lower[i];
      const b = lower[j];
      let nx = b[1] - a[1];
      let ny = -(b[0] - a[0]);
      const length = Math.hypot(nx, ny) || 1;
      nx /= length;
      ny /= length;
      const mx = (a[0] + b[0]) / 2 - center[0];
      const my = (a[1] + b[1]) / 2 - center[1];
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      if (ny <= 0.03) {
        continue;
      }
      const c = upper[j];
      const d = upper[i];
      faces.push({
        points: [
          a[0],
          a[1] * 0.5 - a[2],
          b[0],
          b[1] * 0.5 - b[2],
          c[0],
          c[1] * 0.5 - c[2],
          d[0],
          d[1] * 0.5 - d[2],
        ],
        paint: lighten(sidePaint, 0.82 - contrast * nx),
        depth: (a[1] + b[1]) / 2,
      });
    }
    faces.sort((p, q) => p.depth - q.depth);
    const topPoints: number[] = [];
    for (const point of upper) {
      topPoints.push(point[0], point[1] * 0.5 - point[2]);
    }
    this.add(center[1] + (options.bias ?? 0), (canvas) => {
      for (const face of faces) {
        canvas.polygon(face.points, face.paint);
      }
      canvas.polygon(topPoints, topPaint);
    });
  }

  shadow(center: P3, radiusX: number, radiusY: number, alpha = 0.28, color = 0x000000): void {
    const g = this.ground(center);
    this.shadows.push({ x: g[0], y: g[1] * 0.5 - g[2], rx: radiusX, ry: radiusY, paint: rgb(color, alpha) });
  }

  render(options: RenderOptions): Image {
    const canvas = new Canvas(options.width, options.height, options.anchorX, options.anchorY);
    const items = this.sorted
      ? this.items.slice().sort((a, b) => a.depth - b.depth || a.seq - b.seq)
      : this.items;
    for (const item of items) {
      item.draw(canvas);
    }
    const image = canvas.toImage();
    if (options.waterline !== undefined) {
      clipBelow(image, options.waterline);
    }
    if (options.outline !== false) {
      outline(image);
    }
    if (this.shadows.length > 0) {
      const under = new Canvas(options.width, options.height, options.anchorX, options.anchorY);
      for (const shadow of this.shadows) {
        under.ellipse(shadow.x, shadow.y, shadow.rx, shadow.ry, shadow.paint);
      }
      compositeUnder(image, under.toImage());
    }
    return image;
  }

  private paint(paint: Paint): Paint {
    return this.filter ? this.filter(paint) : paint;
  }

  private add(depth: number, draw: (canvas: Canvas) => void): void {
    this.items.push({ depth, seq: this.items.length, draw });
  }
}
