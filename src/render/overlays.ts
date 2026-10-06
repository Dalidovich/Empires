import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { GameData } from '../data/types';
import type { TileCoord, Vec2 } from '../sim/types';
import type { PlacementGhost, RallyMarker, ScreenRect, WallGhost } from './api';
import type { ViewTransform } from './camera';
import type { EntityLayer, PlayerStyle } from './entities';
import { footprintCenter, lineTiles } from './ghost';
import { normalizeRect } from './picking';
import { projectOnField } from './projection';
import type { SpriteResolver } from './spriteResolver';

export const PING_DURATION_MS = 5000;
const PING_PULSE_MS = 900;
const VALID_TINT = 0x7dff7d;
const INVALID_TINT = 0xff6b6b;
const GHOST_ALPHA = 0.6;
const RALLY_COLOR = 0xffe14d;
const PING_COLOR = 0xff3b30;
const DRAG_COLOR = 0xffffff;
const ORDER_MARKER_DURATION_MS = 700;
const ORDER_MARKER_COLOR = 0x7dff7d;

export interface Ping {
  position: Vec2;
  at: number;
}

interface OrderMarker {
  position: Vec2;
  size: number;
  at: number;
}

interface GhostTile {
  building: string;
  tile: TileCoord;
  valid: boolean;
}

export class OverlayLayer {
  readonly ghostContainer = new Container();
  readonly worldGraphics = new Graphics();
  readonly screenGraphics = new Graphics();
  private readonly data: GameData;
  private readonly resolver: SpriteResolver;
  private readonly ghostSprites: Sprite[] = [];
  private ghosts: GhostTile[] = [];
  private rallies: readonly RallyMarker[] = [];
  private pings: Ping[] = [];
  private orderMarkers: OrderMarker[] = [];
  private dirty = true;

  constructor(data: GameData, resolver: SpriteResolver) {
    this.data = data;
    this.resolver = resolver;
  }

  get activePings(): readonly Ping[] {
    return this.pings;
  }

  setPlacementGhost(ghost: PlacementGhost | null): void {
    this.ghosts = ghost ? [{ building: ghost.building, tile: ghost.tile, valid: ghost.valid }] : [];
    this.dirty = true;
  }

  setWallGhost(ghost: WallGhost | null): void {
    this.ghosts = ghost
      ? lineTiles(ghost.from, ghost.to).map((tile) => ({
          building: ghost.building,
          tile,
          valid: ghost.valid,
        }))
      : [];
    this.dirty = true;
  }

  setRallyMarkers(markers: readonly RallyMarker[]): void {
    this.rallies = markers.map((marker) => ({
      buildingId: marker.buildingId,
      position: { ...marker.position },
    }));
    this.dirty = true;
  }

  setDragRect(rect: ScreenRect | null): void {
    const graphics = this.screenGraphics;
    graphics.clear();
    if (!rect) {
      return;
    }
    const area = normalizeRect(rect);
    graphics
      .rect(area.x, area.y, area.width, area.height)
      .fill({ color: DRAG_COLOR, alpha: 0.12 })
      .stroke({ width: 1, color: DRAG_COLOR, alpha: 0.9 });
  }

  addPing(position: Vec2, now: number): void {
    this.pings.push({ position: { ...position }, at: now });
  }

  invalidate(): void {
    this.dirty = true;
  }

  addOrderMarker(position: Vec2, size: number, now: number): void {
    this.orderMarkers.push({ position: { ...position }, size, at: now });
  }

