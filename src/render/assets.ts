import { Assets } from 'pixi.js';
import type { Spritesheet, Texture } from 'pixi.js';
import { ASSET_BASE_PATH, assetUrl } from '../shared/assetManifest';
import type { AssetManifest } from '../shared/assetManifest';
import type { SpriteFrame } from './canvasAtlas';
import { DIRECTIONS, mirroredDirection } from './projection';

export const ANIMATION_FPS = 12;
export const MASK_SUFFIX = '_mask';
export const TERRAIN_SPRITE_ID = 'terrain';

export interface AnimationClip {
  frames: SpriteFrame[];
  masks: SpriteFrame[] | null;
  flip: boolean;
}

interface LoadedSprite {
  animations: Map<string, SpriteFrame[]>;
  textures: Map<string, Texture>;
  aliases: Record<string, string>;
}

function frameOf(texture: Texture): SpriteFrame {
  return {
    texture,
    anchorX: texture.defaultAnchor?.x ?? 0.5,
    anchorY: texture.defaultAnchor?.y ?? 1,
  };
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export class SpriteLibrary {
  private readonly manifest: AssetManifest;
  private readonly basePath: string;
  private readonly sprites = new Map<string, LoadedSprite>();
  private readonly loadedUrls: string[] = [];

  constructor(manifest: AssetManifest, basePath: string = ASSET_BASE_PATH) {
    this.manifest = manifest;
    this.basePath = basePath;
  }

  async load(): Promise<void> {
    const entries = Object.entries(this.manifest.sprites);
    await Promise.all(
      entries.map(async ([id, entry]) => {
        const url = assetUrl(entry.atlas, this.basePath);
        try {
          const sheet = await Assets.load<Spritesheet>(url);
          if (!sheet || typeof sheet !== 'object' || !('textures' in sheet)) {
            console.warn(`Sprite atlas has an unexpected format: ${url}`);
            return;
          }
          this.loadedUrls.push(url);
          this.sprites.set(id, this.index(sheet, entry.animations ?? {}));
        } catch (error) {
          console.warn(`Sprite atlas failed to load: ${url}: ${String(error)}`);
        }
      }),
    );
  }

  has(id: string): boolean {
    return this.sprites.has(id);
  }

  firstAvailable(ids: readonly string[]): string | null {
    for (const id of ids) {
      if (this.sprites.has(id)) {
        return id;
      }
    }
    return null;
  }

  texture(id: string, frame: string): Texture | null {
    return this.sprites.get(id)?.textures.get(frame) ?? null;
  }

  clip(id: string, animations: readonly string[], direction: number): AnimationClip | null {
    const sprite = this.sprites.get(id);
    if (!sprite) {
      return null;
    }
    const suffix = DIRECTIONS[direction] ?? DIRECTIONS[0];
    const mirrored = DIRECTIONS[mirroredDirection(direction)] ?? suffix;
    for (const animation of animations) {
      const name = sprite.aliases[animation] ?? animation;
      const candidates: [string, boolean][] = [
        [`${name}_${suffix}`, false],
        [`${name}_${mirrored}`, true],
        [name, false],
      ];
      for (const [candidate, flip] of candidates) {
        const frames = sprite.animations.get(candidate);
        if (frames && frames.length > 0) {
          const masks = sprite.animations.get(`${candidate}${MASK_SUFFIX}`) ?? null;
          return { frames, masks: masks && masks.length > 0 ? masks : null, flip };
        }
      }
    }
    return null;
  }

  destroy(): void {
    for (const url of this.loadedUrls) {
      void Assets.unload(url).catch(() => undefined);
    }
    this.loadedUrls.length = 0;
    this.sprites.clear();
  }

  private index(sheet: Spritesheet, aliases: Record<string, string>): LoadedSprite {
    const animations = new Map<string, SpriteFrame[]>();
    const textures = new Map<string, Texture>();
    for (const [name, texture] of Object.entries(sheet.textures)) {
      const key = stripExtension(name);
      textures.set(key, texture);
      animations.set(key, [frameOf(texture)]);
    }
    for (const [name, frames] of Object.entries(sheet.animations ?? {})) {
      animations.set(name, frames.map(frameOf));
    }
    return { animations, textures, aliases };
  }
}

export function clipFrameIndex(length: number, seconds: number, loop: boolean): number {
  if (length <= 1) {
    return 0;
  }
  const index = Math.floor(Math.max(0, seconds) * ANIMATION_FPS);
  return loop ? index % length : Math.min(length - 1, index);
}
