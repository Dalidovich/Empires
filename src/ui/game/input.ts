import type { Renderer, ScreenPoint, ScreenRect } from '../../render/api';
import type { Vec2 } from '../../sim/types';
import { isTextInput } from '../dom';

export const DRAG_THRESHOLD = 5;

export const DOUBLE_CLICK_MS = 350;

export const EDGE_SCROLL_MARGIN = 6;

export const PAN_SPEED = 900;

const ZOOM_STEP = 1.1;

export const LONG_PRESS_MS = 450;

export const TOUCH_SLOP = 10;

export const DOUBLE_TAP_DISTANCE = 24;

const TOUCH_MOUSE_GUARD_MS = 1000;

const PAN_CODES: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export interface InputHost {
  isBlocked(): boolean;
  pointerDown(point: ScreenPoint, shift: boolean): boolean;
  pointerUp(point: ScreenPoint, shift: boolean): void;
  pointerMove(point: ScreenPoint): void;
  select(point: ScreenPoint, shift: boolean, double: boolean): void;
  selectBox(rect: ScreenRect, shift: boolean): void;
  context(point: ScreenPoint, shift: boolean): void;
  minimapContext(world: Vec2, shift: boolean): void;
  key(event: KeyboardEvent): boolean;
  touchPlacement(): TouchPlacement | null;
  touchToolChanged(tool: TouchTool | null): void;
}

export type TouchPlacement = 'point' | 'line';

export type TouchTool = 'box' | 'order';

type TouchGesture = 'tap' | 'pan' | 'box' | 'place' | 'pinch';

interface ClientPoint {
  clientX: number;
  clientY: number;
}

type Unbind = () => void;

export class InputController {
  private readonly unbinds: Unbind[] = [];
  private readonly held = new Set<string>();
  private pointer: ScreenPoint = { x: 0, y: 0 };
  private windowPointer: ScreenPoint | null = null;
  private dragStart: ScreenPoint | null = null;
  private dragging = false;
  private consumed = false;
  private panning = false;
  private minimapDrag = false;
  private lastClickAt = Number.NEGATIVE_INFINITY;
  private lastClickPoint: ScreenPoint = { x: 0, y: 0 };
  private gesture: TouchGesture | null = null;
  private placement: TouchPlacement | null = null;
  private touchStart: ScreenPoint = { x: 0, y: 0 };
  private touchLast: ScreenPoint = { x: 0, y: 0 };
  private pinchDistance = 0;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private lastTouchAt = Number.NEGATIVE_INFINITY;
  private touchInput = false;
  private tool: TouchTool | null = null;

  constructor(
    private readonly renderer: Renderer,
    private readonly viewport: HTMLElement,
    private readonly minimap: HTMLCanvasElement,
    private readonly host: InputHost,
  ) {
    this.bind(viewport, 'mousedown', (event) => this.onMouseDown(event));
    this.bind(viewport, 'contextmenu', (event) => event.preventDefault());
    this.bind(viewport, 'wheel', (event) => this.onWheel(event), { passive: false });
    this.bind(window, 'mousemove', (event) => this.onMouseMove(event));
    this.bind(window, 'mouseup', (event) => this.onMouseUp(event));
    this.bind(window, 'keydown', (event) => this.onKeyDown(event));
    this.bind(window, 'keyup', (event) => this.held.delete(event.code));
    this.bind(window, 'blur', () => this.reset());
    this.bind(document, 'mouseleave', () => {
      this.windowPointer = null;
    });
    this.bind(minimap, 'mousedown', (event) => this.onMinimapDown(event));
    this.bind(minimap, 'contextmenu', (event) => event.preventDefault());
    this.bind(window, 'touchstart', (event) => this.noteTouch(event), { capture: true, passive: true });
    this.bind(viewport, 'touchstart', (event) => this.onTouchStart(event), { passive: false });
    this.bind(viewport, 'touchmove', (event) => this.onTouchMove(event), { passive: false });
    this.bind(viewport, 'touchend', (event) => this.onTouchEnd(event), { passive: false });
    this.bind(viewport, 'touchcancel', () => this.cancelTouch());
    this.bind(minimap, 'touchstart', (event) => this.onMinimapTouch(event, true), { passive: false });
    this.bind(minimap, 'touchmove', (event) => this.onMinimapTouch(event, false), { passive: false });
  }

