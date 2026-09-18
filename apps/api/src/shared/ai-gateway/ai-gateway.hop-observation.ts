/**
 * TAX-642C — safe per-hop failure observability for completeStructuredJson.
 * Closed allowlist only. Never logs keys, Authorization, prompts, completions,
 * legal/source text, or provider response bodies.
 */

import { AI_ADAPTER_TYPE_OPENAI_COMPATIBLE } from './ai-gateway.adapters.js';
import { extractSafeProviderErrorCode } from './ai-gateway.provider-error.js';
import { assertSafeTelemetryPayload, looksLikeSecret } from './ai-gateway.redaction.js';
import { isAbortError } from './providers/ai-provider.types.js';
import type { AiGatewayFailureCategory } from './ai-gateway.types.js';
import { AiGatewayError } from './ai-gateway.errors.js';

export const AI_GATEWAY_HOP_FAILED_EVENT = 'provider_hop_failed' as const;

export type AiGatewayTransportErrorCategory =
  | 'dns'
  | 'tls'
  | 'timeout'
  | 'aborted'
  | 'network'
  | 'invalid_address'
  | 'unknown';

const PURPOSE_RE = /^[a-z][a-z0-9_]{1,79}$/;
const CORRELATION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const SAFE_CODE_RE = /^[A-Z][A-Z0-9_.]{0,63}$/;
const HOST_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const PATH_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]{0,127}$/;
const PROVIDER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ADAPTER_RE = /^[a-z][a-z0-9_]{0,63}$/;
const PROVIDER_RE = /^[a-z][a-z0-9_]{0,31}$/;

const TRANSPORT_CODE_CATEGORY: Record<string, AiGatewayTransportErrorCategory> = {
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
  ECONNRESET: 'network',
  ECONNREFUSED: 'network',
  ETIMEDOUT: 'timeout',
  EPIPE: 'network',
  EHOSTUNREACH: 'network',
  ENETUNREACH: 'network',
  ECONNABORTED: 'network',
  ABORT_ERR: 'aborted',
  ERR_INVALID_IP_ADDRESS: 'invalid_address',
  ERR_SOCKET_CLOSED: 'network',
  CERT_HAS_EXPIRED: 'tls',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls',
  ERR_TLS_CERT_ALTNAME_INVALID: 'tls',
  UND_ERR_CONNECT_TIMEOUT: 'timeout',
  UND_ERR_SOCKET: 'network',
  UND_ERR_HEADERS_TIMEOUT: 'timeout',
  UND_ERR_BODY_TIMEOUT: 'timeout',
};

const HOP_PAYLOAD_KEYS = [
  'event',
  'purpose',
  'correlation_id',
  'provider_id',
  'adapter_type',
  'provider',
  'model',
  'endpoint_host',
  'endpoint_path',
  'attempt',
  'latency_ms',
  'http_status',
  'provider_error_code',
  'transport_error_name',
  'transport_error_code',
  'transport_error_category',
  'failure_category',
] as const;

function asSafeToken(value: unknown, re: RegExp): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || !re.test(trimmed) || looksLikeSecret(trimmed)) return null;
  return trimmed;
}

export function safeAiGatewayCorrelationId(value: unknown): string | null {
  return asSafeToken(value, CORRELATION_RE);
}

export function safeAiGatewayEndpoint(url: string | null | undefined): {
  host: string | null;
  path: string | null;
} {
  if (typeof url !== 'string' || !url.trim()) return { host: null, path: null };
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return { host: null, path: null };
    const host = asSafeToken(parsed.hostname, HOST_RE);
    const rawPath = parsed.pathname || '/';
    const path = PATH_RE.test(rawPath) ? rawPath : null;
    return { host, path };
  } catch {
    return { host: null, path: null };
  }
}

export function classifyAiGatewayTransportError(error: unknown): {
  name: string | null;
  code: string | null;
  category: AiGatewayTransportErrorCategory;
} {
  if (isAbortError(error)) {
    const codeRaw = error && typeof error === 'object' ? (error as { code?: unknown }).code : null;
    const code = asSafeToken(codeRaw, SAFE_CODE_RE) ?? 'ABORT_ERR';
    return { name: 'AbortError', code, category: 'aborted' };
  }
  const nameRaw = error && typeof error === 'object' ? (error as { name?: unknown }).name : null;
  const codeRaw = error && typeof error === 'object' ? (error as { code?: unknown }).code : null;
  const name = asSafeToken(nameRaw, SAFE_NAME_RE);
  const code = asSafeToken(codeRaw, SAFE_CODE_RE);
  if (name === 'TimeoutError') return { name, code, category: 'timeout' };
  if (name === 'AbortError') return { name, code: code ?? 'ABORT_ERR', category: 'aborted' };
  if (code && TRANSPORT_CODE_CATEGORY[code]) {
    return { name, code, category: TRANSPORT_CODE_CATEGORY[code] };
  }
  return { name, code, category: 'unknown' };
}

