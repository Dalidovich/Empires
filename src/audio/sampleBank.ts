import type { AssetManifest } from '../shared/assetManifest';
import { assetUrl } from '../shared/assetManifest';

export type WarnOnce = (key: string, message: string) => void;

export function createWarnOnce(): WarnOnce {
  const reported = new Set<string>();
  return (key, message) => {
    if (reported.has(key)) {
      return;
    }
    reported.add(key);
    console.warn(message);
  };
}

export class SampleBank {
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly cursors = new Map<string, number>();

  constructor(
    private readonly manifest: AssetManifest,
    private readonly basePath: string,
    private readonly warn: WarnOnce,
  ) {}

  resolve(candidates: readonly string[]): string | null {
    for (const id of candidates) {
      if (this.files(id).length > 0) {
        return id;
      }
    }
    const fallback = candidates[candidates.length - 1];
    if (fallback !== undefined) {
      this.warn(`sound:${fallback}`, `Audio asset missing: sound "${fallback}" is not in the manifest`);
    }
    return null;
  }

  load(context: BaseAudioContext, id: string): Promise<AudioBuffer | null> {
    const file = this.nextFile(id);
    if (file === null) {
      return Promise.resolve(null);
    }
    let pending = this.buffers.get(file);
    if (!pending) {
      pending = this.decode(context, file)
        .catch(() => null)
        .then((buffer) => {
          if (!buffer) {
            this.warn(`sound:${id}`, `Audio asset failed to load: sound "${id}" (${file})`);
          }
          return buffer;
        });
      this.buffers.set(file, pending);
    }
    return pending;
  }

  clear(): void {
    this.buffers.clear();
    this.cursors.clear();
  }

  private files(id: string): readonly string[] {
    return Object.hasOwn(this.manifest.sounds, id) ? (this.manifest.sounds[id] ?? []) : [];
  }

  private nextFile(id: string): string | null {
    const files = this.files(id);
    if (files.length === 0) {
      return null;
    }
    const cursor = this.cursors.get(id) ?? 0;
    this.cursors.set(id, (cursor + 1) % files.length);
    return files[cursor] ?? null;
  }

  private async decode(context: BaseAudioContext, file: string): Promise<AudioBuffer> {
    const response = await fetch(assetUrl(file, this.basePath));
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    return context.decodeAudioData(await response.arrayBuffer());
  }
}
