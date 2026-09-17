export const AI_RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export type AiProviderTransportRequest = {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal: AbortSignal;
};

export type AiProviderTransportResponse = {
  status: number;
  bodyText: string;
  retryAfterMs: number | null;
};

export type AiProviderTransport = (
  request: AiProviderTransportRequest,
) => Promise<AiProviderTransportResponse>;

export function parseRetryAfterMs(header: string | null | undefined, capMs: number): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(Math.floor(asSeconds * 1000), capMs);
  }
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) {
    return Math.min(Math.max(0, asDate - Date.now()), capMs);
  }
  return null;
}

export async function fetchAiProviderTransport(
  request: AiProviderTransportRequest,
): Promise<AiProviderTransportResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
  });
  const bodyText = await response.text();
  return {
    status: response.status,
    bodyText,
    retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after'), request.timeoutMs),
  };
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  return name === 'AbortError' || name === 'TimeoutError' || code === 'ABORT_ERR';
}
