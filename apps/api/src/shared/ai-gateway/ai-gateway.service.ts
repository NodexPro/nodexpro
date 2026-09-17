import {
  AI_GATEWAY_MAX_ATTEMPTS,
  AI_GATEWAY_RETRY_AFTER_CAP_MS,
  AI_GATEWAY_RETRY_BACKOFF_MS,
  type AiGatewayCompleteStructuredJsonInput,
  type AiGatewayCompleteStructuredJsonResult,
  type AiGatewayTelemetry,
} from './ai-gateway.types.js';
import { AI_ERROR_CODES, AiGatewayError, aiGatewayError, type AiErrorCode } from './ai-gateway.errors.js';
import { resolveAiGatewayInvocationConfig, type AiGatewayEnv } from './ai-gateway.config.js';
import { looksLikeSecret } from './ai-gateway.redaction.js';
import { isValidStructuredOutputSchemaName, parseJsonObject, validateJsonAgainstSchema } from './ai-gateway.schema.js';
import { buildAiGatewayTelemetry, logAiGatewayTelemetry } from './ai-gateway.telemetry.js';
import {
  AI_RETRYABLE_STATUS_CODES,
  fetchAiProviderTransport,
  isAbortError,
  type AiProviderTransport,
} from './providers/ai-provider.types.js';
import {
  buildOpenAiCompatibleStructuredRequest,
  extractOpenAiCompatibleMessageContent,
} from './providers/openai-compatible.provider.js';

export type AiGatewayDeps = {
  env?: AiGatewayEnv;
  transport?: AiProviderTransport;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, payload: Record<string, unknown>) => void;
};

const PURPOSE_RE = /^[a-z][a-z0-9_]{1,79}$/;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function validateRequest(input: AiGatewayCompleteStructuredJsonInput): void {
  if (typeof input.purpose !== 'string' || !PURPOSE_RE.test(input.purpose)) {
    throw aiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED, {
      message: 'AI purpose is invalid.',
    });
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw aiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED, {
      message: 'AI request is invalid.',
    });
  }
  for (const message of input.messages) {
    if (!message || (message.role !== 'system' && message.role !== 'user')) {
      throw aiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED, {
        message: 'AI request is invalid.',
      });
    }
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw aiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED, {
        message: 'AI request is invalid.',
      });
    }
  }
  if (!input.outputSchema || !isValidStructuredOutputSchemaName(input.outputSchema.name)) {
    throw aiGatewayError(AI_ERROR_CODES.AI_STRUCTURED_OUTPUT_INVALID, {
      message: 'AI structured output schema is invalid.',
    });
  }
  if (!input.outputSchema.schema || typeof input.outputSchema.schema !== 'object') {
    throw aiGatewayError(AI_ERROR_CODES.AI_STRUCTURED_OUTPUT_INVALID, {
      message: 'AI structured output schema is invalid.',
    });
  }
}

function fail(
  code: AiErrorCode,
  telemetry: AiGatewayTelemetry,
  log: AiGatewayDeps['log'],
): never {
  logAiGatewayTelemetry(telemetry, log ?? ((_event, payload) => console.info('[ai-gateway]', payload)));
  throw aiGatewayError(code, { telemetry });
}

