import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StaticServer } from './support/staticServer';
import { startStaticServer } from './support/staticServer';

const OUTPUT = join(process.cwd(), 'tests', 'acceptance', 'results', 'dist');
const VITE_CLI = join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
const PREFIX = '/games/aoe/';
const BUILD_TIMEOUT_MS = 300000;

function build(): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [VITE_CLI, 'build', '--outDir', OUTPUT, '--emptyOutDir', '--logLevel', 'warn'],
      { cwd: process.cwd() },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : 1, output: `${stdout}${stderr}` });
      },
    );
  });
}

function references(text: string): string[] {
  return [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
}

describe('criterion 14: static build', () => {
  let server: StaticServer;
  let result: { code: number; output: string };

  beforeAll(async () => {
    rmSync(OUTPUT, { recursive: true, force: true });
    result = await build();
    server = await startStaticServer(OUTPUT, 0, PREFIX);
  }, BUILD_TIMEOUT_MS);

  afterAll(async () => {
    await server?.close();
  });

  it('builds without errors into plain files', () => {
    expect(result.code, result.output).toBe(0);
    expect(existsSync(join(OUTPUT, 'index.html'))).toBe(true);
    const assets = readdirSync(join(OUTPUT, 'assets'));
    expect(assets.some((name) => /^index-.*\.js$/.test(name))).toBe(true);
    expect(assets.some((name) => /^worker-.*\.js$/.test(name))).toBe(true);
    expect(assets.some((name) => /^index-.*\.css$/.test(name))).toBe(true);
    expect(assets).toContain('manifest.json');
  });

  it('references every file relatively, so any sub-path of any host works', () => {
    const html = readFileSync(join(OUTPUT, 'index.html'), 'utf8');
    const links = references(html).filter((link) => !link.startsWith('data:'));
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect(link.startsWith('./'), link).toBe(true);
      expect(existsSync(join(OUTPUT, link)), link).toBe(true);
    }
    const entry = links.find((link) => link.endsWith('.js')) ?? '';
    const code = readFileSync(join(OUTPUT, entry), 'utf8');
    expect(code).not.toMatch(/["'`]\/assets\//);
    expect(code).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)/);
    expect(code).toMatch(/new Worker\(/);
  });

  it('is served by a file server without any server logic', async () => {
    const page = await fetch(server.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    for (const link of references(html).filter((item) => item.startsWith('./'))) {
      const response = await fetch(new URL(link, server.url));
      expect(response.status, link).toBe(200);
      const type = response.headers.get('content-type') ?? '';
      expect(type, link).toContain(link.endsWith('.css') ? 'text/css' : 'text/javascript');
      await response.arrayBuffer();
    }
    const manifest = await fetch(new URL('./assets/manifest.json', server.url));
    expect(manifest.status).toBe(200);
    expect(Object.keys((await manifest.json()) as object).sort()).toEqual(['music', 'sounds', 'sprites', 'version']);
    const worker = readdirSync(join(OUTPUT, 'assets')).find((name) => /^worker-.*\.js$/.test(name)) ?? '';
    expect((await fetch(new URL(`./assets/${worker}`, server.url))).status).toBe(200);
    expect((await fetch(new URL('./api/anything', server.url))).status).toBe(404);
    expect(server.requests.every((request) => request.path.startsWith(PREFIX))).toBe(true);
  });

  it('ships every sprite atlas referenced by the manifest', () => {
    const root = join(process.cwd(), 'public', 'assets');
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
      sprites: Record<string, { atlas: string }>;
    };
    const atlases = [...new Set(Object.values(manifest.sprites).map((sprite) => sprite.atlas))];
    expect(atlases.length).toBeGreaterThan(0);
    for (const atlas of atlases) {
      expect(existsSync(join(root, atlas)), atlas).toBe(true);
      const sheet = JSON.parse(readFileSync(join(root, atlas), 'utf8')) as { meta: { image: string } };
      expect(existsSync(join(root, atlas, '..', sheet.meta.image)), sheet.meta.image).toBe(true);
      expect(existsSync(join(OUTPUT, 'assets', atlas)), atlas).toBe(true);
    }
  });
});
