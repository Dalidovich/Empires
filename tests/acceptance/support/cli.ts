import { execFile } from 'node:child_process';
import { availableParallelism, constants, setPriority } from 'node:os';
import { join } from 'node:path';
import type { SimResult } from '../../../tools/sim';

const TSX_CLI = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export interface CliRun {
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
  seconds: number;
}

function yieldProcessor(pid: number | undefined): void {
  if (pid === undefined) {
    return;
  }
  try {
    setPriority(pid, constants.priority.PRIORITY_LOW);
  } catch {
    return;
  }
}

export function runScript(script: string, args: readonly string[]): Promise<CliRun> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = execFile(
      process.execPath,
      [TSX_CLI, script, ...args],
      { cwd: process.cwd(), maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ args: [...args], code, stdout, stderr, seconds: (Date.now() - startedAt) / 1000 });
      },
    );
    yieldProcessor(child.pid);
  });
}

export function runSim(args: readonly string[]): Promise<CliRun> {
  return runScript('tools/sim.ts', args);
}

export function simResult(run: CliRun): SimResult {
  return JSON.parse(run.stdout) as SimResult;
}

export function poolSize(): number {
  return Math.max(2, Math.min(12, availableParallelism() - 2));
}

export async function runPool<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number = poolSize(),
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
