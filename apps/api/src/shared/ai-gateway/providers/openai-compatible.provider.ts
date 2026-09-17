import type { AiGatewayCompleteStructuredJsonInput, AiGatewayResolvedConfig } from '../ai-gateway.types.js';
import type { AiProviderTransportRequest } from './ai-provider.types.js';

export function buildOpenAiCompatibleStructuredRequest(input: {
  config: AiGatewayResolvedConfig;
  request: AiGatewayCompleteStructuredJsonInput;
  timeoutMs: number;
  signal: AbortSignal;
}): AiProviderTransportRequest {
  const body = {
    model: input.config.model,
    temperature: 0,
    messages: input.request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: input.request.outputSchema.name,
        strict: true,
        schema: input.request.outputSchema.schema,
      },
    },
  };
  return {
    url: `${input.config.baseUrl}/chat/completions`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  };
}

export function extractOpenAiCompatibleMessageContent(bodyText: string): string | null {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const choices = (parsed as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return null;
    const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
    const content = message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const parts = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
            return (part as { text: string }).text;
          }
          return '';
        })
        .join('');
      return parts || null;
    }
    return null;
  } catch {
    return null;
  }
}