  get usingTouch(): boolean {
    return this.touchInput;
  }

  get touchTool(): TouchTool | null {
    return this.tool;
  }

  toggleTouchTool(tool: TouchTool): void {
    this.setTool(this.tool === tool ? null : tool);
  }

  centerPointer(): void {
    this.pointer = { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 };
  }

  get pointerPosition(): ScreenPoint {
    return this.pointer;
  }

  tick(deltaSeconds: number): void {
    if (this.host.isBlocked()) {
      return;
    }
    let dx = 0;
    let dy = 0;
    for (const code of this.held) {
      const direction = PAN_CODES[code];
      if (direction) {
        dx += direction[0];
        dy += direction[1];
      }
    }
    const pointer = this.windowPointer;
    if (pointer && !this.panning && document.hasFocus()) {
      if (pointer.x <= EDGE_SCROLL_MARGIN) {
        dx -= 1;
      } else if (pointer.x >= window.innerWidth - 1 - EDGE_SCROLL_MARGIN) {
        dx += 1;
      }
      if (pointer.y <= EDGE_SCROLL_MARGIN) {
        dy -= 1;
      } else if (pointer.y >= window.innerHeight - 1 - EDGE_SCROLL_MARGIN) {
        dy += 1;
      }
    }
    if (dx !== 0 || dy !== 0) {
      const step = PAN_SPEED * deltaSeconds;
      this.renderer.panCamera(Math.sign(dx) * step, Math.sign(dy) * step);
    }
  }

  destroy(): void {
    this.clearLongPress();
    for (const unbind of this.unbinds) {
      unbind();
    }
    this.unbinds.length = 0;
    this.renderer.setDragRect(null);
  }