  update(now: number, transform: ViewTransform, entities: EntityLayer, style: PlayerStyle): void {
    const hadPings = this.pings.length > 0;
    const hadOrderMarkers = this.orderMarkers.length > 0;
    this.pings = this.pings.filter((ping) => now - ping.at < PING_DURATION_MS);
    this.orderMarkers = this.orderMarkers.filter(
      (marker) => now - marker.at < ORDER_MARKER_DURATION_MS,
    );
    if (!this.dirty && !hadPings && !hadOrderMarkers && this.rallies.length === 0) {
      return;
    }
    this.dirty = false;
    const field = transform.heightField;
    const graphics = this.worldGraphics;
    graphics.clear();
    this.drawGhosts(graphics, transform, style);
    for (const rally of this.rallies) {
      const target = projectOnField(field, rally.position);
      const source = entities.position(rally.buildingId);
      if (source) {
        const origin = projectOnField(field, source);
        graphics
          .moveTo(origin.x, origin.y)
          .lineTo(target.x, target.y)
          .stroke({ width: 1, color: RALLY_COLOR, alpha: 0.6 });
      }
      graphics
        .moveTo(target.x, target.y)
        .lineTo(target.x, target.y - 22)
        .stroke({ width: 2, color: RALLY_COLOR });
      graphics
        .poly([target.x, target.y - 22, target.x + 12, target.y - 17, target.x, target.y - 12])
        .fill({ color: RALLY_COLOR });
    }
    for (const ping of this.pings) {
      const center = projectOnField(field, ping.position);
      const phase = ((now - ping.at) % PING_PULSE_MS) / PING_PULSE_MS;
      const radius = 10 + phase * 44;
      graphics
        .ellipse(center.x, center.y, radius, radius / 2)
        .stroke({ width: 3, color: PING_COLOR, alpha: 1 - phase });
    }
    for (const marker of this.orderMarkers) {
      const fade = 1 - (now - marker.at) / ORDER_MARKER_DURATION_MS;
      if (marker.size > 0) {
        const half = marker.size / 2;
        const corners = [
          { x: marker.position.x - half, y: marker.position.y - half },
          { x: marker.position.x + half, y: marker.position.y - half },
          { x: marker.position.x + half, y: marker.position.y + half },
          { x: marker.position.x - half, y: marker.position.y + half },
        ].flatMap((corner) => {
          const pixel = projectOnField(field, corner);
          return [pixel.x, pixel.y];
        });
        graphics
          .poly(corners)
          .fill({ color: ORDER_MARKER_COLOR, alpha: 0.2 * fade })
          .stroke({ width: 2, color: ORDER_MARKER_COLOR, alpha: fade });
      } else {
        const center = projectOnField(field, marker.position);
        const radius = 6 + fade * 12;
        graphics
          .ellipse(center.x, center.y, radius, radius / 2)
          .stroke({ width: 2, color: ORDER_MARKER_COLOR, alpha: fade });
      }
    }
  }

  private drawGhosts(graphics: Graphics, transform: ViewTransform, style: PlayerStyle): void {
    const field = transform.heightField;
    this.ghosts.forEach((ghost, index) => {
      const def = this.data.buildings[ghost.building];
      const size = def?.size ?? 1;
      const tint = ghost.valid ? VALID_TINT : INVALID_TINT;
      const corners = [
        { x: ghost.tile.x, y: ghost.tile.y },
        { x: ghost.tile.x + size, y: ghost.tile.y },
        { x: ghost.tile.x + size, y: ghost.tile.y + size },
        { x: ghost.tile.x, y: ghost.tile.y + size },
      ].flatMap((corner) => {
        const pixel = projectOnField(field, corner);
        return [pixel.x, pixel.y];
      });
      graphics
        .poly(corners)
        .fill({ color: tint, alpha: 0.25 })
        .stroke({ width: 2, color: tint, alpha: 0.9 });
      let sprite = this.ghostSprites[index];
      if (!sprite) {
        sprite = new Sprite(Texture.WHITE);
        this.ghostSprites.push(sprite);
        this.ghostContainer.addChild(sprite);
      }
      const visual = this.resolver.building(ghost.building, style.architecture, style.age, 'full');
      const center = projectOnField(field, footprintCenter(ghost.tile, size));
      sprite.texture = visual.frame.texture;
      sprite.anchor.set(visual.frame.anchorX, visual.frame.anchorY);
      sprite.position.set(center.x, center.y);
      sprite.tint = tint;
      sprite.alpha = GHOST_ALPHA;
      sprite.visible = true;
    });
    for (let i = this.ghosts.length; i < this.ghostSprites.length; i += 1) {
      this.ghostSprites[i].visible = false;
    }
  }
}
