import type { RendererOptions, RendererResult } from './api';

export type * from './api';

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) !== null;
  } catch {
    return false;
  }
}

export async function createRenderer(options: RendererOptions): Promise<RendererResult> {
  if (!isWebGLAvailable()) {
    return { ok: false, error: 'webgl_unavailable' };
  }
  try {
    const { createPixiRenderer } = await import('./pixiRenderer');
    return { ok: true, renderer: await createPixiRenderer(options) };
  } catch (error) {
    console.error(`Renderer initialization failed: ${String(error)}`);
    return { ok: false, error: 'init_failed' };
  }
}
