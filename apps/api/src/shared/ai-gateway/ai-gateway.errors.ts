import { AppError } from '../errors.js';
import type { AiGatewayOutcome, AiGatewayTelemetry } from './ai-gateway.types.js';

export const AI_ERROR_CODES = {
  AI_NOT_CONFIGURED: 'AI_NOT_CONFIGURED',
  AI_PROVIDER_UNAVAILABLE: 'AI_PROVIDER_UNAVAILABLE',
  AI_TIMEOUT: 'AI_TIMEOUT',
  AI_RATE_LIMITED: 'AI_RATE_LIMITED',
  AI_MALFORMED_OUTPUT: 'AI_MALFORMED_OUTPUT',
  AI_STRUCTURED_OUTPUT_INVALID: 'AI_STRUCTURED_OUTPUT_INVALID',
  AI_ENDPOINT_BLOCKED: 'AI_ENDPOINT_BLOCKED',
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

const CODE_TO_OUTCOME: Record<AiErrorCode, Exclude<AiGatewayOutcome, 'success'>> = {
  AI_NOT_CONFIGURED: 'not_configured',
  AI_PROVIDER_UNAVAILABLE: 'provider_unavailable',
  AI_TIMEOUT: 'timeout',
  AI_RATE_LIMITED: 'rate_limited',
  AI_MALFORMED_OUTPUT: 'malformed_output',
  AI_STRUCTURED_OUTPUT_INVALID: 'structured_output_invalid',
  AI_ENDPOINT_BLOCKED: 'provider_unavailable',
};

const CODE_TO_STATUS: Record<AiErrorCode, number> = {
  AI_NOT_CONFIGURED: 503,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_TIMEOUT: 504,
  AI_RATE_LIMITED: 429,
  AI_MALFORMED_OUTPUT: 502,
  AI_STRUCTURED_OUTPUT_INVALID: 502,
  AI_ENDPOINT_BLOCKED: 400,
};

const SAFE_MESSAGES: Record<AiErrorCode, string> = {
  AI_NOT_CONFIGURED: 'AI is not configured.',
  AI_PROVIDER_UNAVAILABLE: 'AI provider is unavailable.',
  AI_TIMEOUT: 'AI provider timed out.',
  AI_RATE_LIMITED: 'AI provider rate limited the request.',
  AI_MALFORMED_OUTPUT: 'AI returned malformed structured output.',
  AI_STRUCTURED_OUTPUT_INVALID: 'AI structured output did not match the requested schema.',
  AI_ENDPOINT_BLOCKED: 'Endpoint is not allowed.',
};

export class AiGatewayError extends AppError {
  readonly outcome: Exclude<AiGatewayOutcome, 'success'>;

  constructor(code: AiErrorCode, message?: string, details?: Record<string, unknown>) {
    super(CODE_TO_STATUS[code], message ?? SAFE_MESSAGES[code], code, sanitizeErrorDetails(details));
    this.name = 'AiGatewayError';
    this.outcome = CODE_TO_OUTCOME[code];
  }
}

export function outcomeForAiErrorCode(code: AiErrorCode): Exclude<AiGatewayOutcome, 'success'> {
  return CODE_TO_OUTCOME[code];
}

export function aiGatewayError(
  code: AiErrorCode,
  options?: { message?: string; telemetry?: AiGatewayTelemetry; details?: Record<string, unknown> },
): AiGatewayError {
  const details: Record<string, unknown> = {
    outcome: CODE_TO_OUTCOME[code],
    ...(options?.details ?? {}),
  };
  if (options?.telemetry) {
    details.attempt_count = options.telemetry.attempt_count;
  }
  return new AiGatewayError(code, options?.message, details);
}

function sanitizeErrorDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of ['outcome', 'attempt_count']) {
    if (details[key] !== undefined) out[key] = details[key];
  }
  return out;
}
