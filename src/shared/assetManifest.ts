export interface SpriteAsset {
  atlas: string;
  animations?: Record<string, string>;
}

export interface AssetManifest {
  version: number;
  sprites: Record<string, SpriteAsset>;
  sounds: Record<string, string[]>;
  music: string[];
}

export const ASSET_BASE_PATH = 'assets/';

export const MANIFEST_FILE = 'manifest.json';

export function emptyManifest(): AssetManifest {
  return { version: 1, sprites: {}, sounds: {}, music: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseSprites(value: unknown): Record<string, SpriteAsset> {
  const sprites: Record<string, SpriteAsset> = {};
  if (!isRecord(value)) {
    return sprites;
  }
  for (const [id, entry] of Object.entries(value)) {
    if (!isRecord(entry) || typeof entry.atlas !== 'string') {
      continue;
    }
    const sprite: SpriteAsset = { atlas: entry.atlas };
    if (isRecord(entry.animations)) {
      sprite.animations = {};
      for (const [name, frame] of Object.entries(entry.animations)) {
        if (typeof frame === 'string') {
          sprite.animations[name] = frame;
        }
      }
    }
    sprites[id] = sprite;
  }
  return sprites;
}

function parseSounds(value: unknown): Record<string, string[]> {
  const sounds: Record<string, string[]> = {};
  if (!isRecord(value)) {
    return sounds;
  }
  for (const [id, files] of Object.entries(value)) {
    if (isStringArray(files)) {
      sounds[id] = files;
    } else if (typeof files === 'string') {
      sounds[id] = [files];
    }
  }
  return sounds;
}

export function parseManifest(raw: unknown): AssetManifest {
  if (!isRecord(raw)) {
    return emptyManifest();
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    sprites: parseSprites(raw.sprites),
    sounds: parseSounds(raw.sounds),
    music: isStringArray(raw.music) ? raw.music : [],
  };
}

export function assetUrl(file: string, basePath: string = ASSET_BASE_PATH): string {
  return `${basePath}${file}`;
}

export async function loadAssetManifest(basePath: string = ASSET_BASE_PATH): Promise<AssetManifest> {
  try {
    const response = await fetch(assetUrl(MANIFEST_FILE, basePath));
    if (!response.ok) {
      console.warn(`Asset manifest not available: ${response.status}`);
      return emptyManifest();
    }
    return parseManifest(await response.json());
  } catch (error) {
    console.warn(`Asset manifest failed to load: ${String(error)}`);
    return emptyManifest();
  }
}
