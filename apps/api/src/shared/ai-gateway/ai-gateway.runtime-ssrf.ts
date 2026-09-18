import dns from 'node:dns/promises';
import type { LookupAddress, LookupOptions } from 'node:dns';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { AI_ERROR_CODES, aiGatewayError } from './ai-gateway.errors.js';
import {
  inspectAiGatewayBaseUrl,
  isBlockedResolvedAddress,
} from './ai-gateway.endpoint-policy.js';
import { parseRetryAfterMs, type AiProviderTransportRequest, type AiProviderTransportResponse } from './providers/ai-provider.types.js';

/**
 * TAX-641C — runtime SSRF for Shared AI Gateway transport.
 * Pins DNS to a pre-checked address (rebinding), HTTPS only, no URL credentials,
 * and revalidates every redirect hop. Does not follow fetch()'s automatic redirects.
 */

export const AI_GATEWAY_MAX_REDIRECTS = 3;

export type AiGatewayResolvedAddress = { address: string; family: 4 | 6 };

export type AiGatewayDnsLookupFn = (hostname: string) => Promise<AiGatewayResolvedAddress[]>;

export type AiGatewayPinnedHttpResponse = {
  status: number;
  bodyText: string;
  retryAfterHeader: string | null;
  location: string | null;
};

export type AiGatewayPinnedHttpRequestFn = (input: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal: AbortSignal;
  address: string;
  family: 4 | 6;
}) => Promise<AiGatewayPinnedHttpResponse>;

export type AiGatewayRuntimeSsrfDeps = {
  lookup?: AiGatewayDnsLookupFn;
  request?: AiGatewayPinnedHttpRequestFn;
};

export async function defaultAiGatewayDnsLookup(hostname: string): Promise<AiGatewayResolvedAddress[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((row) => ({
    address: row.address,
    family: row.family === 6 ? 6 : 4,
  }));
}

function blockedEndpointError(reason?: string) {
  return aiGatewayError(AI_ERROR_CODES.AI_ENDPOINT_BLOCKED, {
    message: reason ?? 'Endpoint is not allowed.',
  });
}

/**
 * Node 22 `autoSelectFamily` calls lookup with `{ all: true }` and expects
 * `LookupAddress[]`. Passing a bare IP string yields ERR_INVALID_IP_ADDRESS.
 * Always pin to the single pre-checked address — never unpinned DNS.
 */
export function createPinnedDnsLookup(pin: AiGatewayResolvedAddress): LookupFunction {
  const pinned: LookupAddress = { address: pin.address, family: pin.family };
  return ((
    _hostname: string,
    options: LookupOptions | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void),
    callback?: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    const cb = (typeof options === 'function' ? options : callback) as
      | ((err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void)
      | undefined;
    if (typeof cb !== 'function') return;
    if (typeof options === 'object' && options?.all === true) {
      cb(null, [pinned]);
      return;
    }
    cb(null, pinned.address, pinned.family);
  }) as LookupFunction;
}

export function pickSafeResolvedAddress(addresses: AiGatewayResolvedAddress[]): AiGatewayResolvedAddress {
  const safe = addresses.filter((row) => row.address && !isBlockedResolvedAddress(row.address));
  if (!safe.length) {
    throw blockedEndpointError('Private or local IP addresses are not allowed.');
  }
  const ipv4 = safe.find((row) => row.family === 4);
  return ipv4 ?? safe[0]!;
}

export async function resolveSafeAiGatewayAddress(
  hostname: string,
  lookup: AiGatewayDnsLookupFn,
): Promise<AiGatewayResolvedAddress> {
  const hostForUrl = hostname.includes(':') && !hostname.startsWith('[') ? `[${hostname}]` : hostname;
  const inspectedHost = inspectAiGatewayBaseUrl(`https://${hostForUrl}`);
  if (!inspectedHost.ok) throw blockedEndpointError(inspectedHost.reason);
  const isLiteralIp = hostname.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  if (isLiteralIp) {
    if (isBlockedResolvedAddress(hostname)) {
      throw blockedEndpointError('Private or local IP addresses are not allowed.');
    }
    return {
      address: hostname.replace(/^\[/, '').replace(/\]$/, ''),
      family: hostname.includes(':') ? 6 : 4,
    };
  }
  let addresses: AiGatewayResolvedAddress[];
  try {
    addresses = await lookup(hostname);
  } catch {
    throw aiGatewayError(AI_ERROR_CODES.AI_PROVIDER_UNAVAILABLE, {
      message: 'AI provider is unavailable.',
    });
  }
  if (!addresses.length) {
    throw blockedEndpointError('Endpoint host is not allowed.');
  }
  return pickSafeResolvedAddress(addresses);
}

