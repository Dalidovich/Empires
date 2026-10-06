import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { SaveRecord, StorageResult } from './api';
import { fail, ok } from './result';
import { parseSaveRecord } from './validation';

const SAVE_FILE_TYPE = 'application/octet-stream';

export function compressJson(value: unknown): Uint8Array<ArrayBuffer> {
  const bytes = gzipSync(strToU8(JSON.stringify(value)));
  return new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

export function decompressJson(bytes: Uint8Array): unknown {
  return JSON.parse(strFromU8(gunzipSync(bytes)));
}

export async function exportSaveFile(record: SaveRecord): Promise<StorageResult<Blob>> {
  try {
    return ok(new Blob([compressJson(record)], { type: SAVE_FILE_TYPE }));
  } catch {
    return fail('unknown');
  }
}

export async function importSaveFile(file: Blob): Promise<StorageResult<SaveRecord>> {
  let content: unknown;
  try {
    content = decompressJson(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return fail('corrupt');
  }
  return parseSaveRecord(content);
}
