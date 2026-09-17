import {
  AI_GATEWAY_MAX_ATTEMPTS,
  AI_GATEWAY_MAX_ROUTE_TARGETS,
  AI_GATEWAY_RETRY_AFTER_CAP_MS,
  AI_GATEWAY_RETRY_BACKOFF_MS,
  type AiGatewayCompleteStructuredJsonInput,
  type AiGatewayCompleteStructuredJsonResult,
  type AiGatewayOutcome,
  type AiGatewayResolvedConfig,
  type AiGatewayTelemetry,
} from './ai-gateway.types.js';
import {
  AI_ERROR_CODES,
  AiGatewayError,
  aiGatewayError,
  isAiGatewayFailoverErrorCode,
  outcomeForAiErrorCode,
  type AiErrorCode,
} from './ai-gateway.errors.js';
import { resolveAiGatewayInvocationConfig, type AiGatewayEnv } from './ai-gateway.config.js';
import { looksLikeSecret } from './ai-gateway.redaction.js';
import { isValidStructuredOutputSchemaName, parseJsonObject, validateJsonAgainstSchema } from './ai-gateway.schema.js';
import { buildAiGatewayTelemetry, failureCategoryForAiErrorCode, logAiGatewayTelemetry } from './ai-gateway.telemetry.js';
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
import { processAiGatewayCircuitBreaker, type AiGatewayCircuitBreaker } from './ai-gateway.circuit.js';
import {
  envBootstrapRouteTarget,
  loadEligibleOwnerRouteTargets,
  pinnedInvocationRouteTarget,
  type AiGatewayRouteTarget,
} from './ai-gateway.owner-routing.js';

