import type { GameData } from '../data/types';
import type { MapView } from '../sim/snapshot';
import type { Vec2 } from '../sim/types';
import type { ScreenPoint } from './api';
import type { ViewTransform } from './camera';
import type { EntityLayer } from './entities';
import { shadeColor } from './entities';
import {
  MINIMAP_HEIGHT,
  MINIMAP_WIDTH,
  minimapScale,
  minimapToWorld,
  worldToMinimap,
} from './minimapLayout';
import type { MinimapLayout } from './minimapLayout';
import { PING_DURATION_MS } from './overlays';
import type { Ping } from './overlays';
import { terrainColor } from './terrain';

const REFRESH_INTERVAL_MS = 200;
const MIN_DOT_PIXELS = 2;
const ELEVATION_TINT = 0.05;
const BACKGROUND = '#000000';
const FRUSTUM_COLOR = '#ffffff';
const PING_COLOR = '#ff3b30';

function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function parseColor(css: string): [number, number, number] {
  const value = Number.parseInt(css.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly data: GameData;
  private readonly context: CanvasRenderingContext2D | null;
  private readonly composite: HTMLCanvasElement;
  private readonly compositeContext: CanvasRenderingContext2D | null;
  private readonly terrainCanvas: HTMLCanvasElement;
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly colors = new Map<number, string>();
  private layout: MinimapLayout = { width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT, mapSize: 0 };
  private dirty = true;
  private refreshedAt = -Infinity;

  constructor(data: GameData, fogCanvas: HTMLCanvasElement) {
    this.data = data;
    this.fogCanvas = fogCanvas;
    this.canvas = document.createElement('canvas');
    this.canvas.width = MINIMAP_WIDTH;
    this.canvas.height = MINIMAP_HEIGHT;
    this.context = this.canvas.getContext('2d');
    this.composite = document.createElement('canvas');
    this.composite.width = MINIMAP_WIDTH;
    this.composite.height = MINIMAP_HEIGHT;
    this.compositeContext = this.composite.getContext('2d');
    this.terrainCanvas = document.createElement('canvas');
  }

  setMap(map: MapView): void {
    this.layout = { width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT, mapSize: map.size };
    this.terrainCanvas.width = Math.max(1, map.size);
    this.terrainCanvas.height = Math.max(1, map.size);
    const context = this.terrainCanvas.getContext('2d');
    if (!context || map.size <= 0) {
      return;
    }
    const image = context.createImageData(map.size, map.size);
    const palette = new Map<number, [number, number, number]>();
    for (let i = 0; i < map.size * map.size; i += 1) {
      const code = map.terrain[i] ?? 0;
      let rgb = palette.get(code);
      if (!rgb) {
        rgb = parseColor(terrainColor(code));
        palette.set(code, rgb);
      }
      const lift = 1 + (map.elevation[i] ?? 0) * ELEVATION_TINT;
      image.data[i * 4] = Math.min(255, rgb[0] * lift);
      image.data[i * 4 + 1] = Math.min(255, rgb[1] * lift);
      image.data[i * 4 + 2] = Math.min(255, rgb[2] * lift);
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    this.dirty = true;
    this.refreshedAt = -Infinity;
  }

  markDirty(): void {
    this.dirty = true;
  }

  toWorld(point: ScreenPoint): Vec2 {
    return minimapToWorld(this.layout, point);
  }

  draw(
    now: number,
    transform: ViewTransform,
    entities: EntityLayer,
    pings: readonly Ping[],
  ): void {
    const context = this.context;
    if (!context) {
      return;
    }
    if (this.dirty && now - this.refreshedAt >= REFRESH_INTERVAL_MS) {
      this.refresh(entities);
      this.dirty = false;
      this.refreshedAt = now;
    }
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.drawImage(this.composite, 0, 0);
    if (this.layout.mapSize <= 0) {
      return;
    }
    const corners: ScreenPoint[] = [
      { x: 0, y: 0 },
      { x: transform.width, y: 0 },
      { x: transform.width, y: transform.height },
      { x: 0, y: transform.height },
    ];
    context.beginPath();
    corners.forEach((corner, index) => {
      const point = worldToMinimap(this.layout, transform.screenToWorld(corner));
      if (index === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.closePath();
    context.strokeStyle = FRUSTUM_COLOR;
    context.lineWidth = 1;
    context.stroke();
    for (const ping of pings) {
      const age = now - ping.at;
      if (age >= PING_DURATION_MS || Math.floor(age / 250) % 2 === 1) {
        continue;
      }
      const point = worldToMinimap(this.layout, ping.position);
      context.strokeStyle = PING_COLOR;
      context.lineWidth = 2;
      context.beginPath();
      context.arc(point.x, point.y, 6, 0, Math.PI * 2);
      context.moveTo(point.x - 9, point.y);
      context.lineTo(point.x + 9, point.y);
      context.moveTo(point.x, point.y - 9);
      context.lineTo(point.x, point.y + 9);
      context.stroke();
    }
  }

  private refresh(entities: EntityLayer): void {
    const context = this.compositeContext;
    if (!context) {
      return;
    }
    const size = this.layout.mapSize;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, this.composite.width, this.composite.height);
    if (size <= 0) {
      return;
    }
    const scaleX = minimapScale(this.layout);
    const scaleY = this.layout.height / (2 * size);
    context.setTransform(scaleX, scaleY, -scaleX, scaleY, this.layout.width / 2, 0);
    context.imageSmoothingEnabled = false;
    context.drawImage(this.terrainCanvas, 0, 0);
    const dot = Math.max(1, MIN_DOT_PIXELS / scaleX);
    entities.forEachEntity((view, color, dim) => {
      let extent = dot;
      if (view.kind === 'building') {
        extent = Math.max(dot, this.data.buildings[view.type]?.size ?? 1);
      } else if (view.kind === 'resource') {
        extent = 1;
      }
      context.fillStyle = this.color(dim ? shadeColor(color, 0.7) : color);
      context.fillRect(view.position.x - extent / 2, view.position.y - extent / 2, extent, extent);
    });
    context.imageSmoothingEnabled = true;
    context.drawImage(this.fogCanvas, 0, 0);
    context.setTransform(1, 0, 0, 1, 0, 0);
  }

  private color(color: number): string {
    let css = this.colors.get(color);
    if (!css) {
      css = cssColor(color);
      this.colors.set(color, css);
    }
    return css;
  }
}
