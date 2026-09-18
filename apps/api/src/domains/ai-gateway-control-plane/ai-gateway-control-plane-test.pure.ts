import { AppError } from '../../shared/errors.js';
import { AI_ERROR_CODES, AiGatewayError } from '../../shared/ai-gateway/ai-gateway.errors.js';
import {
  extractSafeProviderErrorHint,
  isAuthProviderErrorCode,
  isModelProviderErrorCode,
} from '../../shared/ai-gateway/ai-gateway.provider-error.js';
import { assertSafeTelemetryPayload } from '../../shared/ai-gateway/ai-gateway.redaction.js';
import type { AiGatewayCompleteStructuredJsonInput } from '../../shared/ai-gateway/ai-gateway.types.js';

export const AI_PROVIDER_TEST_TIMEOUT_MS = 15_000;
export const AI_PROVIDER_TEST_MAX_ATTEMPTS = 1;
export const AI_PROVIDER_TEST_MIN_INTERVAL_MS = 20_000;

export const AI_PROVIDER_CONNECTION_TEST_PURPOSE = 'owner_ai_provider_connection_test';

export const AI_PROVIDER_CONNECTION_TEST_MESSAGES: AiGatewayCompleteStructuredJsonInput['messages'] = [
  {
    role: 'system',
    content: 'Return only the JSON object required by the schema. Do not include any other text.',
  },
  {
    role: 'user',
    content: 'Reply with status ok.',
  },
];

export const AI_PROVIDER_CONNECTION_TEST_SCHEMA: AiGatewayCompleteStructuredJsonInput['outputSchema'] = {
  name: 'ai_provider_connection_test_v1',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['ok'] },
    },
  },
};

export function buildAiProviderConnectionTestRequest(): AiGatewayCompleteStructuredJsonInput {
  return {
    purpose: AI_PROVIDER_CONNECTION_TEST_PURPOSE,
    messages: AI_PROVIDER_CONNECTION_TEST_MESSAGES,
    outputSchema: AI_PROVIDER_CONNECTION_TEST_SCHEMA,
    timeoutMs: AI_PROVIDER_TEST_TIMEOUT_MS,
    promptContractVersion: 'ai_provider_connection_test_v1',
    outputContract: 'ai_provider_connection_test_v1',
    outputSchemaVersion: 1,
    includesUntrustedSourceText: false,
  };
}

export function connectionTestContainsForbiddenData(request: AiGatewayCompleteStructuredJsonInput): boolean {
  const blob = JSON.stringify(request).toLowerCase();
  return /tax|ordinance|legal_text|client_id|tenant|proposal|פקודה/.test(blob);
}

export type StoredAiProviderFailureCategory =
  | 'not_configured'
  | 'provider_unavailable'
  | 'model_unavailable'
  | 'timeout'
  | 'rate_limited'
  | 'malformed_output'
  | 'structured_output_invalid'
  | 'auth_rejected'
  | 'incompatible'
  | 'endpoint_blocked';

const lastAttemptAt = new Map<string, number>();

export function noteAiProviderConnectionTestAttempt(providerId: string, nowMs: number): void {
  lastAttemptAt.set(providerId, nowMs);
}

export function resetAiProviderConnectionTestThrottleForTests(): void {
  lastAttemptAt.clear();
}

export function aiProviderConnectionTestThrottle(
  providerId: string,
  lastTestAt: string | null,
  nowMs: number,
): { throttled: true; retry_after_ms: number } | { throttled: false } {
  const candidates = [lastAttemptAt.get(providerId) ?? 0];
  if (lastTestAt) {
    const parsed = Date.parse(lastTestAt);
    if (Number.isFinite(parsed)) candidates.push(parsed);
  }
  const last = Math.max(...candidates);
  if (!last) return { throttled: false };
  const elapsed = nowMs - last;
  if (elapsed >= AI_PROVIDER_TEST_MIN_INTERVAL_MS) return { throttled: false };
  return { throttled: true, retry_after_ms: AI_PROVIDER_TEST_MIN_INTERVAL_MS - elapsed };
}

export function buildConnectionTestSuccessPatch(nowIso: string, digest: string): Record<string, unknown> {
  return {
    structured_output_certified: true,
    compatibility_status: 'compatible',
    last_test_outcome: 'passed',
    last_test_at: nowIso,
    last_success_at: nowIso,
    last_test_configuration_digest: digest,
    last_failure_category: null,
  };
}

export function buildConnectionTestFailurePatch(input: {
  enabled: boolean;
  nowIso: string;
  category: StoredAiProviderFailureCategory;
  structuredOutputFailed: boolean;
}): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    last_test_at: input.nowIso,
    last_failure_at: input.nowIso,
    last_failure_category: input.category,
  };
  if (input.enabled) return snapshot;
  snapshot.last_test_outcome = 'failed';
  snapshot.structured_output_certified = false;
  if (input.structuredOutputFailed) snapshot.compatibility_status = 'incompatible';
  return snapshot;
}

