import { createHash } from 'node:crypto';
import { badRequest } from '../../shared/errors.js';

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertJsonSafe(value: unknown, path: string): void {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw badRequest(`payload_json${path} must be a finite number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }
  if (isPlainJsonObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) {
        throw badRequest(`payload_json${path}.${key} cannot be undefined`);
      }
      assertJsonSafe(child, `${path}.${key}`);
    }
    return;
  }
  throw badRequest(`payload_json${path} must be JSON-safe`);
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

export function parseTaxRulePayloadJson(value: unknown): Record<string, unknown> {
  if (!isPlainJsonObject(value)) {
    throw badRequest('payload_json must be a JSON object');
  }
  assertJsonSafe(value, '');
  return value;
}

/** Deterministic JSON for SHA-256: recursively sorted object keys, array order preserved. */
export function canonicalizeTaxRulePayload(payload: Record<string, unknown>): string {
  const parsed = parseTaxRulePayloadJson(payload);
  return JSON.stringify(sortKeys(parsed));
}

export function taxRulePayloadChecksum(payload: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalizeTaxRulePayload(payload), 'utf8').digest('hex');
}
