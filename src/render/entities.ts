import { Container, Sprite, Texture } from 'pixi.js';
import type { AgeId, ArchitectureSet, GameData } from '../data/types';
import type { SimEvent } from '../sim/events';
import type { EntityView, PlayerView, ProjectileView } from '../sim/snapshot';
import { GAIA_PLAYER_ID } from '../sim/types';
import type { EntityId, EntityKind, PlayerId } from '../sim/types';
import { clipFrameIndex } from './assets';
import type { SpriteFrame } from './canvasAtlas';
import type { ViewTransform } from './camera';
import { compareDepth, DEPTH_LAYER, depthKey } from './depth';
import type { DepthSortable } from './depth';
import { FOG_DIM } from './fog';
import { DEFAULT_ARCHITECTURE } from './metrics';
import type { EntityMetrics, MetricsCache } from './metrics';
import type { PickTarget } from './picking';
import type { BuildingStage } from './placeholders';
import {
  directionIndex,
  directionVector,
  projectX,
  projectY,
  sampleHeight,
  TILE_HALF_HEIGHT,
  TILE_HALF_WIDTH,
} from './projection';
import {
  buildingStage,
  DECAY_ANIMATION,
  DIE_ANIMATION,
  unitAnimation,
} from './spriteResolver';
import type { Motion, SpriteResolver, Visual } from './spriteResolver';

const SNAP_DISTANCE_SQ = 9;
const REMOVED_MEMORY_MS = 600;
const PENDING_DEATH_MS = 2000;
const UNIT_CORPSE_MS = 3000;
const REAL_CORPSE_MS = 8000;
const BUILDING_CORPSE_MS = 600;
const COLLAPSE_MS = 400;
const CULL_PADDING = 28;
const LABEL_PADDING = 40;
const BAR_HEIGHT = 3;
const BAR_GAP = 7;
const WHITE = 0xffffff;
const ARROW_TINT = 0x2a2a2a;
const DAMAGE_SHADE: Record<BuildingStage, number> = {
  c0: 1,
  c1: 1,
  c2: 1,
  full: 1,
  d1: 0.85,
  d2: 0.7,
};

export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PlayerStyle {
  color: number;
  architecture: ArchitectureSet;
  age: AgeId;
}

interface EntityRecord {
  view: EntityView;
  metrics: EntityMetrics;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  x: number;
  y: number;
  pixelX: number;
  pixelY: number;
  moving: boolean;
  pixelDirty: boolean;
  onScreen: boolean;
  stamp: number;
  dim: boolean;
  color: number;
  direction: number;
  facing: number;
  stateSince: number;
  visual: Visual | null;
  visualState: string;
  visualDirection: number;
  visualArchitecture: ArchitectureSet | null;
  visualAge: AgeId | null;
  loop: boolean;
  motion: Motion;
  stage: BuildingStage;
}

interface DrawItem extends DepthSortable {
  frame: SpriteFrame;
  mask: SpriteFrame | null;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  tint: number;
  maskTint: number;
  rotation: number;
}

interface Corpse {
  kind: EntityKind;
  type: string;
  id: EntityId;
  x: number;
  y: number;
  pixelX: number;
  pixelY: number;
  direction: number;
  color: number;
  startedAt: number;
  frame: SpriteFrame;
  real: boolean;
}

