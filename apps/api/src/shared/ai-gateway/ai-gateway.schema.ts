const SCHEMA_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function isValidStructuredOutputSchemaName(name: string): boolean {
  return SCHEMA_NAME_RE.test(name);
}

export function parseJsonObject(raw: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: 'malformed' } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'malformed' };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'malformed' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export function validateJsonAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  depth = 0,
): { ok: true } | { ok: false; reason: string } {
  if (depth > 8) return { ok: false, reason: 'schema_too_deep' };
  const expectedType = schema.type;
  if (expectedType === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, reason: 'expected_object' };
    }
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : [];
    for (const key of required) {
      if (!(key in record)) return { ok: false, reason: `missing:${key}` };
    }
    const properties =
      schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
        ? (schema.properties as Record<string, Record<string, unknown>>)
        : {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) return { ok: false, reason: `unexpected:${key}` };
      }
    }
    for (const [key, nestedSchema] of Object.entries(properties)) {
      if (!(key in record)) continue;
      const nested = validateJsonAgainstSchema(record[key], nestedSchema, depth + 1);
      if (!nested.ok) return nested;
    }
    return { ok: true };
  }
  if (expectedType === 'array') {
    if (!Array.isArray(value)) return { ok: false, reason: 'expected_array' };
    const itemSchema =
      schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)
        ? (schema.items as Record<string, unknown>)
        : null;
    if (itemSchema) {
      for (const item of value) {
        const nested = validateJsonAgainstSchema(item, itemSchema, depth + 1);
        if (!nested.ok) return nested;
      }
    }
    return { ok: true };
  }
  if (expectedType === 'string') {
    return typeof value === 'string' ? { ok: true } : { ok: false, reason: 'expected_string' };
  }
  if (expectedType === 'number' || expectedType === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, reason: 'expected_number' };
    if (expectedType === 'integer' && !Number.isInteger(value)) return { ok: false, reason: 'expected_integer' };
    return { ok: true };
  }
  if (expectedType === 'boolean') {
    return typeof value === 'boolean' ? { ok: true } : { ok: false, reason: 'expected_boolean' };
  }
  if (expectedType === 'null') {
    return value === null ? { ok: true } : { ok: false, reason: 'expected_null' };
  }
  return { ok: true };
}
