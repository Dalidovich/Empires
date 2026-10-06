import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const deterministicModules = ['src/sim/**/*.ts', 'src/ai/**/*.ts', 'src/mapgen/**/*.ts'];

const forbiddenModuleNames = ['render', 'ui', 'audio', 'storage'];

const forbiddenImportPatterns = forbiddenModuleNames.flatMap((name) => [
  `**/${name}`,
  `**/${name}/**`,
]);

const browserGlobals = Object.keys(globals.browser).filter(
  (name) => !(name in globals['shared-node-browser']),
);

const forbiddenGlobals = [...new Set([...browserGlobals, 'Date', 'performance'])].map((name) => ({
  name,
  message: 'Simulation, AI and map generation must stay deterministic and browser-free.',
}));

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'public/**', 'tests/acceptance/results/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: deterministicModules,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: forbiddenImportPatterns,
              message: 'src/sim, src/ai and src/mapgen must not import render, ui, audio or storage.',
            },
            {
              group: ['pixi.js', 'pixi.js/**', 'idb', 'fake-indexeddb', 'fake-indexeddb/**'],
              message: 'Browser-only packages are not allowed in deterministic modules.',
            },
          ],
        },
      ],
    },
  },
  {
    files: deterministicModules,
    ignores: ['src/sim/worker.ts', '**/__tests__/**', '**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', ...forbiddenGlobals],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use the seeded generator from src/sim/rng.ts.',
        },
      ],
    },
  },
);
