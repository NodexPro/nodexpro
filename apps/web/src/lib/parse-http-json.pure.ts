/** HTTP JSON parsing for Core reads/commands. Empty 204 is success; malformed bodies stay errors. */

export function isEmptySuccessStatus(status: number): boolean {
  return status === 204 || status === 205;
}

export type ParsedHttpJson<T> =
  | { kind: 'json'; value: T }
  | { kind: 'empty_success' }
  | { kind: 'abort' }
  | { kind: 'invalid_json' }
  | { kind: 'empty_error' };

export function parseHttpJsonText<T>(input: {
  ok: boolean;
  status: number;
  text: string;
  aborted?: boolean;
}): ParsedHttpJson<T> {
  if (input.aborted) return { kind: 'abort' };
  const text = String(input.text ?? '');
  const trimmed = text.trim();
  if (input.ok) {
    if (isEmptySuccessStatus(input.status)) return { kind: 'empty_success' };
    if (!trimmed) return { kind: 'invalid_json' };
    try {
      return { kind: 'json', value: JSON.parse(trimmed) as T };
    } catch {
      return { kind: 'invalid_json' };
    }
  }
  if (!trimmed) return { kind: 'empty_error' };
  try {
    return { kind: 'json', value: JSON.parse(trimmed) as T };
  } catch {
    return { kind: 'invalid_json' };
  }
}

export function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}
