import { loadGameData } from '../../data';
import { emptyManifest, loadAssetManifest } from '../../shared/assetManifest';
import type { EntityId } from '../../sim/types';
import type { Renderer, ScreenPoint } from '../api';
import { createRenderer } from '../index';
import { SyntheticWorld } from './synthetic';

const TICK_MS = 50;
const PAN_SPEED = 900;
const DRAG_THRESHOLD = 4;
const HELP = [
  'arrows / WASD: pan    wheel: zoom    left click / drag: select',
  'right click: ping    G: placement ghost    V: wall ghost    R: rally marker',
  'query: ?units=800|1600  &size=200  &spread=40  &assets=1|/path/',
].join('\n');

interface HarnessStats {
  fps: number;
  frameMs: number;
  units: number;
  samples: number;
}

declare global {
  interface Window {
    harness?: { stats: HarnessStats; renderer: Renderer; world: SyntheticWorld };
  }
}

function numberParam(params: URLSearchParams, name: string, fallback: number): number {
  const value = Number(params.get(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function required(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element: ${id}`);
  }
  return node;
}

async function start(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const viewport = required('viewport');
  const statsNode = required('stats');
  const minimapHost = required('minimap');
  required('help').textContent = HELP;

  const data = loadGameData();
  const assetParam = params.get('assets');
  const assetBasePath = assetParam && assetParam.startsWith('/') ? assetParam : '/assets/';
  const manifest = assetParam ? await loadAssetManifest(assetBasePath) : emptyManifest();
  const created = await createRenderer({ data, manifest, assetBasePath });
  if (!created.ok) {
    statsNode.textContent = `renderer error: ${created.error}`;
    return;
  }
  const renderer = created.renderer;
  const world = new SyntheticWorld(data, {
    size: numberParam(params, 'size', 200),
    units: numberParam(params, 'units', 800),
    spread: numberParam(params, 'spread', 40),
  });
  renderer.attach(viewport);
  const minimap = renderer.getMinimapCanvas();
  minimapHost.appendChild(minimap);

  const stats: HarnessStats = { fps: 0, frameMs: 0, units: world.unitCount, samples: 0 };
  window.harness = { stats, renderer, world };

  let lastTick = performance.now();
  const tick = (): void => {
    const result = world.step();
    renderer.applyView(result.view);
    renderer.applyEvents?.(result.events);
    lastTick = performance.now();
  };
  tick();
  renderer.centerOn(world.center);
  window.setInterval(tick, TICK_MS);

  const keys = new Set<string>();
  let pointer: ScreenPoint = { x: 0, y: 0 };
  let dragStart: ScreenPoint | null = null;
  let dragging = false;
  let ghostMode: 'none' | 'building' | 'wall' = 'none';
  let wallStart: ScreenPoint | null = null;
  let selection: EntityId[] = [];

  const localPoint = (event: MouseEvent): ScreenPoint => {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const updateGhost = (): void => {
    const tile = renderer.screenToWorld(pointer);
    const tileX = Math.floor(tile.x);
    const tileY = Math.floor(tile.y);
    if (ghostMode === 'building') {
      renderer.setWallGhost(null);
      renderer.setPlacementGhost({
        building: 'barracks',
        tile: { x: tileX - 1, y: tileY - 1 },
        valid: (tileX + tileY) % 7 !== 0,
      });
    } else if (ghostMode === 'wall') {
      const from = renderer.screenToWorld(wallStart ?? pointer);
      renderer.setPlacementGhost(null);
      renderer.setWallGhost({
        building: 'small_wall',
        from: { x: Math.floor(from.x), y: Math.floor(from.y) },
        to: { x: tileX, y: tileY },
        valid: true,
      });
    } else {
      renderer.setPlacementGhost(null);
      renderer.setWallGhost(null);
    }
  };

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    keys.add(key);
    if (key === 'g') {
      ghostMode = ghostMode === 'building' ? 'none' : 'building';
      updateGhost();
    } else if (key === 'v') {
      ghostMode = ghostMode === 'wall' ? 'none' : 'wall';
      wallStart = { ...pointer };
      updateGhost();
    } else if (key === 'r' && selection.length > 0) {
      renderer.setRallyMarkers(
        selection.map((buildingId) => ({ buildingId, position: renderer.screenToWorld(pointer) })),
      );
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('resize', () => {
    renderer.resize(viewport.clientWidth, viewport.clientHeight);
  });

  viewport.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    renderer.addPing(renderer.screenToWorld(localPoint(event)));
  });
  viewport.addEventListener('mousedown', (event) => {
    if (event.button === 0) {
      dragStart = localPoint(event);
      dragging = false;
    }
  });
  viewport.addEventListener('mousemove', (event) => {
    pointer = localPoint(event);
    if (ghostMode !== 'none') {
      updateGhost();
    }
    if (dragStart) {
      const width = pointer.x - dragStart.x;
      const height = pointer.y - dragStart.y;
      dragging = dragging || Math.hypot(width, height) > DRAG_THRESHOLD;
      if (dragging) {
        renderer.setDragRect({ x: dragStart.x, y: dragStart.y, width, height });
      }
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button !== 0 || !dragStart) {
      return;
    }
    if (dragging) {
      selection = renderer.entitiesInRect({
        x: dragStart.x,
        y: dragStart.y,
        width: pointer.x - dragStart.x,
        height: pointer.y - dragStart.y,
      });
    } else {
      const picked = renderer.pickEntity(dragStart);
      selection = picked === null ? [] : [picked];
    }
    renderer.setSelection(selection);
    renderer.setDragRect(null);
    dragStart = null;
    dragging = false;
  });
  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const camera = renderer.getCamera();
      renderer.setCamera({ ...camera, zoom: camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1) });
    },
    { passive: false },
  );

  let minimapDrag = false;
  const jump = (event: MouseEvent): void => {
    const rect = minimap.getBoundingClientRect();
    renderer.centerOn(
      renderer.minimapToWorld({
        x: ((event.clientX - rect.left) / rect.width) * minimap.width,
        y: ((event.clientY - rect.top) / rect.height) * minimap.height,
      }),
    );
  };
  minimap.addEventListener('mousedown', (event) => {
    minimapDrag = true;
    jump(event);
  });
  window.addEventListener('mousemove', (event) => {
    if (minimapDrag) {
      jump(event);
    }
  });
  window.addEventListener('mouseup', () => {
    minimapDrag = false;
  });

  let previous = performance.now();
  let windowStart = previous;
  let frames = 0;
  let spent = 0;
  const frame = (now: number): void => {
    const delta = (now - previous) / 1000;
    previous = now;
    const dx = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0);
    const dy = (keys.has('arrowdown') || keys.has('s') ? 1 : 0) - (keys.has('arrowup') || keys.has('w') ? 1 : 0);
    if (dx !== 0 || dy !== 0) {
      renderer.panCamera(dx * PAN_SPEED * delta, dy * PAN_SPEED * delta);
    }
    const began = performance.now();
    renderer.render((began - lastTick) / TICK_MS);
    spent += performance.now() - began;
    frames += 1;
    if (now - windowStart >= 1000) {
      stats.fps = (frames * 1000) / (now - windowStart);
      stats.frameMs = spent / frames;
      stats.samples += 1;
      const camera = renderer.getCamera();
      statsNode.textContent = [
        `fps ${stats.fps.toFixed(1)}   render ${stats.frameMs.toFixed(2)} ms`,
        `units ${stats.units}   map ${world.size}x${world.size}   zoom ${camera.zoom.toFixed(2)}`,
        `selected ${selection.length}`,
      ].join('\n');
      windowStart = now;
      frames = 0;
      spent = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void start();