  private bind<K extends keyof GlobalEventHandlersEventMap>(
    target: EventTarget,
    type: K,
    handler: (event: GlobalEventHandlersEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    const listener = handler as EventListener;
    target.addEventListener(type, listener, options);
    this.unbinds.push(() => target.removeEventListener(type, listener, options));
  }

  private reset(): void {
    this.held.clear();
    this.windowPointer = null;
    this.panning = false;
    this.minimapDrag = false;
    this.cancelTouch();
    this.cancelDrag();
  }

  private cancelDrag(): void {
    this.dragStart = null;
    this.dragging = false;
    this.renderer.setDragRect(null);
  }

  private local(event: ClientPoint): ScreenPoint {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private dragRect(): ScreenRect | null {
    if (!this.dragStart) {
      return null;
    }
    return {
      x: this.dragStart.x,
      y: this.dragStart.y,
      width: this.pointer.x - this.dragStart.x,
      height: this.pointer.y - this.dragStart.y,
    };
  }

  private onMouseDown(event: MouseEvent): void {
    if (this.host.isBlocked() || isControl(event.target)) {
      return;
    }
    event.preventDefault();
    const point = this.local(event);
    this.pointer = point;
    if (event.button === 1) {
      this.panning = true;
      return;
    }
    if (event.button === 2) {
      this.cancelDrag();
      this.host.context(point, event.shiftKey);
      return;
    }
    if (event.button !== 0) {
      return;
    }
    this.consumed = this.host.pointerDown(point, event.shiftKey);
    if (!this.consumed) {
      this.dragStart = point;
      this.dragging = false;
    }
  }

  private onMouseMove(event: MouseEvent): void {
    if (event.timeStamp - this.lastTouchAt < TOUCH_MOUSE_GUARD_MS) {
      return;
    }
    this.touchInput = false;
    const previous = this.windowPointer;
    this.windowPointer = { x: event.clientX, y: event.clientY };
    if (this.minimapDrag) {
      this.renderer.centerOn(this.minimapWorld(event));
      return;
    }
    if (this.panning && previous) {
      this.renderer.panCamera(previous.x - event.clientX, previous.y - event.clientY);
    }
    this.pointer = this.local(event);
    if (this.host.isBlocked()) {
      return;
    }
    this.host.pointerMove(this.pointer);
    const rect = this.dragRect();
    if (rect) {
      this.dragging = this.dragging || Math.hypot(rect.width, rect.height) > DRAG_THRESHOLD;
      if (this.dragging) {
        this.renderer.setDragRect(rect);
      }
    }
  }

  private onMouseUp(event: MouseEvent): void {
    if (event.button === 1) {
      this.panning = false;
      return;
    }
    if (event.button !== 0) {
      return;
    }
    this.minimapDrag = false;
    if (this.consumed) {
      this.consumed = false;
      this.host.pointerUp(this.local(event), event.shiftKey);
      return;
    }
    const rect = this.dragRect();
    if (!rect || !this.dragStart) {
      return;
    }
    const start = this.dragStart;
    const wasDragging = this.dragging;
    this.cancelDrag();
    if (this.host.isBlocked()) {
      return;
    }
    if (wasDragging) {
      this.host.selectBox(rect, event.shiftKey);
      return;
    }
    const now = event.timeStamp;
    const double =
      now - this.lastClickAt <= DOUBLE_CLICK_MS &&
      Math.hypot(start.x - this.lastClickPoint.x, start.y - this.lastClickPoint.y) <= DRAG_THRESHOLD;
    this.lastClickAt = double ? Number.NEGATIVE_INFINITY : now;
    this.lastClickPoint = start;
    this.host.select(start, event.shiftKey, double);
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (this.host.isBlocked()) {
      return;
    }
    const camera = this.renderer.getCamera();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    this.renderer.setCamera({ ...camera, zoom: camera.zoom * factor });
  }

  private minimapWorld(event: ClientPoint): Vec2 {
    const rect = this.minimap.getBoundingClientRect();
    const width = rect.width || this.minimap.width || 1;
    const height = rect.height || this.minimap.height || 1;
    return this.renderer.minimapToWorld({
      x: ((event.clientX - rect.left) / width) * this.minimap.width,
      y: ((event.clientY - rect.top) / height) * this.minimap.height,
    });
  }

  private onMinimapDown(event: MouseEvent): void {
    if (this.host.isBlocked()) {
      return;
    }
    event.preventDefault();
    const world = this.minimapWorld(event);
    if (event.button === 2) {
      this.host.minimapContext(world, event.shiftKey);
    } else if (event.button === 0) {
      this.minimapDrag = true;
      this.renderer.centerOn(world);
    }
  }

  private setTool(tool: TouchTool | null): void {
    if (tool === this.tool) {
      return;
    }
    this.tool = tool;
    this.host.touchToolChanged(tool);
  }

  private noteTouch(event: TouchEvent): void {
    this.lastTouchAt = event.timeStamp;
    this.touchInput = true;
    this.windowPointer = null;
  }

  private clearLongPress(): void {
    if (this.longPress !== null) {
      clearTimeout(this.longPress);
      this.longPress = null;
    }
  }

  private cancelTouch(): void {
    this.clearLongPress();
    if (this.gesture === 'box') {
      this.cancelDrag();
    }
    this.gesture = null;
    this.placement = null;
  }

  private onTouchStart(event: TouchEvent): void {
    if (isControl(event.target)) {
      return;
    }
    event.preventDefault();
    this.noteTouch(event);
    if (this.host.isBlocked()) {
      return;
    }
    if (event.touches.length >= 2) {
      this.beginPinch(event.touches);
      return;
    }
    const point = this.local(event.touches[0]);
    this.pointer = point;
    this.touchStart = point;
    this.touchLast = point;
    const placement = this.host.touchPlacement();
    if (placement !== null) {
      this.gesture = 'place';
      this.placement = placement;
      this.host.pointerMove(point);
      if (placement === 'line') {
        this.host.pointerDown(point, false);
      }
      return;
    }
    this.gesture = 'tap';
    this.clearLongPress();
    this.longPress = setTimeout(() => this.onLongPress(), LONG_PRESS_MS);
  }

  private beginPinch(touches: TouchList): void {
    this.clearLongPress();
    if (this.gesture === 'box') {
      this.cancelDrag();
    }
    this.gesture = 'pinch';
    this.pinchDistance = touchDistance(touches);
    this.touchLast = this.local(touchMidpoint(touches));
  }

  private onTouchMove(event: TouchEvent): void {
    if (this.gesture === null) {
      return;
    }
    event.preventDefault();
    if (this.gesture === 'pinch') {
      this.pinch(event.touches);
      return;
    }
    if (event.touches.length >= 2) {
      this.beginPinch(event.touches);
      return;
    }
    const point = this.local(event.touches[0]);
    this.pointer = point;
    if (this.gesture === 'place') {
      this.host.pointerMove(point);
      return;
    }
    if (this.gesture === 'tap') {
      if (Math.hypot(point.x - this.touchStart.x, point.y - this.touchStart.y) <= TOUCH_SLOP) {
        return;
      }
      this.clearLongPress();
      this.gesture = this.tool === 'box' ? 'box' : 'pan';
    }
    if (this.gesture === 'pan') {
      this.renderer.panCamera(this.touchLast.x - point.x, this.touchLast.y - point.y);
    } else {
      this.dragStart = this.touchStart;
      this.dragging = true;
      this.renderer.setDragRect(this.dragRect());
    }
    this.touchLast = point;
  }

  private pinch(touches: TouchList): void {
    if (touches.length < 2) {
      return;
    }
    const middle = this.local(touchMidpoint(touches));
    this.renderer.panCamera(this.touchLast.x - middle.x, this.touchLast.y - middle.y);
    this.touchLast = middle;
    const distance = touchDistance(touches);
    if (this.pinchDistance > 0 && distance > 0) {
      const camera = this.renderer.getCamera();
      this.renderer.setCamera({ ...camera, zoom: camera.zoom * (distance / this.pinchDistance) });
    }
    this.pinchDistance = distance;
  }

  private onTouchEnd(event: TouchEvent): void {
    if (this.gesture === null) {
      return;
    }
    event.preventDefault();
    if (event.touches.length > 0) {
      if (this.gesture === 'pinch' && event.touches.length === 1) {
        this.gesture = 'pan';
        this.touchLast = this.local(event.touches[0]);
      }
      return;
    }
    this.clearLongPress();
    const gesture = this.gesture;
    const placement = this.placement;
    const point = this.pointer;
    this.gesture = null;
    this.placement = null;
    if (this.host.isBlocked()) {
      this.cancelDrag();
      return;
    }
    if (gesture === 'place') {
      if (placement === 'point') {
        this.host.pointerDown(point, false);
      }
      this.host.pointerUp(point, false);
    } else if (gesture === 'tap') {
      this.tap(this.touchStart, event.timeStamp);
    } else if (gesture === 'box') {
      const rect = this.dragRect();
      this.cancelDrag();
      this.setTool(null);
      if (rect) {
        this.host.selectBox(rect, false);
      }
    }
  }

  private tap(point: ScreenPoint, now: number): void {
    if (this.tool === 'order') {
      this.setTool(null);
      this.host.context(point, false);
      return;
    }
    const double =
      now - this.lastClickAt <= DOUBLE_CLICK_MS &&
      Math.hypot(point.x - this.lastClickPoint.x, point.y - this.lastClickPoint.y) <= DOUBLE_TAP_DISTANCE;
    this.lastClickAt = double ? Number.NEGATIVE_INFINITY : now;
    this.lastClickPoint = point;
    this.host.select(point, false, double);
  }

  private onLongPress(): void {
    this.longPress = null;
    if (this.gesture !== 'tap' || this.host.isBlocked()) {
      return;
    }
    this.gesture = null;
    this.setTool(null);
    this.host.context(this.touchStart, false);
  }

  private onMinimapTouch(event: TouchEvent, start: boolean): void {
    event.preventDefault();
    this.noteTouch(event);
    if (this.host.isBlocked() || event.touches.length === 0) {
      return;
    }
    const world = this.minimapWorld(event.touches[0]);
    if (start && this.tool === 'order') {
      this.setTool(null);
      this.host.minimapContext(world, false);
      return;
    }
    this.renderer.centerOn(world);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (isTextInput(event.target)) {
      return;
    }
    if (event.code in PAN_CODES) {
      if (!this.host.isBlocked()) {
        this.held.add(event.code);
        event.preventDefault();
      }
      return;
    }
    if (this.host.key(event)) {
      event.preventDefault();
    }
  }
}

function isControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, .clickable') !== null;
}

function touchMidpoint(touches: TouchList): ClientPoint {
  const first = touches[0];
  const second = touches[1];
  return { clientX: (first.clientX + second.clientX) / 2, clientY: (first.clientY + second.clientY) / 2 };
}

function touchDistance(touches: TouchList): number {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}
