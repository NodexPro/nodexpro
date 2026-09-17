import { badRequest } from '../errors.js';

/**
 * TAX-641B — configuration-time endpoint policy.
 * Does not perform DNS, TCP, TLS, or HTTP.
 * Later connection-test / runtime MUST revalidate the resolved address and every redirect hop
 * against the same rules (DNS rebinding / SSRF).
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.',
  'metadata.google.internal',
  'metadata.internal',
  'instance-data',
]);

const BLOCKED_HOSTNAME_SUFFIXES = ['.localhost', '.internal', '.local'];

export type AiGatewayEndpointPolicyResult =
  | { ok: true; normalized: string; hostname: string }
  | { ok: false; reason: string; code: string };

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    return n;
  });
  if (nums.some((n) => n == null)) return null;
  return nums as [number, number, number, number];
}

function ipv4ToInt(octets: [number, number, number, number]): number {
  return ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3];
}

function inCidr(ip: number, base: number, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

function isBlockedIpv4(octets: [number, number, number, number]): boolean {
  const ip = ipv4ToInt(octets);
  if (inCidr(ip, ipv4ToInt([0, 0, 0, 0]), 8)) return true;
  if (inCidr(ip, ipv4ToInt([10, 0, 0, 0]), 8)) return true;
  if (inCidr(ip, ipv4ToInt([127, 0, 0, 0]), 8)) return true;
  if (inCidr(ip, ipv4ToInt([169, 254, 0, 0]), 16)) return true;
  if (inCidr(ip, ipv4ToInt([172, 16, 0, 0]), 12)) return true;
  if (inCidr(ip, ipv4ToInt([192, 168, 0, 0]), 16)) return true;
  if (inCidr(ip, ipv4ToInt([100, 64, 0, 0]), 10)) return true;
  return false;
}

function expandIpv6(hostname: string): number[] | null {
  if (!hostname.includes(':')) return null;
  const lower = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const ipv4Mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped) {
    const octets = parseIpv4(ipv4Mapped[1]);
    if (!octets) return null;
    return [0, 0, 0, 0, 0, 0xffff, (octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
  }
  if (lower.includes('.')) return null;
  const [head, tail] = lower.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  if (headParts.length + tailParts.length > 8) return null;
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [
    ...headParts,
    ...Array.from({ length: lower.includes('::') ? missing : 0 }, () => '0'),
    ...tailParts,
  ];
  if (parts.length !== 8) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part || '0')) return null;
    nums.push(parseInt(part || '0', 16));
  }
  return nums;
}

function ipv4MappedOctets(parts: number[]): [number, number, number, number] | null {
  const mapped =
    parts[0] === 0 &&
    parts[1] === 0 &&
    parts[2] === 0 &&
    parts[3] === 0 &&
    parts[4] === 0 &&
    parts[5] === 0xffff;
  if (!mapped) return null;
  return [(parts[6] >> 8) & 0xff, parts[6] & 0xff, (parts[7] >> 8) & 0xff, parts[7] & 0xff];
}

function isBlockedIpv6(parts: number[]): boolean {
  const mapped = ipv4MappedOctets(parts);
  if (mapped) return isBlockedIpv4(mapped);
  const isLoopback = parts.every((p, i) => (i < 7 ? p === 0 : p === 1));
  if (isLoopback) return true;
  const isUnspecified = parts.every((p) => p === 0);
  if (isUnspecified) return true;
  if ((parts[0] & 0xfe00) === 0xfc00) return true;
  if ((parts[0] & 0xffc0) === 0xfe80) return true;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return true;
  if (parts[0] === 0xfd00 && parts[1] === 0x0ec2 && parts.slice(2, 7).every((p) => p === 0) && parts[7] === 0x0254) {
    return true;
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (host === 'metadata.google.internal') return true;
  return false;
}

export function inspectAiGatewayBaseUrl(raw: string | null | undefined): AiGatewayEndpointPolicyResult {
  if (raw == null || !String(raw).trim()) {
    return { ok: true, normalized: '', hostname: '' };
  }
  const trimmed = String(raw).trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Endpoint URL is invalid.', code: 'AI_ENDPOINT_INVALID' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Endpoint URL must use HTTPS.', code: 'AI_ENDPOINT_HTTPS_REQUIRED' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Endpoint URL must not contain credentials.', code: 'AI_ENDPOINT_CREDENTIALS_FORBIDDEN' };
  }
  const hostname = parsed.hostname.trim().toLowerCase();
  if (isBlockedHostname(hostname)) {
    return { ok: false, reason: 'Endpoint host is not allowed.', code: 'AI_ENDPOINT_HOST_BLOCKED' };
  }
  const ipv4 = parseIpv4(hostname);
  if (ipv4 && isBlockedIpv4(ipv4)) {
    return { ok: false, reason: 'Private or local IP addresses are not allowed.', code: 'AI_ENDPOINT_IP_BLOCKED' };
  }
  const ipv6 = expandIpv6(hostname);
  if (ipv6 && isBlockedIpv6(ipv6)) {
    return { ok: false, reason: 'Private or local IP addresses are not allowed.', code: 'AI_ENDPOINT_IP_BLOCKED' };
  }
  parsed.hash = '';
  if (parsed.port === '443') parsed.port = '';
  const normalized = parsed.toString().replace(/\/$/, '');
  return { ok: true, normalized, hostname };
}

export function assertSafeAiGatewayBaseUrl(raw: string | null | undefined): string | null {
  const inspected = inspectAiGatewayBaseUrl(raw);
  if (!inspected.ok) {
    throw badRequest(inspected.reason, inspected.code);
  }
  return inspected.normalized || null;
}

export function aiGatewayBaseUrlSafeDisplay(raw: string | null | undefined): string | null {
  const inspected = inspectAiGatewayBaseUrl(raw);
  if (!inspected.ok || !inspected.normalized) return raw && String(raw).trim() ? 'invalid endpoint' : null;
  try {
    const url = new URL(inspected.normalized);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return inspected.hostname;
  }
}