export function successPatchTouchesEnablementOrRouting(patch: Record<string, unknown>): boolean {
  return 'enabled' in patch || 'routing' in patch || 'provider_ids' in patch;
}

export function classifyConnectionTestFailure(input: {
  error: unknown;
  lastStatus: number | null;
  providerErrorCode?: string | null;
  providerErrorParam?: string | null;
}): { category: StoredAiProviderFailureCategory; structuredOutputFailed: boolean } {
  const status = input.lastStatus;
  const code = input.providerErrorCode ?? null;
  const param = input.providerErrorParam ?? null;
  if (status === 401 || status === 403 || isAuthProviderErrorCode(code)) {
    return { category: 'auth_rejected', structuredOutputFailed: false };
  }
  if (status === 429) {
    return { category: 'rate_limited', structuredOutputFailed: false };
  }
  if (status === 404 || isModelProviderErrorCode(code, param)) {
    return { category: 'model_unavailable', structuredOutputFailed: false };
  }
  if (status != null && status >= 500 && status <= 599) {
    return { category: 'provider_unavailable', structuredOutputFailed: false };
  }
  if (input.error instanceof AiGatewayError) {
    if (input.error.code === AI_ERROR_CODES.AI_ENDPOINT_BLOCKED) {
      return { category: 'endpoint_blocked', structuredOutputFailed: false };
    }
    if (input.error.code === AI_ERROR_CODES.AI_TIMEOUT) {
      return { category: 'timeout', structuredOutputFailed: false };
    }
    if (input.error.code === AI_ERROR_CODES.AI_RATE_LIMITED) {
      return { category: 'rate_limited', structuredOutputFailed: false };
    }
    if (input.error.code === AI_ERROR_CODES.AI_STRUCTURED_OUTPUT_INVALID) {
      return { category: 'structured_output_invalid', structuredOutputFailed: true };
    }
    if (input.error.code === AI_ERROR_CODES.AI_MALFORMED_OUTPUT) {
      return { category: 'malformed_output', structuredOutputFailed: true };
    }
    if (input.error.code === AI_ERROR_CODES.AI_NOT_CONFIGURED) {
      return { category: 'not_configured', structuredOutputFailed: false };
    }
    return { category: 'provider_unavailable', structuredOutputFailed: false };
  }
  if (input.error instanceof AppError && input.error.code === 'AI_ENDPOINT_BLOCKED') {
    return { category: 'endpoint_blocked', structuredOutputFailed: false };
  }
  return { category: 'provider_unavailable', structuredOutputFailed: false };
}

export type ConnectionTestObservation = {
  correlation_id: string | null;
  http_status: number | null;
  provider_error_code: string | null;
  failure_category: StoredAiProviderFailureCategory | null;
  outcome: 'passed' | 'failed';
  latency_ms: number;
  provider: string | null;
  model: string | null;
  endpoint: 'POST /chat/completions';
};

export function buildConnectionTestObservation(input: ConnectionTestObservation): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    purpose: AI_PROVIDER_CONNECTION_TEST_PURPOSE,
    correlation_id: input.correlation_id,
    http_status: input.http_status,
    provider_error_code: input.provider_error_code,
    failure_category: input.failure_category,
    outcome: input.outcome,
    latency_ms: input.latency_ms,
    provider: input.provider,
    model: input.model,
    endpoint: input.endpoint,
  };
  assertSafeTelemetryPayload(payload);
  return payload;
}

export function logConnectionTestObservation(
  input: ConnectionTestObservation,
  write: (event: string, payload: Record<string, unknown>) => void = (event, payload) => {
    console.info(event, payload);
  },
): Record<string, unknown> {
  try {
    const payload = buildConnectionTestObservation(input);
    write('[ai-gateway]', payload);
    return payload;
  } catch {
    const fallback = {
      purpose: AI_PROVIDER_CONNECTION_TEST_PURPOSE,
      correlation_id: input.correlation_id,
      http_status: typeof input.http_status === 'number' ? input.http_status : null,
      provider_error_code: null,
      failure_category: input.failure_category,
      outcome: input.outcome,
      telemetry_omitted: true,
    };
    write('[ai-gateway]', fallback);
    return fallback;
  }
}

export function safeProviderHintFromBody(bodyText: string | null | undefined): {
  code: string | null;
  param: string | null;
} {
  if (!bodyText) return { code: null, param: null };
  return extractSafeProviderErrorHint(bodyText);
}

export function isSuccessfulConnectionTestJson(json: Record<string, unknown>): boolean {
  return json.status === 'ok';
}
