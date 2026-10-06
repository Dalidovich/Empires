import type { GameData } from '../data/types';
import type { AssetManifest } from '../shared/assetManifest';
import type { SimEvent } from '../sim/events';
import type { PlayerView } from '../sim/snapshot';
import type { EntityId, TileCoord, Vec2 } from '../sim/types';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface PlacementGhost {
  building: string;
  tile: TileCoord;
  valid: boolean;
}

export interface WallGhost {
  building: string;
  from: TileCoord;
  to: TileCoord;
  valid: boolean;
}

export interface RallyMarker {
  buildingId: EntityId;
  position: Vec2;
}

export interface RendererOptions {
  data: GameData;
  manifest: AssetManifest;
  assetBasePath?: string;
}

export interface Renderer {
  attach(container: HTMLElement): void;
  applyView(view: PlayerView): void;
  render(alpha: number): void;
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  panCamera(dx: number, dy: number): void;
  centerOn(world: Vec2): void;
  screenToWorld(point: ScreenPoint): Vec2;
  worldToScreen(world: Vec2): ScreenPoint;
  pickEntity(point: ScreenPoint): EntityId | null;
  entitiesInRect(rect: ScreenRect): EntityId[];
  setSelection(entityIds: readonly EntityId[]): void;
  setPlacementGhost(ghost: PlacementGhost | null): void;
  setWallGhost(ghost: WallGhost | null): void;
  setDragRect(rect: ScreenRect | null): void;
  setRallyMarkers(markers: readonly RallyMarker[]): void;
  addPing(world: Vec2): void;
  getMinimapCanvas(): HTMLCanvasElement;
  minimapToWorld(point: ScreenPoint): Vec2;
  resize(width: number, height: number): void;
  destroy(): void;
  applyEvents?(events: readonly SimEvent[]): void;
  addOrderMarker?(world: Vec2, size: number): void;
}

export type RendererErrorCode = 'webgl_unavailable' | 'init_failed';

export type RendererResult =
  | { ok: true; renderer: Renderer }
  | { ok: false; error: RendererErrorCode };

export type CreateRenderer = (options: RendererOptions) => Promise<RendererResult>;
