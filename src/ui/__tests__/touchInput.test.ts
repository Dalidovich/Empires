import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Renderer } from '../../render/api';
import type { InputHost, TouchPlacement } from '../game/input';
import { InputController, LONG_PRESS_MS } from '../game/input';

type Point = [number, number];

function touchEvent(type: string, points: readonly Point[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: points.map(([clientX, clientY]) => ({ clientX, clientY })),
  });
  return event;
}

function setup(placement: TouchPlacement | null = null) {
  const viewport = document.createElement('div');
  const minimap = document.createElement('canvas');
  document.body.append(viewport, minimap);
  let camera = { x: 10, y: 10, zoom: 1 };
  const renderer = {
    panCamera: vi.fn(),
    setDragRect: vi.fn(),
    centerOn: vi.fn(),
    minimapToWorld: vi.fn(() => ({ x: 5, y: 5 })),
    getCamera: () => camera,
    setCamera: vi.fn((next: typeof camera) => {
      camera = next;
    }),
  };
  const host = {
    isBlocked: vi.fn(() => false),
    pointerDown: vi.fn(() => true),
    pointerUp: vi.fn(),
    pointerMove: vi.fn(),
    select: vi.fn(),
    selectBox: vi.fn(),
    context: vi.fn(),
    minimapContext: vi.fn(),
    key: vi.fn(() => false),
    touchPlacement: vi.fn(() => placement),
    touchToolChanged: vi.fn(),
  } satisfies InputHost;
  const input = new InputController(renderer as unknown as Renderer, viewport, minimap, host);
  const send = (type: string, points: readonly Point[], target: EventTarget = viewport): void => {
    target.dispatchEvent(touchEvent(type, points));
  };
  const drag = (from: Point, to: Point): void => {
    send('touchstart', [from]);
    send('touchmove', [[(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]]);
    send('touchmove', [to]);
    send('touchend', []);
  };
  return { input, host, renderer, viewport, minimap, send, drag, camera: () => camera };
}

describe('touch input', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('selects on a tap', () => {
    const { host, send } = setup();
    send('touchstart', [[40, 50]]);
    send('touchend', []);
    expect(host.select).toHaveBeenCalledWith({ x: 40, y: 50 }, false, false);
    expect(host.context).not.toHaveBeenCalled();
  });

  it('gives an order on a long press', () => {
    const { host, send } = setup();
    send('touchstart', [[40, 50]]);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    send('touchend', []);
    expect(host.context).toHaveBeenCalledWith({ x: 40, y: 50 }, false);
    expect(host.select).not.toHaveBeenCalled();
  });

  it('pans the camera on a drag', () => {
    const { host, renderer, drag } = setup();
    drag([100, 100], [60, 80]);
    expect(renderer.panCamera).toHaveBeenCalled();
    const total = renderer.panCamera.mock.calls.reduce(
      (sum, [dx, dy]) => [sum[0] + dx, sum[1] + dy],
      [0, 0],
    );
    expect(total).toEqual([40, 20]);
    expect(host.select).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(host.context).not.toHaveBeenCalled();
  });

  it('draws a selection box once when the box tool is on', () => {
    const { input, host, renderer, drag } = setup();
    input.toggleTouchTool('box');
    expect(host.touchToolChanged).toHaveBeenLastCalledWith('box');
    drag([10, 10], [70, 50]);
    expect(host.selectBox).toHaveBeenCalledWith({ x: 10, y: 10, width: 60, height: 40 }, false);
    expect(renderer.panCamera).not.toHaveBeenCalled();
    expect(host.touchToolChanged).toHaveBeenLastCalledWith(null);
    expect(input.touchTool).toBeNull();
  });

  it('turns the next tap into an order when the order tool is on', () => {
    const { input, host, send } = setup();
    input.toggleTouchTool('order');
    send('touchstart', [[30, 30]]);
    send('touchend', []);
    expect(host.context).toHaveBeenCalledWith({ x: 30, y: 30 }, false);
    expect(host.select).not.toHaveBeenCalled();
    expect(input.touchTool).toBeNull();
  });

  it('places a building where the finger is lifted', () => {
    const { host, drag } = setup('point');
    drag([20, 20], [50, 60]);
    expect(host.pointerMove).toHaveBeenLastCalledWith({ x: 50, y: 60 });
    expect(host.pointerDown).toHaveBeenCalledTimes(1);
    expect(host.pointerDown).toHaveBeenCalledWith({ x: 50, y: 60 }, false);
    expect(host.pointerUp).toHaveBeenCalledWith({ x: 50, y: 60 }, false);
  });

  it('draws a wall from the touch start to the lift point', () => {
    const { host, drag } = setup('line');
    drag([20, 20], [50, 60]);
    expect(host.pointerDown).toHaveBeenCalledWith({ x: 20, y: 20 }, false);
    expect(host.pointerUp).toHaveBeenCalledWith({ x: 50, y: 60 }, false);
  });

  it('zooms with a pinch', () => {
    const { send, camera } = setup();
    send('touchstart', [
      [100, 100],
      [200, 100],
    ]);
    send('touchmove', [
      [50, 100],
      [250, 100],
    ]);
    send('touchend', []);
    expect(camera().zoom).toBeCloseTo(2);
  });

  it('centers the camera from the minimap', () => {
    const { renderer, minimap, send } = setup();
    send('touchstart', [[3, 3]], minimap);
    expect(renderer.centerOn).toHaveBeenCalledWith({ x: 5, y: 5 });
  });

  it('ignores emulated mouse moves after a touch', () => {
    const { input, host, send } = setup();
    send('touchstart', [[40, 50]]);
    send('touchend', []);
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0 }));
    expect(host.pointerMove).not.toHaveBeenCalled();
    expect(input.usingTouch).toBe(true);
  });

  it('ignores touches on buttons inside the viewport', () => {
    const { host, viewport, send } = setup();
    const control = document.createElement('button');
    viewport.appendChild(control);
    send('touchstart', [[5, 5]], control);
    send('touchend', [], control);
    expect(host.select).not.toHaveBeenCalled();
  });
});