export function createAiGateway(deps: AiGatewayDeps = {}) {
  const transport = deps.transport ?? fetchAiProviderTransport;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? ((event, payload) => console.info(event, payload));

  async function completeStructuredJson(
    input: AiGatewayCompleteStructuredJsonInput,
  ): Promise<AiGatewayCompleteStructuredJsonResult> {
    const started = now();
    validateRequest(input);

    let config;
    try {
      config = resolveAiGatewayInvocationConfig(deps.env);
    } catch (error) {
      const telemetry = buildAiGatewayTelemetry({
        request: input,
        provider: null,
        model: null,
        latencyMs: now() - started,
        outcome: 'not_configured',
        attemptCount: 0,
      });
      logAiGatewayTelemetry(telemetry, log);
      throw error;
    }

    const timeoutMs = input.timeoutMs ?? config.timeoutMs;
    let attempt = 0;
    let lastRetryable: 'rate_limited' | 'provider_unavailable' | null = null;

    while (attempt < AI_GATEWAY_MAX_ATTEMPTS) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const providerRequest = buildOpenAiCompatibleStructuredRequest({
          config,
          request: input,
          timeoutMs,
          signal: controller.signal,
        });
        const response = await transport(providerRequest);
        if (response.status === 429 || AI_RETRYABLE_STATUS_CODES.has(response.status)) {
          lastRetryable = response.status === 429 ? 'rate_limited' : 'provider_unavailable';
          if (attempt < AI_GATEWAY_MAX_ATTEMPTS) {
            const waitMs = Math.min(
              response.retryAfterMs ?? AI_GATEWAY_RETRY_BACKOFF_MS,
              AI_GATEWAY_RETRY_AFTER_CAP_MS,
            );
            await sleep(waitMs);
            continue;
          }
          const outcome = lastRetryable;
          const telemetry = buildAiGatewayTelemetry({
            request: input,
            provider: config.provider,
            model: config.model,
            latencyMs: now() - started,
            outcome,
            attemptCount: attempt,
          });
          fail(outcome === 'rate_limited' ? AI_ERROR_CODES.AI_RATE_LIMITED : AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE, telemetry, log);
        }
        if (response.status === 401 || response.status === 403) {
          const telemetry = buildAiGatewayTelemetry({
            request: input,
            provider: config.provider,
            model: config.model,
            latencyMs: now() - started,
            outcome: 'provider_unavailable',
            attemptCount: attempt,
          });
          fail(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE, telemetry, log);
        }
        if (response.status < 200 || response.status >= 300) {
          const telemetry = buildAiGatewayTelemetry({
            request: input,
            provider: config.provider,
            model: config.model,
            latencyMs: now() - started,
            outcome: 'provider_unavailable',
            attemptCount: attempt,
          });
          fail(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE, telemetry, log);
        }

        const content = extractOpenAiCompatibleMessageContent(response.bodyText);
        if (content == null || looksLikeSecret(content)) {
          const telemetry = buildAiGatewayTelemetry({
            request: input,
            provider: config.provider,
            model: config.model,
            latencyMs: now() - started,
            outcome: 'malformed_output',
            attemptCount: attempt,
          });
          fail(AI_ERROR_CODES.AI_MALFORMED_OUTPUT, telemetry, log);
        }
        const parsed = parseJsonObject(content);
        if (!parsed.ok) {
          const telemetry = buildAiGatewayTelemetry({
            request: input,
            provider: config.provider,
            model: config.model,
            latencyMs: now() - started,
            outcome: 'malformed_output',
            attemptCount: attempt,
          });
          fail(AI_ERROR_CODES.AI_MALFORMED_OUTPUT, telemetry, log);
        }
        const schemaCheck = validateJsonAgainstSchema(parsed.value, input.outputSchema.schema);
        if (!schemaCheck.ok) {
          const telemetry = buildAiGatewayTelemetry({
            request: input,
            provider: config.provider,
            model: config.model,
            latencyMs: now() - started,
            outcome: 'structured_output_invalid',
            attemptCount: attempt,
          });
          fail(AI_ERROR_CODES.AI_STRUCTURED_OUTPUT_INVALID, telemetry, log);
        }

        const telemetry = buildAiGatewayTelemetry({
          request: input,
          provider: config.provider,
          model: config.model,
          latencyMs: now() - started,
          outcome: 'success',
          attemptCount: attempt,
        });
        logAiGatewayTelemetry(telemetry, log);
        return {
          json: parsed.value,
          provider: config.provider,
          model: config.model,
          latency_ms: telemetry.latency_ms,
          outcome: 'success',
          telemetry,
        };
      } catch (error) {
        if (error instanceof AiGatewayError) {
          throw error;
        }
        if (isAbortError(error)) {
          const telemetry = buildAiGatewayTelemetry({
            request: input,
            provider: config.provider,
            model: config.model,
            latencyMs: now() - started,
            outcome: 'timeout',
            attemptCount: attempt,
          });
          fail(AI_ERROR_CODES.AI_TIMEOUT, telemetry, log);
        }
        const telemetry = buildAiGatewayTelemetry({
          request: input,
          provider: config.provider,
          model: config.model,
          latencyMs: now() - started,
          outcome: 'provider_unavailable',
          attemptCount: attempt,
        });
        fail(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE, telemetry, log);
      } finally {
        clearTimeout(timer);
      }
    }

    const telemetry = buildAiGatewayTelemetry({
      request: input,
      provider: config.provider,
      model: config.model,
      latencyMs: now() - started,
      outcome: lastRetryable ?? 'provider_unavailable',
      attemptCount: attempt,
    });
    fail(
      lastRetryable === 'rate_limited' ? AI_ERROR_CODES.AI_RATE_LIMITED : AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
      telemetry,
      log,
    );
  }

  return { completeStructuredJson };
}

const defaultGateway = createAiGateway();

export async function completeStructuredJson(
  input: AiGatewayCompleteStructuredJsonInput,
): Promise<AiGatewayCompleteStructuredJsonResult> {
  return defaultGateway.completeStructuredJson(input);
}
