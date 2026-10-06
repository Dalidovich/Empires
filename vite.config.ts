import { defineConfig } from 'vitest/config';

const domModules = 'src/{ui,render,audio,storage,shared}';
const domAcceptance = 'tests/acceptance/dom';
const testFiles = '**/*.test.ts';
const skipHeadless =
  process.env.npm_lifecycle_event === 'test:fast' || process.env.SKIP_HEADLESS === '1';
const headlessSuite = skipHeadless ? ['tests/acceptance/headless.test.ts'] : [];

export default defineConfig({
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [`src/${testFiles}`, `tools/${testFiles}`, `tests/${testFiles}`],
          exclude: [`${domModules}/${testFiles}`, `${domAcceptance}/${testFiles}`, 'node_modules/**', ...headlessSuite],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: [`${domModules}/${testFiles}`, `${domAcceptance}/${testFiles}`],
        },
      },
    ],
  },
});