export type FailedProviderHopObservationInput = {
  purpose: string;
  correlationId?: string | null;
  providerId?: string | null;
  adapterType?: string | null;
  provider?: string | null;
  model?: string | null;
  endpointUrl?: string | null;
  attempt: number;
  latencyMs: number;
  httpStatus?: number | null;
  providerBodyText?: string | null;
  transportError?: unknown;
  failureCategory: AiGatewayFailureCategory | null;
};

export type FailedProviderHopObservation = {
  event: typeof AI_GATEWAY_HOP_FAILED_EVENT;
  purpose: string | null;
  correlation_id: string | null;
  provider_id: string | null;
  adapter_type: string | null;
  provider: string | null;
  model: string | null;
  endpoint_host: string | null;
  endpoint_path: string | null;
  attempt: number;
  latency_ms: number;
  http_status: number | null;
  provider_error_code: string | null;
  transport_error_name: string | null;
  transport_error_code: string | null;
  transport_error_category: AiGatewayTransportErrorCategory | null;
  failure_category: AiGatewayFailureCategory | null;
};

function safeHttpStatus(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 599) return null;
  return value;
}

function safeAttempt(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), 99);
}

function safeLatencyMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), 600_000);
}

export function buildFailedProviderHopObservation(
  input: FailedProviderHopObservationInput,
): FailedProviderHopObservation {
  const httpStatus = safeHttpStatus(input.httpStatus);
  const endpoint = safeAiGatewayEndpoint(input.endpointUrl);
  const transport =
    httpStatus == null && input.transportError != null
      ? classifyAiGatewayTransportError(input.transportError)
      : { name: null, code: null, category: null as AiGatewayTransportErrorCategory | null };
  if (httpStatus == null && input.transportError instanceof AiGatewayError) {
    transport.name = 'AiGatewayError';
    transport.code = asSafeToken(input.transportError.code, SAFE_CODE_RE);
    if (input.transportError.code === 'AI_TIMEOUT') transport.category = 'timeout';
    else if (input.transportError.code === 'AI_ENDPOINT_BLOCKED') transport.category = 'invalid_address';
    else transport.category = 'unknown';
  }

  const payload: FailedProviderHopObservation = {
    event: AI_GATEWAY_HOP_FAILED_EVENT,
    purpose: asSafeToken(input.purpose, PURPOSE_RE),
    correlation_id: safeAiGatewayCorrelationId(input.correlationId),
    provider_id: asSafeToken(input.providerId, PROVIDER_ID_RE),
    adapter_type:
      asSafeToken(input.adapterType, ADAPTER_RE) ?? AI_ADAPTER_TYPE_OPENAI_COMPATIBLE,
    provider: asSafeToken(input.provider, PROVIDER_RE),
    model: asSafeToken(input.model, MODEL_RE),
    endpoint_host: endpoint.host,
    endpoint_path: endpoint.path,
    attempt: safeAttempt(input.attempt),
    latency_ms: safeLatencyMs(input.latencyMs),
    http_status: httpStatus,
    provider_error_code:
      httpStatus != null && input.providerBodyText
        ? extractSafeProviderErrorCode(input.providerBodyText)
        : null,
    transport_error_name: httpStatus == null ? transport.name : null,
    transport_error_code: httpStatus == null ? transport.code : null,
    transport_error_category: httpStatus == null ? transport.category : null,
    failure_category: input.failureCategory,
  };
  assertSafeTelemetryPayload({ ...payload });
  return payload;
}

export function logFailedProviderHopObservation(
  input: FailedProviderHopObservationInput,
  write: (event: string, payload: Record<string, unknown>) => void,
): Record<string, unknown> {
  try {
    const payload = buildFailedProviderHopObservation(input);
    write('[ai-gateway]', { ...payload });
    return payload;
  } catch {
    const fallback: Record<string, unknown> = {
      event: AI_GATEWAY_HOP_FAILED_EVENT,
      purpose: asSafeToken(input.purpose, PURPOSE_RE),
      correlation_id: safeAiGatewayCorrelationId(input.correlationId),
      http_status: safeHttpStatus(input.httpStatus),
      failure_category: input.failureCategory,
      telemetry_omitted: true,
    };
    for (const key of Object.keys(fallback)) {
      if (!HOP_PAYLOAD_KEYS.includes(key as (typeof HOP_PAYLOAD_KEYS)[number]) && key !== 'telemetry_omitted') {
        delete fallback[key];
      }
    }
    write('[ai-gateway]', fallback);
    return fallback;
  }
}
