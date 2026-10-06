import type { SaveMeta, StorageErrorCode, StorageResult } from './api';

export function ok<T>(value: T): StorageResult<T> {
  return { ok: true, value };
}

export function fail<T>(error: StorageErrorCode): StorageResult<T> {
  return { ok: false, error };
}

export function toMeta(record: SaveMeta): SaveMeta {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    formatVersion: record.formatVersion,
    gameVersion: record.gameVersion,
    summary: { ...record.summary },
  };
}

export function toErrorCode(error: unknown): StorageErrorCode {
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  return name === 'QuotaExceededError' ? 'quota_exceeded' : 'unknown';
}