function parseRequestUrl(raw: string): URL {
  const inspected = inspectAiGatewayBaseUrl(raw);
  if (!inspected.ok || !inspected.normalized) {
    throw blockedEndpointError(inspected.ok ? 'Endpoint URL is invalid.' : inspected.reason);
  }
  return new URL(inspected.normalized);
}

export function resolveRedirectUrl(current: URL, location: string | null | undefined): URL {
  if (!location || !location.trim()) {
    throw blockedEndpointError('Redirect destination is missing.');
  }
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw blockedEndpointError('Redirect destination is invalid.');
  }
  return parseRequestUrl(next.toString());
}

export async function defaultAiGatewayPinnedHttpsRequest(input: {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  signal: AbortSignal;
  address: string;
  family: 4 | 6;
}): Promise<AiGatewayPinnedHttpResponse> {
  return new Promise((resolve, reject) => {
    const headers = { ...input.headers, Host: input.url.host };
    const req = https.request(
      {
        protocol: 'https:',
        hostname: input.url.hostname,
        servername: input.url.hostname,
        port: input.url.port ? Number(input.url.port) : 443,
        path: `${input.url.pathname}${input.url.search}`,
        method: input.method,
        headers,
        lookup: createPinnedDnsLookup({ address: input.address, family: input.family }),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            bodyText: Buffer.concat(chunks).toString('utf8'),
            retryAfterHeader: typeof res.headers['retry-after'] === 'string' ? res.headers['retry-after'] : null,
            location: typeof res.headers.location === 'string' ? res.headers.location : null,
          });
        });
      },
    );
    const onAbort = () => {
      req.destroy(Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'ABORT_ERR' }));
    };
    if (input.signal.aborted) {
      onAbort();
      return;
    }
    input.signal.addEventListener('abort', onAbort, { once: true });
    req.setTimeout(input.timeoutMs, () => {
      req.destroy(Object.assign(new Error('Timeout'), { name: 'TimeoutError' }));
    });
    req.on('error', (error) => {
      input.signal.removeEventListener('abort', onAbort);
      reject(error);
    });
    req.on('close', () => input.signal.removeEventListener('abort', onAbort));
    req.write(input.body);
    req.end();
  });
}

function sameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && (a.port || '443') === (b.port || '443');
}

export async function fetchAiProviderTransportHardened(
  request: AiProviderTransportRequest,
  deps: AiGatewayRuntimeSsrfDeps = {},
): Promise<AiProviderTransportResponse> {
  const lookup = deps.lookup ?? defaultAiGatewayDnsLookup;
  const send = deps.request ?? defaultAiGatewayPinnedHttpsRequest;
  let url = parseRequestUrl(request.url);
  let headers = { ...request.headers };
  let hops = 0;

  while (hops <= AI_GATEWAY_MAX_REDIRECTS) {
    const pin = await resolveSafeAiGatewayAddress(url.hostname, lookup);
    const response = await send({
      url,
      method: request.method,
      headers,
      body: request.body,
      timeoutMs: request.timeoutMs,
      signal: request.signal,
      address: pin.address,
      family: pin.family,
    });
    const redirect = response.status === 307 || response.status === 308;
    if (redirect) {
      hops += 1;
      if (hops > AI_GATEWAY_MAX_REDIRECTS) {
        throw blockedEndpointError('Too many redirects.');
      }
      const next = resolveRedirectUrl(url, response.location);
      if (!sameOrigin(url, next) && headers.Authorization) {
        const nextHeaders = { ...headers };
        delete nextHeaders.Authorization;
        headers = nextHeaders;
      }
      url = next;
      continue;
    }
    if (response.status === 301 || response.status === 302 || response.status === 303) {
      throw blockedEndpointError('Redirect destination is not allowed.');
    }
    return {
      status: response.status,
      bodyText: response.bodyText,
      retryAfterMs: parseRetryAfterMs(response.retryAfterHeader, request.timeoutMs),
    };
  }
  throw blockedEndpointError('Too many redirects.');
}
