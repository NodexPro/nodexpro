import type {
  AiGatewayCircuitTelemetryState,
  AiGatewayCompleteStructuredJsonInput,
  AiGatewayFailureCategory,
  AiGatewayOutcome,
  AiGatewayRoutingSource,
  AiGatewayTelemetry,
} from './ai-gateway.types.js';
import { assertSafeTelemetryPayload } from './ai-gateway.redaction.js';
import { AI_ERROR_CODES, type AiErrorCode } from './ai-gateway.errors.js';
import { safeAiGatewayCorrelationId } from './ai-gateway.hop-observation.js';

export function failureCategoryForAiErrorCode(code: AiErrorCode | null | undefined): AiGatewayFailureCategory | null {
  switch (code) {
    case AI_ERROR_CODES.AI_TIMEOUT:
      return 'timeout';
    case AI_ERROR_CODES.AI_RATE_LIMITED:
      return 'rate_limited';
    case AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE:
      return 'provider_unavailable';
    case AI_ERROR_CODES.AI_MALFORMED_OUTPUT:
      return 'malformed_output';
    case AI_ERROR_CODES.AI_STRUCTURED_OUTPUT_INVALID:
      return 'structured_output_invalid';
    case AI_ERROR_CODES.AI_ENDPOINT_BLOCKED:
      return 'endpoint_blocked';
    case AI_ERROR_CODES.AI_NOT_CONFIGURED:
      return 'not_configured';
    default:
      return null;
  }
}

export function buildAiGatewayTelemetry(input: {
  request: AiGatewayCompleteStructuredJsonInput;
  provider: string | null;
  model: string | null;
  latencyMs: number;
  outcome: AiGatewayOutcome;
  attemptCount: number;
  providerId?: string | null;
  routingPosition?: number | null;
  routingSource?: AiGatewayRoutingSource | null;
  providersAttempted?: number;
  failoverOccurred?: boolean;
  failureCategory?: AiGatewayFailureCategory | null;
  circuitState?: AiGatewayCircuitTelemetryState | null;
}): AiGatewayTelemetry {
  const telemetry: AiGatewayTelemetry = {
    purpose: input.request.purpose,
    correlation_id: safeAiGatewayCorrelationId(input.request.correlationId),
    provider: input.provider,
    model: input.model,
    provider_id: input.providerId ?? null,
    routing_position: input.routingPosition ?? null,
    routing_source: input.routingSource ?? null,
    prompt_contract_version: input.request.promptContractVersion ?? null,
    output_contract: input.request.outputContract ?? null,
    output_schema_version:
      typeof input.request.outputSchemaVersion === 'number' ? input.request.outputSchemaVersion : null,
    latency_ms: input.latencyMs,
    outcome: input.outcome,
    attempt_count: input.attemptCount,
    providers_attempted: input.providersAttempted ?? 0,
    failover_occurred: input.failoverOccurred === true,
    failure_category: input.failureCategory ?? null,
    circuit_state: input.circuitState ?? null,
    untrusted_source_text: input.request.includesUntrustedSourceText === true,
  };
  assertSafeTelemetryPayload({ ...telemetry });
  return telemetry;
}

export function logAiGatewayTelemetry(
  telemetry: AiGatewayTelemetry,
  write: (event: string, payload: Record<string, unknown>) => void,
): void {
  assertSafeTelemetryPayload({ ...telemetry });
  write('[ai-gateway]', { ...telemetry });
}
