import { Container, WebGLRenderer } from 'pixi.js';
import type { SimEvent } from '../sim/events';
import type { PlayerView } from '../sim/snapshot';
import type { EntityId, Vec2 } from '../sim/types';
import type {
  Camera,
  PlacementGhost,
  RallyMarker,
  Renderer,
  RendererOptions,
  ScreenPoint,
  ScreenRect,
  WallGhost,
} from './api';
import { SpriteLibrary } from './assets';
import { ViewTransform } from './camera';
import { CanvasAtlas } from './canvasAtlas';
import { EntityLayer } from './entities';
import { FogCanvas } from './fog';
import { MetricsCache } from './metrics';
import { Minimap } from './minimap';
import { OverlayLayer } from './overlays';
import { pickTarget, targetsInRect } from './picking';
import { buildHeightField } from './projection';
import { SpriteResolver } from './spriteResolver';
import { TerrainLayer } from './terrain';

const BACKGROUND_COLOR = 0x000000;
const MAX_RESOLUTION = 2;

class PixiRenderer implements Renderer {
  private readonly pixi: WebGLRenderer;
  private readonly library: SpriteLibrary;
  private readonly atlas = new CanvasAtlas();
  private readonly transform = new ViewTransform();
  private readonly stage = new Container();
  private readonly world = new Container();
  private readonly fog = new FogCanvas();
  private readonly terrain: TerrainLayer;
  private readonly entities: EntityLayer;
  private readonly overlays: OverlayLayer;
  private readonly minimap: Minimap;
  private view: PlayerView | null = null;
  private cameraInitialized = false;
  private destroyed = false;

  constructor(options: RendererOptions, pixi: WebGLRenderer, library: SpriteLibrary) {
    this.pixi = pixi;
    this.library = library;
    const resolver = new SpriteResolver(options.data, library, this.atlas);
    this.terrain = new TerrainLayer(library, this.fog.canvas);
    this.entities = new EntityLayer(options.data, new MetricsCache(options.data), resolver);
    this.overlays = new OverlayLayer(options.data, resolver);
    this.minimap = new Minimap(options.data, this.fog.canvas);
    this.world.addChild(
      this.terrain.container,
      this.terrain.fogContainer,
      this.entities.ringContainer,
      this.entities.container,
      this.overlays.ghostContainer,
      this.entities.barContainer,
      this.overlays.worldGraphics,
    );
    this.stage.addChild(this.world, this.overlays.screenGraphics);
  }

  attach(container: HTMLElement): void {
    container.appendChild(this.pixi.canvas);
    this.resize(container.clientWidth, container.clientHeight);
  }

  applyView(view: PlayerView): void {
    if (this.destroyed) {
      return;
    }
    const now = performance.now();
    const fogChanged = this.fog.update(view.fog, view.map.size);
    if (this.terrain.needsRebuild(view.map)) {
      const field = buildHeightField(view.map.size, view.map.elevation);
      this.transform.setHeightField(field);
      this.terrain.rebuild(field, view.map);
      this.minimap.setMap(view.map);
      this.entities.clear();
      this.overlays.invalidate();
      this.cameraInitialized = false;
    } else if (fogChanged) {
      this.terrain.updateFog();
    }
    this.entities.applyView(view, now);
    this.minimap.markDirty();
    this.view = view;
    if (!this.cameraInitialized) {
      this.cameraInitialized = true;
      const own =
        view.entities.find(
          (entity) => entity.owner === view.playerId && entity.kind === 'building',
        ) ?? view.entities.find((entity) => entity.owner === view.playerId);
      const center = view.map.size / 2;
      this.centerOn(own ? own.position : { x: center, y: center });
    }
  }

  applyEvents(events: readonly SimEvent[]): void {
    this.entities.applyEvents(events, performance.now());
  }

  render(alpha: number): void {
    if (this.destroyed) {
      return;
    }
    const now = performance.now();
    const transform = this.transform;
    const zoom = transform.zoom;
    const originX = Math.round(transform.originX);
    const originY = Math.round(transform.originY);
    this.world.scale.set(zoom, zoom);
    this.world.position.set(originX, originY);
    const bounds = {
      left: -originX / zoom,
      top: -originY / zoom,
      right: (transform.width - originX) / zoom,
      bottom: (transform.height - originY) / zoom,
    };
    this.terrain.cull(bounds.left, bounds.top, bounds.right, bounds.bottom);
    this.entities.update(alpha, now, bounds, transform);
    const view = this.view;
    this.overlays.update(now, transform, this.entities, this.entities.styleOf(view?.playerId ?? -1));
    this.atlas.flush();
    this.pixi.render(this.stage);
    this.minimap.draw(now, transform, this.entities, this.overlays.activePings);
  }

  getCamera(): Camera {
    return this.transform.getCamera();
  }

  setCamera(camera: Camera): void {
    this.transform.setCamera(camera);
  }

  panCamera(dx: number, dy: number): void {
    this.transform.pan(dx, dy);
  }

  centerOn(world: Vec2): void {
    this.transform.centerOn(world);
  }

  screenToWorld(point: ScreenPoint): Vec2 {
    return this.transform.screenToWorld(point);
  }

  worldToScreen(world: Vec2): ScreenPoint {
    return this.transform.worldToScreen(world);
  }

  pickEntity(point: ScreenPoint): EntityId | null {
    return pickTarget(this.entities.pickTargets(this.transform), point);
  }

  entitiesInRect(rect: ScreenRect): EntityId[] {
    return targetsInRect(this.entities.pickTargets(this.transform), rect);
  }

  setSelection(entityIds: readonly EntityId[]): void {
    this.entities.setSelection(entityIds);
  }

  setPlacementGhost(ghost: PlacementGhost | null): void {
    this.overlays.setPlacementGhost(ghost);
  }

  setWallGhost(ghost: WallGhost | null): void {
    this.overlays.setWallGhost(ghost);
  }

  setDragRect(rect: ScreenRect | null): void {
    this.overlays.setDragRect(rect);
  }

  setRallyMarkers(markers: readonly RallyMarker[]): void {
    this.overlays.setRallyMarkers(markers);
  }

  addPing(world: Vec2): void {
    this.overlays.addPing(world, performance.now());
  }

  addOrderMarker(world: Vec2, size: number): void {
    this.overlays.addOrderMarker(world, size, performance.now());
  }

  getMinimapCanvas(): HTMLCanvasElement {
    return this.minimap.canvas;
  }

  minimapToWorld(point: ScreenPoint): Vec2 {
    return this.minimap.toWorld(point);
  }

  resize(width: number, height: number): void {
    if (this.destroyed) {
      return;
    }
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    this.transform.setViewport(safeWidth, safeHeight);
    this.pixi.resize(safeWidth, safeHeight);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.view = null;
    this.pixi.canvas.remove();
    this.pixi.destroy();
    this.terrain.destroy();
    this.stage.destroy({ children: true });
    this.atlas.destroy();
    this.library.destroy();
  }
}

export async function createPixiRenderer(options: RendererOptions): Promise<Renderer> {
  const pixi = new WebGLRenderer();
  await pixi.init({
    width: 1,
    height: 1,
    backgroundColor: BACKGROUND_COLOR,
    antialias: false,
    autoDensity: true,
    resolution: Math.min(MAX_RESOLUTION, window.devicePixelRatio || 1),
    eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
  });
  const library = new SpriteLibrary(options.manifest, options.assetBasePath);
  await library.load();
  return new PixiRenderer(options, pixi, library);
}
