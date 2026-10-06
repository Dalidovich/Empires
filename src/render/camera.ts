import type { Vec2 } from '../sim/types';
import type { Camera, ScreenPoint } from './api';
import {
  flatHeightField,
  projectOnField,
  projectX,
  projectY,
  unprojectFlat,
  unprojectOnField,
} from './projection';
import type { HeightField } from './projection';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export class ViewTransform {
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private field: HeightField = flatHeightField(0);
  private viewWidth = 1;
  private viewHeight = 1;

  get width(): number {
    return this.viewWidth;
  }

  get height(): number {
    return this.viewHeight;
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  get heightField(): HeightField {
    return this.field;
  }

  get originX(): number {
    return this.viewWidth / 2 - projectX(this.camera.x, this.camera.y) * this.camera.zoom;
  }

  get originY(): number {
    return this.viewHeight / 2 - projectY(this.camera.x, this.camera.y, 0) * this.camera.zoom;
  }

  setHeightField(field: HeightField): void {
    this.field = field;
    this.setCamera(this.camera);
  }

  setViewport(width: number, height: number): void {
    this.viewWidth = Math.max(1, width);
    this.viewHeight = Math.max(1, height);
  }

  getCamera(): Camera {
    return { ...this.camera };
  }

  setCamera(camera: Camera): void {
    const size = this.field.size;
    const zoom = clamp(Number.isFinite(camera.zoom) ? camera.zoom : 1, MIN_ZOOM, MAX_ZOOM);
    if (size <= 0) {
      this.camera = { x: camera.x, y: camera.y, zoom };
      return;
    }
    this.camera = { x: clamp(camera.x, 0, size), y: clamp(camera.y, 0, size), zoom };
  }

  pan(dx: number, dy: number): void {
    const zoom = this.camera.zoom;
    const px = projectX(this.camera.x, this.camera.y) + dx / zoom;
    const py = projectY(this.camera.x, this.camera.y, 0) + dy / zoom;
    const next = unprojectFlat(px, py);
    this.setCamera({ x: next.x, y: next.y, zoom });
  }

  centerOn(world: Vec2): void {
    const pixel = projectOnField(this.field, world);
    const next = unprojectFlat(pixel.x, pixel.y);
    this.setCamera({ x: next.x, y: next.y, zoom: this.camera.zoom });
  }

  worldToScreen(world: Vec2): ScreenPoint {
    const pixel = projectOnField(this.field, world);
    return {
      x: pixel.x * this.camera.zoom + this.originX,
      y: pixel.y * this.camera.zoom + this.originY,
    };
  }

  screenToWorld(point: ScreenPoint): Vec2 {
    const zoom = this.camera.zoom;
    return unprojectOnField(
      this.field,
      (point.x - this.originX) / zoom,
      (point.y - this.originY) / zoom,
    );
  }
}
