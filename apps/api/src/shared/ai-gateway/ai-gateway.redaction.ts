const SECRET_STRING_RE =
  /sk-[a-zA-Z0-9_-]{8,}|Bearer\s+\S+|api[_-]?key\s*[:=]\s*\S+/gi;

const SECRET_KEY_RE =
  /^(api[_-]?key|authorization|bearer|secret|token|password|openai_api_key|tax_knowledge_ai_api_key)$/i;

const FORBIDDEN_TELEMETRY_KEYS = new Set([
  'prompt',
  'raw_prompt',
  'completion',
  'raw_completion',
  'messages',
  'content',
  'body',
  'bodyText',
  'headers',
  'apiKey',
  'api_key',
  'json',
  'legal_text',
  'draft_legal_text',
  'source_text',
]);

export function redactSecretsFromString(value: string): string {
  return value.replace(SECRET_STRING_RE, '[REDACTED]');
}

export function redactSecretsDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (typeof value === 'string') return redactSecretsFromString(value);
  if (Array.isArray(value)) return value.map((item) => redactSecretsDeep(item, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key) || FORBIDDEN_TELEMETRY_KEYS.has(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      out[key] = redactSecretsDeep(nested, depth + 1);
    }
    return out;
  }
  return value;
}

export function assertSafeTelemetryPayload(payload: Record<string, unknown>): void {
  const encoded = JSON.stringify(payload);
  for (const key of FORBIDDEN_TELEMETRY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      throw new Error(`ai_gateway_telemetry_forbidden_key:${key}`);
    }
  }
  SECRET_STRING_RE.lastIndex = 0;
  if (SECRET_STRING_RE.test(encoded)) {
    throw new Error('ai_gateway_telemetry_contains_secret');
  }
}

export function looksLikeSecret(value: string): boolean {
  SECRET_STRING_RE.lastIndex = 0;
  return SECRET_STRING_RE.test(value);
}