export type AiGatewayDeps = {
  env?: AiGatewayEnv;
  invocationConfig?: AiGatewayResolvedConfig;
  transport?: AiProviderTransport;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (event: string, payload: Record<string, unknown>) => void;
  maxAttempts?: number;
  resolveOwnerRoutes?: () => Promise<AiGatewayRouteTarget[]>;
  circuitBreaker?: AiGatewayCircuitBreaker;
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

type HopSuccess = {
  ok: true;
  json: Record<string, unknown>;
  attemptCount: number;
};

type HopFailure = {
  ok: false;
  code: AiErrorCode;
  outcome: Exclude<AiGatewayOutcome, 'success'>;
  attemptCount: number;
};

async function resolveRoutePlan(deps: AiGatewayDeps): Promise<{
  targets: AiGatewayRouteTarget[];
  applyCircuit: boolean;
  ownerConfigured: boolean;
}> {
  if (deps.invocationConfig) {
    return {
      targets: [pinnedInvocationRouteTarget(deps.invocationConfig)],
      applyCircuit: false,
      ownerConfigured: false,
    };
  }
  const loadOwner =
    deps.resolveOwnerRoutes ??
    (deps.env != null ? async () => [] : loadEligibleOwnerRouteTargets);
  const ownerTargets = (await loadOwner()).slice(0, AI_GATEWAY_MAX_ROUTE_TARGETS);
  if (ownerTargets.length > 0) {
    return { targets: ownerTargets, applyCircuit: true, ownerConfigured: true };
  }
  const envConfig = resolveAiGatewayInvocationConfig(deps.env);
  return {
    targets: [envBootstrapRouteTarget(envConfig)],
    applyCircuit: false,
    ownerConfigured: false,
  };
}

export function createAiGateway(deps: AiGatewayDeps = {}) {
  const transport = deps.transport ?? fetchAiProviderTransport;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const log = deps.log ?? ((event, payload) => console.info(event, payload));
  const circuit = deps.circuitBreaker ?? processAiGatewayCircuitBreaker;

  async function runAgainstConfig(
    config: AiGatewayResolvedConfig,
    input: AiGatewayCompleteStructuredJsonInput,
    maxAttempts: number,
  ): Promise<HopSuccess | HopFailure> {
    const timeoutMs = input.timeoutMs ?? config.timeoutMs;
    let attempt = 0;
    let lastRetryable: Extract<AiErrorCode, 'AI_RATE_LIMITED' | 'AI_PROVIDER_UNAVAILABLE'> | null = null;

    while (attempt < maxAttempts) {
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
          lastRetryable = response.status === 429 ? AI_ERROR_CODES.AI_RATE_LIMITED : AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE;
          if (attempt < maxAttempts) {
            const waitMs = Math.min(
              response.retryAfterMs ?? AI_GATEWAY_RETRY_BACKOFF_MS,
              AI_GATEWAY_RETRY_AFTER_CAP_MS,
            );
            await sleep(waitMs);
            continue;
          }
          return {
            ok: false,
            code: lastRetryable,
            outcome: outcomeForAiErrorCode(lastRetryable),
            attemptCount: attempt,
          };
        }
        if (response.status === 401 || response.status === 403) {
          return {
            ok: false,
            code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
            outcome: 'provider_unavailable',
            attemptCount: attempt,
          };
        }
        if (response.status < 200 || response.status >= 300) {
          return {
            ok: false,
            code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
            outcome: 'provider_unavailable',
            attemptCount: attempt,
          };
        }

        const content = extractOpenAiCompatibleMessageContent(response.bodyText);
        if (content == null || looksLikeSecret(content)) {
          return {
            ok: false,
            code: AI_ERROR_CODES.AI_MALFORMED_OUTPUT,
            outcome: 'malformed_output',
            attemptCount: attempt,
          };
        }
        const parsed = parseJsonObject(content);
        if (!parsed.ok) {
          return {
            ok: false,
            code: AI_ERROR_CODES.AI_MALFORMED_OUTPUT,
            outcome: 'malformed_output',
            attemptCount: attempt,
          };
        }
        const schemaCheck = validateJsonAgainstSchema(parsed.value, input.outputSchema.schema);
        if (!schemaCheck.ok) {
          return {
            ok: false,
            code: AI_ERROR_CODES.AI_STRUCTURED_OUTPUT_INVALID,
            outcome: 'structured_output_invalid',
            attemptCount: attempt,
          };
        }
        return { ok: true, json: parsed.value, attemptCount: attempt };
      } catch (error) {
        if (error instanceof AiGatewayError) {
          return {
            ok: false,
            code: error.code as AiErrorCode,
            outcome: error.outcome,
            attemptCount: attempt,
          };
        }
        if (isAbortError(error)) {
          return {
            ok: false,
            code: AI_ERROR_CODES.AI_TIMEOUT,
            outcome: 'timeout',
            attemptCount: attempt,
          };
        }
        return {
          ok: false,
          code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
          outcome: 'provider_unavailable',
          attemptCount: attempt,
        };
      } finally {
        clearTimeout(timer);
      }
    }

    return {
      ok: false,
      code: lastRetryable ?? AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
      outcome: lastRetryable === AI_ERROR_CODES.AI_RATE_LIMITED ? 'rate_limited' : 'provider_unavailable',
      attemptCount: attempt,
    };
  }

  async function completeStructuredJson(
    input: AiGatewayCompleteStructuredJsonInput,
  ): Promise<AiGatewayCompleteStructuredJsonResult> {
    const started = now();
    validateRequest(input);
    const maxAttempts = deps.maxAttempts ?? AI_GATEWAY_MAX_ATTEMPTS;

    let plan;
    try {
      plan = await resolveRoutePlan(deps);
    } catch (error) {
      const telemetry = buildAiGatewayTelemetry({
        request: input,
        provider: null,
        model: null,
        latencyMs: now() - started,
        outcome: 'not_configured',
        attemptCount: 0,
        routingSource: null,
        providersAttempted: 0,
        failureCategory: 'not_configured',
      });
      logAiGatewayTelemetry(telemetry, log);
      throw error;
    }

    let failoverOccurred = false;
    let lastFailure: HopFailure | null = null;
    let lastTarget: AiGatewayRouteTarget | null = null;
    let totalAttempts = 0;
    let providersAttempted = 0;
    const seen = new Set<string>();
    const instanceKeyOf = (route: AiGatewayRouteTarget) =>
      route.id ?? `${route.routing_source}:${route.config.provider}:${route.config.model}:${route.config.baseUrl}`;
    const hasUnseenTargets = () =>
      providersAttempted < AI_GATEWAY_MAX_ROUTE_TARGETS &&
      plan.targets.some((candidate) => !seen.has(instanceKeyOf(candidate)));

    for (const target of plan.targets) {
      if (providersAttempted >= AI_GATEWAY_MAX_ROUTE_TARGETS) break;
      const instanceKey = instanceKeyOf(target);
      if (seen.has(instanceKey)) continue;
      seen.add(instanceKey);

      const applyCircuit = plan.applyCircuit && Boolean(target.id);
      let acquiredProbe = false;
      if (applyCircuit && target.id) {
        const decision = circuit.decide(target.id, now());
        if (decision === 'skip') {
          if (hasUnseenTargets()) failoverOccurred = true;
          lastTarget = target;
          lastFailure = {
            ok: false,
            code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
            outcome: 'provider_unavailable',
            attemptCount: 0,
          };
          continue;
        }
        if (decision === 'probe') {
          acquiredProbe = circuit.tryAcquireHalfOpenProbe(target.id, now());
          if (!acquiredProbe) {
            if (hasUnseenTargets()) failoverOccurred = true;
            lastTarget = target;
            lastFailure = {
              ok: false,
              code: AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE,
              outcome: 'provider_unavailable',
              attemptCount: 0,
            };
            continue;
          }
        }
      }

      providersAttempted += 1;
      lastTarget = target;
      const hop = await runAgainstConfig(target.config, input, maxAttempts);
      totalAttempts += hop.attemptCount;

      if (hop.ok) {
        if (applyCircuit && target.id) circuit.recordSuccess(target.id);
        const telemetry = buildAiGatewayTelemetry({
          request: input,
          provider: target.config.provider,
          model: target.config.model,
          latencyMs: now() - started,
          outcome: 'success',
          attemptCount: totalAttempts,
          providerId: target.id,
          routingPosition: target.position,
          routingSource: target.routing_source,
          providersAttempted,
          failoverOccurred,
          failureCategory: null,
          circuitState: applyCircuit && target.id ? circuit.snapshot(target.id)?.state ?? 'closed' : null,
        });
        logAiGatewayTelemetry(telemetry, log);
        return {
          json: hop.json,
          provider: target.config.provider,
          model: target.config.model,
          latency_ms: telemetry.latency_ms,
          outcome: 'success',
          telemetry,
        };
      }

      lastFailure = hop;
      if (applyCircuit && target.id && isAiGatewayFailoverErrorCode(hop.code)) {
        circuit.recordFailure(target.id, now());
      } else if (applyCircuit && target.id && acquiredProbe && hop.code === AI_ERROR_CODES.AI_NOT_CONFIGURED) {
        circuit.recordFailure(target.id, now());
      }

      if (isAiGatewayFailoverErrorCode(hop.code) && hasUnseenTargets()) {
        failoverOccurred = true;
        continue;
      }
      const telemetry = buildAiGatewayTelemetry({
        request: input,
        provider: target.config.provider,
        model: target.config.model,
        latencyMs: now() - started,
        outcome: hop.outcome,
        attemptCount: totalAttempts,
        providerId: target.id,
        routingPosition: target.position,
        routingSource: target.routing_source,
        providersAttempted,
        failoverOccurred,
        failureCategory: failureCategoryForAiErrorCode(hop.code),
        circuitState: applyCircuit && target.id ? circuit.snapshot(target.id)?.state ?? null : null,
      });
      fail(hop.code, telemetry, log);
    }

    const code =
      lastFailure?.code && lastFailure.code !== AI_ERROR_CODES.AI_NOT_CONFIGURED
        ? lastFailure.code
        : plan.ownerConfigured
          ? AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE
          : AI_ERROR_CODES.AI_NOT_CONFIGURED;
    const outcome = outcomeForAiErrorCode(code);
    const telemetry = buildAiGatewayTelemetry({
      request: input,
      provider: lastTarget?.config.provider ?? null,
      model: lastTarget?.config.model ?? null,
      latencyMs: now() - started,
      outcome,
      attemptCount: totalAttempts,
      providerId: lastTarget?.id ?? null,
      routingPosition: lastTarget?.position ?? null,
      routingSource: lastTarget?.routing_source ?? (plan.ownerConfigured ? 'owner' : null),
      providersAttempted,
      failoverOccurred,
      failureCategory:
        lastFailure && lastFailure.attemptCount === 0 && plan.ownerConfigured
          ? 'circuit_open'
          : failureCategoryForAiErrorCode(code),
      circuitState:
        plan.applyCircuit && lastTarget?.id ? circuit.snapshot(lastTarget.id)?.state ?? null : null,
    });
    fail(code, telemetry, log);
  }

  return { completeStructuredJson };
}

const defaultGateway = createAiGateway();

export async function completeStructuredJson(
  input: AiGatewayCompleteStructuredJsonInput,
): Promise<AiGatewayCompleteStructuredJsonResult> {
  return defaultGateway.completeStructuredJson(input);
}
