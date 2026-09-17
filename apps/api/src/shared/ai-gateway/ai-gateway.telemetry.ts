import type {
  AiGatewayCompleteStructuredJsonInput,
  AiGatewayOutcome,
  AiGatewayTelemetry,
} from './ai-gateway.types.js';
import { assertSafeTelemetryPayload } from './ai-gateway.redaction.js';

export function buildAiGatewayTelemetry(input: {
  request: AiGatewayCompleteStructuredJsonInput;
  provider: string | null;
  model: string | null;
  latencyMs: number;
  outcome: AiGatewayOutcome;
  attemptCount: number;
}): AiGatewayTelemetry {
  const telemetry: AiGatewayTelemetry = {
    purpose: input.request.purpose,
    provider: input.provider,
    model: input.model,
    prompt_contract_version: input.request.promptContractVersion ?? null,
    output_contract: input.request.outputContract ?? null,
    output_schema_version:
      typeof input.request.outputSchemaVersion === 'number' ? input.request.outputSchemaVersion : null,
    latency_ms: input.latencyMs,
    outcome: input.outcome,
    attempt_count: input.attemptCount,
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