export function shadeColor(color: number, factor: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

function healthColor(fraction: number): number {
  if (fraction > 0.5) {
    return 0x3fd04a;
  }
  return fraction > 0.25 ? 0xe6c832 : 0xe03c32;
}

class SpritePool {
  private readonly container: Container;
  private readonly sprites: Sprite[] = [];
  private used = 0;
  private shown = 0;

  constructor(container: Container) {
    this.container = container;
  }

  begin(): void {
    this.used = 0;
  }

  next(): Sprite {
    let sprite = this.sprites[this.used];
    if (!sprite) {
      sprite = new Sprite(Texture.WHITE);
      sprite.visible = false;
      this.sprites.push(sprite);
      this.container.addChild(sprite);
    }
    this.used += 1;
    if (!sprite.visible) {
      sprite.visible = true;
    }
    return sprite;
  }

  end(): void {
    for (let i = this.used; i < this.shown; i += 1) {
      this.sprites[i].visible = false;
    }
    this.shown = this.used;
  }
}

export class EntityLayer {
  readonly ringContainer = new Container();
  readonly container = new Container();
  readonly barContainer = new Container();
  private readonly data: GameData;
  private readonly metrics: MetricsCache;
  private readonly resolver: SpriteResolver;
  private readonly records = new Map<EntityId, EntityRecord>();
  private readonly removed = new Map<EntityId, { record: EntityRecord; at: number }>();
  private readonly pendingDeaths = new Map<EntityId, number>();
  private readonly styles = new Map<PlayerId, PlayerStyle>();
  private readonly gaiaStyle: PlayerStyle = {
    color: WHITE,
    architecture: DEFAULT_ARCHITECTURE,
    age: 'stone',
  };
  private readonly items: DrawItem[] = [];
  private readonly itemPool: DrawItem[] = [];
  private readonly sprites: SpritePool;
  private readonly rings: SpritePool;
  private readonly bars: SpritePool;
  private corpses: Corpse[] = [];
  private projectiles: ProjectileView[] = [];
  private selection = new Set<EntityId>();
  private tick = 0;
  private stamp = 0;

  constructor(data: GameData, metrics: MetricsCache, resolver: SpriteResolver) {
    this.data = data;
    this.metrics = metrics;
    this.resolver = resolver;
    this.sprites = new SpritePool(this.container);
    this.rings = new SpritePool(this.ringContainer);
    this.bars = new SpritePool(this.barContainer);
  }

  get playerStyles(): ReadonlyMap<PlayerId, PlayerStyle> {
    return this.styles;
  }

  styleOf(owner: PlayerId): PlayerStyle {
    return this.styles.get(owner) ?? this.gaiaStyle;
  }

  clear(): void {
    this.records.clear();
    this.removed.clear();
    this.pendingDeaths.clear();
    this.corpses = [];
    this.projectiles = [];
  }

  setSelection(ids: readonly EntityId[]): void {
    this.selection = new Set(ids);
  }

  position(id: EntityId): { x: number; y: number } | null {
    const record = this.records.get(id);
    return record ? { x: record.x, y: record.y } : null;
  }

  forEachEntity(visit: (view: EntityView, color: number, dim: boolean) => void): void {
    for (const record of this.records.values()) {
      visit(record.view, record.color, record.dim);
    }
  }

  applyView(view: PlayerView, now: number): void {
    this.tick = view.tick;
    this.projectiles = view.projectiles;
    this.stamp += 1;
    this.styles.clear();
    for (const player of view.players) {
      this.styles.set(player.id, {
        color: player.color,
        architecture:
          this.data.civilizations[player.civilization]?.architectureSet ?? DEFAULT_ARCHITECTURE,
        age: player.age,
      });
    }
    const size = view.map.size;
    const visible = view.fog.visible;
    for (const entity of view.entities) {
      const record = this.track(entity, now);
      record.stamp = this.stamp;
      const tileX = Math.floor(entity.position.x);
      const tileY = Math.floor(entity.position.y);
      const inside = tileX >= 0 && tileY >= 0 && tileX < size && tileY < size;
      record.dim =
        entity.remembered ||
        (entity.owner !== view.playerId && inside && !(visible[tileY * size + tileX] > 0));
      const style = this.styles.get(entity.owner);
      record.color =
        entity.owner === GAIA_PLAYER_ID || !style ? record.metrics.gaiaColor : style.color;
    }
    for (const [id, record] of this.records) {
      if (record.stamp === this.stamp) {
        continue;
      }
      this.records.delete(id);
      if (this.pendingDeaths.delete(id)) {
        this.addCorpse(record, now);
      } else {
        this.removed.set(id, { record, at: now });
      }
    }
    for (const [id, entry] of this.removed) {
      if (now - entry.at > REMOVED_MEMORY_MS) {
        this.removed.delete(id);
      }
    }
    for (const [id, at] of this.pendingDeaths) {
      if (now - at > PENDING_DEATH_MS) {
        this.pendingDeaths.delete(id);
      }
    }
  }

  applyEvents(events: readonly SimEvent[], now: number): void {
    for (const event of events) {
      if (event.type !== 'entityDied') {
        continue;
      }
      const gone = this.removed.get(event.entityId);
      if (gone) {
        this.removed.delete(event.entityId);
        this.addCorpse(gone.record, now);
      } else if (this.records.has(event.entityId)) {
        this.pendingDeaths.set(event.entityId, now);
      }
    }
  }

  update(alpha: number, now: number, bounds: ScreenBounds, transform: ViewTransform): void {
    const field = transform.heightField;
    const blend = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
    this.items.length = 0;
    this.rings.begin();
    this.bars.begin();
    for (const record of this.records.values()) {
      if (record.moving) {
        record.x = record.fromX + (record.toX - record.fromX) * blend;
        record.y = record.fromY + (record.toY - record.fromY) * blend;
      }
      if (record.moving || record.pixelDirty) {
        record.pixelX = projectX(record.x, record.y);
        record.pixelY = projectY(record.x, record.y, sampleHeight(field, record.x, record.y));
        record.pixelDirty = false;
      }
      const metrics = record.metrics;
      const reachX =
        Math.max(metrics.halfWidth, metrics.footprint * TILE_HALF_WIDTH) + CULL_PADDING;
      record.onScreen =
        record.pixelX + reachX >= bounds.left &&
        record.pixelX - reachX <= bounds.right &&
        record.pixelY + metrics.footprint * TILE_HALF_HEIGHT + LABEL_PADDING >= bounds.top &&
        record.pixelY - metrics.height - LABEL_PADDING <= bounds.bottom;
      if (record.onScreen) {
        this.emitEntity(record, now);
      }
    }
    this.emitCorpses(now, bounds);
    this.emitProjectiles(blend, bounds, transform);
    this.items.sort(compareDepth);
    this.sprites.begin();
    for (const item of this.items) {
      this.writeSprite(this.sprites.next(), item.frame, item, item.tint);
      if (item.mask) {
        this.writeSprite(this.sprites.next(), item.mask, item, item.maskTint);
      }
      this.itemPool.push(item);
    }
    this.sprites.end();
    this.rings.end();
    this.bars.end();
  }

  pickTargets(transform: ViewTransform): PickTarget[] {
    const zoom = transform.zoom;
    const originX = transform.originX;
    const originY = transform.originY;
    const targets: PickTarget[] = [];
    for (const record of this.records.values()) {
      if (!record.onScreen) {
        continue;
      }
      const metrics = record.metrics;
      targets.push({
        id: record.view.id,
        priority: metrics.pickPriority,
        depth: record.x + record.y,
        screenX: record.pixelX * zoom + originX,
        screenY: record.pixelY * zoom + originY,
        halfWidth: metrics.halfWidth * zoom,
        height: metrics.height * zoom,
        footprintHalfWidth: metrics.footprint * TILE_HALF_WIDTH * zoom,
        footprintHalfHeight: metrics.footprint * TILE_HALF_HEIGHT * zoom,
        groundFirst: record.view.kind === 'resource',
      });
    }
    return targets;
  }

  private track(entity: EntityView, now: number): EntityRecord {
    const existing = this.records.get(entity.id);
    const x = entity.position.x;
    const y = entity.position.y;
    if (!existing) {
      const record: EntityRecord = {
        view: entity,
        metrics: this.metrics.get(entity.kind, entity.type),
        fromX: x,
        fromY: y,
        toX: x,
        toY: y,
        x,
        y,
        pixelX: 0,
        pixelY: 0,
        moving: false,
        pixelDirty: true,
        onScreen: false,
        stamp: this.stamp,
        dim: false,
        color: WHITE,
        direction: entity.kind === 'unit' ? directionIndex(entity.facing) : 0,
        facing: entity.facing,
        stateSince: now,
        visual: null,
        visualState: '',
        visualDirection: -1,
        visualArchitecture: null,
        visualAge: null,
        loop: true,
        motion: 'none',
        stage: 'full',
      };
      this.records.set(entity.id, record);
      return record;
    }
    const previous = existing.view;
    if (previous.type !== entity.type || previous.kind !== entity.kind) {
      existing.metrics = this.metrics.get(entity.kind, entity.type);
      existing.visual = null;
    }
    if (previous.state !== entity.state) {
      existing.stateSince = now;
      existing.visual = null;
    }
    if (existing.facing !== entity.facing) {
      existing.facing = entity.facing;
      existing.direction = entity.kind === 'unit' ? directionIndex(entity.facing) : 0;
    }
    const dx = x - existing.x;
    const dy = y - existing.y;
    const far = dx * dx + dy * dy > SNAP_DISTANCE_SQ;
    existing.fromX = far ? x : existing.x;
    existing.fromY = far ? y : existing.y;
    existing.toX = x;
    existing.toY = y;
    existing.moving = existing.fromX !== x || existing.fromY !== y;
    if (far) {
      existing.x = x;
      existing.y = y;
      existing.pixelDirty = true;
    }
    existing.view = entity;
    return existing;
  }

  private resolve(record: EntityRecord): Visual {
    const view = record.view;
    switch (view.kind) {
      case 'unit': {
        const state = view.own?.carry ? `${view.state}:${view.own.carry.kind}` : view.state;
        if (
          record.visual &&
          record.visualState === state &&
          record.visualDirection === record.direction
        ) {
          return record.visual;
        }
        const animation = unitAnimation(view);
        record.visualState = state;
        record.visualDirection = record.direction;
        record.loop = animation.loop;
        record.motion = animation.motion;
        record.visual = this.resolver.unit(view.type, animation.names, record.direction);
        return record.visual;
      }
      case 'building': {
        const stage = buildingStage(view);
        const style = this.styleOf(view.owner);
        if (
          record.visual &&
          record.stage === stage &&
          record.visualArchitecture === style.architecture &&
          record.visualAge === style.age
        ) {
          return record.visual;
        }
        record.stage = stage;
        record.visualArchitecture = style.architecture;
        record.visualAge = style.age;
        record.visual = this.resolver.building(view.type, style.architecture, style.age, stage);
        return record.visual;
      }
      case 'resource':
        record.visual ??= this.resolver.resource(view.type);
        return record.visual;
      default:
        record.visual ??= this.resolver.object(view.type);
        return record.visual;
    }
  }

  private item(): DrawItem {
    const item = this.itemPool.pop() ?? {
      depth: 0,
      order: 0,
      frame: this.resolver.ring,
      mask: null,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      alpha: 1,
      tint: WHITE,
      maskTint: WHITE,
      rotation: 0,
    };
    item.mask = null;
    item.scaleX = 1;
    item.scaleY = 1;
    item.alpha = 1;
    item.rotation = 0;
    this.items.push(item);
    return item;
  }

  private emitEntity(record: EntityRecord, now: number): void {
    const view = record.view;
    const metrics = record.metrics;
    const visual = this.resolve(record);
    const item = this.item();
    const dimming = record.dim ? FOG_DIM : 1;
    item.x = record.pixelX;
    item.y = record.pixelY;
    item.depth = depthKey(metrics.layer, record.x, record.y);
    item.order = view.id;
    const clip = visual.clip;
    if (clip) {
      const length = clip.frames.length;
      const index =
        view.kind === 'resource'
          ? view.id % length
          : clipFrameIndex(length, (now - record.stateSince) / 1000, record.loop);
      item.frame = clip.frames[index];
      item.mask = clip.masks ? (clip.masks[index] ?? null) : null;
      item.tint = record.dim ? shadeColor(WHITE, dimming) : WHITE;
      item.maskTint = shadeColor(record.color, dimming);
      if (clip.flip) {
        item.scaleX = -1;
      }
    } else {
      item.frame = visual.frame;
      const damage = view.kind === 'building' ? DAMAGE_SHADE[record.stage] : 1;
      item.tint = shadeColor(record.color, dimming * damage);
      if (view.kind === 'unit') {
        this.animatePlaceholder(item, record, now);
      } else if (view.kind === 'building' && (record.stage === 'c1' || record.stage === 'c2')) {
        item.alpha = 0.85;
      }
    }
    const selected = this.selection.has(view.id);
    if (selected) {
      this.emitRing(record);
    }
    const damaged = view.hp < view.maxHp && !record.dim;
    if ((view.kind === 'unit' || view.kind === 'building') && view.maxHp > 0 && (selected || damaged)) {
      this.emitBar(record, view.hp / view.maxHp);
    }
  }

  private animatePlaceholder(item: DrawItem, record: EntityRecord, now: number): void {
    const id = record.view.id;
    switch (record.motion) {
      case 'walk':
        item.y -= Math.abs(Math.sin((now + id * 97) * 0.012)) * 3;
        break;
      case 'attack': {
        const phase = ((now - record.stateSince) % 600) / 600;
        const lunge = phase < 0.3 ? phase / 0.3 : (1 - phase) / 0.7;
        const vector = directionVector(record.direction);
        item.x += vector.x * 6 * lunge;
        item.y += vector.y * 6 * lunge;
        break;
      }
      case 'work':
        item.scaleY = 1 - 0.1 * Math.abs(Math.sin(now * 0.01 + id));
        break;
      case 'none':
        break;
    }
  }

  private emitRing(record: EntityRecord): void {
    const metrics = record.metrics;
    const sprite = this.rings.next();
    if (metrics.footprint > 0) {
      const frame = this.resolver.diamond;
      const scale = (metrics.footprint * TILE_HALF_WIDTH) / 64;
      sprite.texture = frame.texture;
      sprite.anchor.set(frame.anchorX, frame.anchorY);
      sprite.scale.set(scale, scale);
    } else {
      const frame = this.resolver.ring;
      const scale = metrics.ringRadius / 32;
      sprite.texture = frame.texture;
      sprite.anchor.set(frame.anchorX, frame.anchorY);
      sprite.scale.set(scale, scale);
    }
    sprite.position.set(record.pixelX, record.pixelY);
  }

  private emitBar(record: EntityRecord, fraction: number): void {
    const metrics = record.metrics;
    const width = metrics.barWidth;
    const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    const left = record.pixelX - width / 2;
    const top = record.pixelY - metrics.height - BAR_GAP;
    const background = this.bars.next();
    background.tint = 0x000000;
    background.position.set(left - 1, top - 1);
    background.scale.set(width + 2, BAR_HEIGHT + 2);
    const fill = this.bars.next();
    fill.tint = healthColor(clamped);
    fill.position.set(left, top);
    fill.scale.set(Math.max(1, width * clamped), BAR_HEIGHT);
  }

  private addCorpse(record: EntityRecord, now: number): void {
    const view = record.view;
    if (view.kind !== 'unit' && view.kind !== 'building') {
      return;
    }
    if (!record.visual || record.dim) {
      return;
    }
    const real =
      view.kind === 'unit' &&
      this.resolver.unitClip(view.type, DIE_ANIMATION, record.direction) !== null;
    this.corpses.push({
      kind: view.kind,
      type: view.type,
      id: view.id,
      x: record.x,
      y: record.y,
      pixelX: record.pixelX,
      pixelY: record.pixelY,
      direction: record.direction,
      color: record.color,
      startedAt: now,
      frame: record.visual.clip ? record.visual.clip.frames[0] : record.visual.frame,
      real,
    });
  }

  private emitCorpses(now: number, bounds: ScreenBounds): void {
    let kept = 0;
    for (const corpse of this.corpses) {
      const elapsed = now - corpse.startedAt;
      const lifetime =
        corpse.kind === 'building' ? BUILDING_CORPSE_MS : corpse.real ? REAL_CORPSE_MS : UNIT_CORPSE_MS;
      if (elapsed >= lifetime) {
        continue;
      }
      this.corpses[kept] = corpse;
      kept += 1;
      if (
        corpse.pixelX < bounds.left - 96 ||
        corpse.pixelX > bounds.right + 96 ||
        corpse.pixelY < bounds.top - 96 ||
        corpse.pixelY > bounds.bottom + 160
      ) {
        continue;
      }
      const item = this.item();
      item.x = corpse.pixelX;
      item.y = corpse.pixelY;
      item.order = corpse.id;
      item.frame = corpse.frame;
      item.tint = corpse.color;
      item.maskTint = corpse.color;
      const collapsed = elapsed >= COLLAPSE_MS;
      item.depth = depthKey(
        collapsed && corpse.kind === 'unit' ? DEPTH_LAYER.ground : DEPTH_LAYER.upright,
        corpse.x,
        corpse.y,
      );
      if (corpse.real) {
        this.emitRealCorpse(item, corpse, elapsed, lifetime);
        continue;
      }
      const fall = Math.min(1, elapsed / COLLAPSE_MS);
      item.scaleY = 1 - (corpse.kind === 'building' ? 0.8 : 0.65) * fall;
      item.alpha = Math.max(0, 1 - elapsed / lifetime);
    }
    this.corpses.length = kept;
  }

  private emitRealCorpse(item: DrawItem, corpse: Corpse, elapsed: number, lifetime: number): void {
    const die = this.resolver.unitClip(corpse.type, DIE_ANIMATION, corpse.direction);
    if (!die) {
      return;
    }
    const seconds = elapsed / 1000;
    const dieIndex = clipFrameIndex(die.frames.length, seconds, false);
    let clip = die;
    let index = dieIndex;
    if (dieIndex >= die.frames.length - 1) {
      const decay = this.resolver.unitClip(corpse.type, DECAY_ANIMATION, corpse.direction);
      if (decay) {
        const spent = die.frames.length / 12;
        const remaining = Math.max(0.001, lifetime / 1000 - spent);
        const progress = Math.min(1, Math.max(0, seconds - spent) / remaining);
        clip = decay;
        index = Math.min(decay.frames.length - 1, Math.floor(progress * decay.frames.length));
      }
    }
    item.frame = clip.frames[index];
    item.mask = clip.masks ? (clip.masks[index] ?? null) : null;
    item.tint = WHITE;
    item.scaleX = clip.flip ? -1 : 1;
    item.alpha = Math.min(1, (lifetime - elapsed) / 1500);
  }

  private emitProjectiles(alpha: number, bounds: ScreenBounds, transform: ViewTransform): void {
    const field = transform.heightField;
    const time = this.tick - 1 + alpha;
    for (const projectile of this.projectiles) {
      const span = Math.max(1, projectile.arriveTick - projectile.launchTick);
      const t = Math.min(1, Math.max(0, (time - projectile.launchTick) / span));
      const from = projectile.origin;
      const to = projectile.destination;
      const fromX = projectX(from.x, from.y);
      const fromY = projectY(from.x, from.y, sampleHeight(field, from.x, from.y)) - 16;
      const toX = projectX(to.x, to.y);
      const toY = projectY(to.x, to.y, sampleHeight(field, to.x, to.y)) - 8;
      const reach = Math.hypot(to.x - from.x, to.y - from.y);
      const arc = Math.min(64, reach * 5);
      const x = fromX + (toX - fromX) * t;
      const y = fromY + (toY - fromY) * t - Math.sin(Math.PI * t) * arc;
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
        continue;
      }
      const visual = this.resolver.projectile(projectile.sourceType);
      const item = this.item();
      item.x = x;
      item.y = y;
      item.depth = depthKey(DEPTH_LAYER.air, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      item.order = projectile.id;
      item.frame = visual.frame;
      item.rotation = Math.atan2(
        toY - fromY - Math.PI * Math.cos(Math.PI * t) * arc,
        toX - fromX,
      );
      item.tint = visual.clip ? WHITE : ARROW_TINT;
    }
  }

  private writeSprite(sprite: Sprite, frame: SpriteFrame, item: DrawItem, tint: number): void {
    sprite.texture = frame.texture;
    sprite.anchor.set(frame.anchorX, frame.anchorY);
    sprite.position.set(item.x, item.y);
    sprite.scale.set(item.scaleX, item.scaleY);
    sprite.rotation = item.rotation;
    sprite.alpha = item.alpha;
    sprite.tint = tint;
  }
}
