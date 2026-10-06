# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Browser clone of Age of Empires (1997): TypeScript strict, Vite, PixiJS 8 (WebGL), HTML/CSS UI over canvas, simulation in a Web Worker, Web Audio, IndexedDB + localStorage, Vitest.

## Commands

| Command | Action |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `tsc --noEmit` + build to `dist/` |
| `npm test` | Vitest, all projects, including the headless acceptance suite (about 45 CLI games in parallel, 10–15 minutes) |
| `npm run test:fast` | everything except the long headless suite, under a minute. Same effect: `SKIP_HEADLESS=1` with any `vitest` command. CLI `--exclude` does not work: projects in `vite.config.ts` define their own `exclude` |
| `npx vitest run tests/acceptance` | acceptance tests; measurements land in `tests/acceptance/results/` (git-ignored) |
| `npx vitest run src/sim/__tests__/rng.test.ts` | single test file |
| `npx vitest run -t "name"` | tests by name |
| `npx vitest run --project node` / `--project dom` | one project |
| `npm run lint` | ESLint incl. import boundaries |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run sim -- --seed 1 --map inland --size tiny --players assyrian:moderate,greek:hard --max-ticks 1000` | headless AI-vs-AI run; JSON result on stdout, log on stderr; exit 0 finished, 1 error, 2 tick limit |
| `npm run assets` | regenerate procedural sprite atlases and `public/assets/manifest.json` (`tools/assets/`, about a minute); `-- --out <dir>` writes elsewhere. `public/assets/` is git-ignored: run once after a fresh clone |
| `npx tsx src/ai/__tests__/batch.ts --suite mirror --seeds 1-3` | AI batch (`mirror`, `dominance`, `islands`); one JSON line per game |
| `AI_BATCH=1 npx vitest run src/ai/__tests__/batch.test.ts` | full AI acceptance batch, about 10 minutes; skipped without the variable |

Test environments are chosen by path (`vite.config.ts`): `src/{ui,render,audio,storage,shared}` run in jsdom, everything else (`src/sim`, `src/ai`, `src/mapgen`, `src/data`, `tools`, `tests`) in Node, except `tests/acceptance/dom`, which runs in jsdom.

Renderer harness with synthetic data, no simulation: `npm run dev`, open `/src/render/harness/index.html`.

Generative music harness (seed, mood, age): `npm run dev`, open `/src/audio/harness/index.html`.

## Architecture

Data flow:

```
src/data (JSON + zod) ──► GameData (frozen)
                              │
UI ──Command[]──► worker ──► session ──► engine.step ──► systems pipeline ──► GameState
 ▲                                                                              │
 └──── PlayerView (fog-filtered) + SimEvent[] ◄──── buildPlayerView ◄───────────┘
```

- `src/sim` — deterministic simulation. `engine.ts` runs a fixed `PIPELINE` of systems (`systems/*.ts`), each `{ id, handleCommand?, update? }`. `core/` holds shared helpers (entities, spatial index, navgrid, pathfinding, movement, orders, visibility, session host). `GameState` is plain JSON, which is what makes saves and determinism work.
- `src/sim/core/session.ts` — host loop shared by `worker.ts` (browser) and `tools/sim.ts` (Node): queues commands, steps the engine, runs every AI once per tick.
- `src/sim/snapshot.ts` — `PlayerView` is the only thing renderer, UI and AI ever see. AI never touches `GameState`.
- `src/mapgen` — seeded map generator, called by `createGame`.
- `src/ai` — `AiController.think(view, tick) → Command[]`. Managers (economy, strategy, military, naval, scouting, relics, diplomacy) run in a fixed order over a per-decision `Think` context; all memory is the JSON `AiState`; tuning per level in `src/data/ai.json`.
- `src/render` — PixiJS isometric renderer behind `Renderer` in `api.ts`; draws placeholders for anything absent from `public/assets/manifest.json`.
- `src/ui` — DOM screens and HUD; `app.ts` builds `AppContext` and swaps `Screen`s; `game/session.ts` wraps the worker protocol. All dependencies are injectable through `AppOverrides` for tests.
- `src/audio`, `src/storage` — behind their `api.ts`; errors are codes, the UI translates them.

Modules talk to each other only through `api.ts` / `index.ts`.

## Hard constraints

- Determinism: `src/sim`, `src/ai`, `src/mapgen` must not import `render`/`ui`/`audio`/`storage`/`pixi.js`/`idb`, nor use browser globals, `Math.random`, `Date`, `performance`. ESLint enforces it; exempt: `src/sim/worker.ts`, tests. Randomness only via `src/sim/rng.ts`. Iterate entities and players by ascending id; break sort ties by id. No state outside `GameState`.
- Contract files are append-only: `src/sim/{types,commands,events,snapshot,protocol,system}.ts`, `src/data/{types,schema}.ts`, every module `api.ts`, `package.json`. Additive edits only; never rename, reorder or reformat. New union members must not break consumers: they use a `default` branch.
- Data schemas are strict: a new JSON field needs `src/data/types.ts` and `src/data/schema.ts` updated together.
- Stats always through `getUnitStats` / `getBuildingStats` (`src/sim/stats.ts`), never raw data.
- Occupancy and positions only through core helpers (`spawnEntity`, `removeEntity`, `occupyFootprint`, `releaseFootprint`, `setEntityPosition`).
- No user-facing text in code: locale keys in `src/locales/en.json` and `ru.json` with identical key sets. Russian only in `ru.json`. `src/ui/__tests__/noHardcodedText.test.ts` fails on text-like literals in `src/ui`, `src/main.ts`, `index.html` and on Cyrillic anywhere in `src`.
- Ids: snake_case, separate namespaces for units, buildings, technologies, civilizations. No display names in data.
- No original Age of Empires assets.
- Zero comments in code.

## Status

All subtasks are implemented; no stubs remain. Acceptance tests live in `tests/acceptance/`. `tests/acceptance/support/spec-appendices.md` holds the reference tables (buildings, units, technologies, civilization bonuses; Russian); `support/spec.ts` parses them and `appendices.test.ts` / `civilizations.test.ts` compare them with `src/data`, so the tables and the JSON change together. Keep the table format.
