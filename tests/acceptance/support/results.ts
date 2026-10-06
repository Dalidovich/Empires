import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RESULTS_DIRECTORY = join(process.cwd(), 'tests', 'acceptance', 'results');

export function writeResult(name: string, value: unknown): void {
  mkdirSync(RESULTS_DIRECTORY, { recursive: true });
  writeFileSync(join(RESULTS_DIRECTORY, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`);
}
