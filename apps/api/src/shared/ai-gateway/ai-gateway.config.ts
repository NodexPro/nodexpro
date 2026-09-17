import {
  AI_GATEWAY_DEFAULT_BASE_URL,
  AI_GATEWAY_DEFAULT_TIMEOUT_MS,
  AI_GATEWAY_FORBIDDEN_MODEL_ALIASES,
  AI_GATEWAY_MAX_TIMEOUT_MS,
  AI_GATEWAY_MIN_TIMEOUT_MS,
  AI_GATEWAY_PROVIDERS,
  type AiGatewayProvider,
  type AiGatewayPublicConfig,
  type AiGatewayResolvedConfig,
} from './ai-gateway.types.js';
import { AI_ERROR_CODES, aiGatewayError } from './ai-gateway.errors.js';

export type AiGatewayEnv = Record<string, string | undefined>;

function readTrimmed(env: AiGatewayEnv, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

export function parseAiGatewayTimeoutMs(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === '') return AI_GATEWAY_DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n)) return AI_GATEWAY_DEFAULT_TIMEOUT_MS;
  const rounded = Math.floor(n);
  if (rounded < AI_GATEWAY_MIN_TIMEOUT_MS) return AI_GATEWAY_MIN_TIMEOUT_MS;
  if (rounded > AI_GATEWAY_MAX_TIMEOUT_MS) return AI_GATEWAY_MAX_TIMEOUT_MS;
  return rounded;
}

export function isPinnedAiModel(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) return false;
  if ((AI_GATEWAY_FORBIDDEN_MODEL_ALIASES as readonly string[]).includes(normalized)) return false;
  if (normalized.endsWith('-latest') || normalized.endsWith('/latest')) return false;
  if (normalized.includes(':latest')) return false;
  return true;
}

export function isSupportedAiGatewayProvider(value: string): value is AiGatewayProvider {
  return (AI_GATEWAY_PROVIDERS as readonly string[]).includes(value);
}

/** Safe for boot/logs. Never includes the API key. */
export function loadAiGatewayPublicConfig(env: AiGatewayEnv = process.env): AiGatewayPublicConfig {
  return {
    provider: readTrimmed(env, 'TAX_KNOWLEDGE_AI_PROVIDER'),
    model: readTrimmed(env, 'TAX_KNOWLEDGE_AI_MODEL'),
    baseUrl: readTrimmed(env, 'TAX_KNOWLEDGE_AI_BASE_URL') ?? AI_GATEWAY_DEFAULT_BASE_URL,
    timeoutMs: parseAiGatewayTimeoutMs(readTrimmed(env, 'TAX_KNOWLEDGE_AI_TIMEOUT_MS')),
    apiKeyConfigured: Boolean(readTrimmed(env, 'TAX_KNOWLEDGE_AI_API_KEY')),
  };
}

export function getAiGatewayEnvDiagnostic(env: AiGatewayEnv = process.env): {
  provider: string | null;
  model: string | null;
  apiKeyConfigured: boolean;
  modelPinned: boolean | null;
} {
  const cfg = loadAiGatewayPublicConfig(env);
  return {
    provider: cfg.provider,
    model: cfg.model,
    apiKeyConfigured: cfg.apiKeyConfigured,
    modelPinned: cfg.model ? isPinnedAiModel(cfg.model) : null,
  };
}

export function logAiGatewayBootDiagnostic(
  env: AiGatewayEnv = process.env,
  write: (message: string, payload: Record<string, unknown>) => void = (message, payload) => {
    console.log(message, payload);
  },
): void {
  const diagnostic = getAiGatewayEnvDiagnostic(env);
  write('[ai-gateway][boot]', {
    configured: diagnostic.apiKeyConfigured && Boolean(diagnostic.provider) && Boolean(diagnostic.model),
    provider: diagnostic.provider,
    model: diagnostic.model,
    api_key_configured: diagnostic.apiKeyConfigured,
    model_pinned: diagnostic.modelPinned,
  });
}

/**
 * Resolves invocation config. Missing DEV key does not fail API startup;
 * it fails only when a caller actually invokes the gateway.
 */
export function resolveAiGatewayInvocationConfig(env: AiGatewayEnv = process.env): AiGatewayResolvedConfig {
  const publicConfig = loadAiGatewayPublicConfig(env);
  const apiKey = readTrimmed(env, 'TAX_KNOWLEDGE_AI_API_KEY');

  if (!publicConfig.provider || !isSupportedAiGatewayProvider(publicConfig.provider)) {
    throw aiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED, {
      message: 'AI provider is not configured.',
    });
  }
  if (!publicConfig.model) {
    throw aiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED, {
      message: 'AI model is not configured.',
    });
  }
  if (!isPinnedAiModel(publicConfig.model)) {
    throw aiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED, {
      message: 'AI model must be an explicit pinned id.',
    });
  }
  if (!apiKey) {
    throw aiGatewayError(AI_ERROR_CODES.AI_NOT_CONFIGURED, {
      message: 'AI is not configured.',
    });
  }

  return {
    provider: publicConfig.provider,
    model: publicConfig.model,
    apiKey,
    baseUrl: publicConfig.baseUrl.replace(/\/+$/, ''),
    timeoutMs: publicConfig.timeoutMs,
  };
}
