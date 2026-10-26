import { isIP } from 'node:net';
import { isPrivateOrReservedIp } from './request-source.pure.js';

const CF_IPV4: Array<[string, number]> = [
  ['173.245.48.0', 20],
  ['103.21.244.0', 22],
  ['103.22.200.0', 22],
  ['103.31.4.0', 22],
  ['141.101.64.0', 18],
  ['108.162.192.0', 18],
  ['190.93.240.0', 20],
  ['188.114.96.0', 20],
  ['197.234.240.0', 22],
  ['198.41.128.0', 17],
  ['162.158.0.0', 15],
  ['104.16.0.0', 13],
  ['104.24.0.0', 14],
  ['172.64.0.0', 13],
  ['131.0.72.0', 22],
];

const CF_IPV6_PREFIXES = [
  '2400:cb00',
  '2606:4700',
  '2803:f800',
  '2405:b500',
  '2405:8100',
  '2a06:98c0',
  '2c0f:f248',
];

function normalizedIp(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('::ffff:')) return value.slice(7);
  return value;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    out = (out << 8) + value;
  }
  return out >>> 0;
}

function inCidr(ip: string, base: string, bits: number): boolean {
  const value = ipv4ToInt(ip);
  const baseValue = ipv4ToInt(base);
  if (value === null || baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

export function isCloudflareIp(ip: string | null | undefined): boolean {
  const value = normalizedIp(ip);
  if (!value || isIP(value) === 0) return false;
  if (isIP(value) === 4) return CF_IPV4.some(([base, bits]) => inCidr(value, base, bits));
  const lower = value.toLowerCase();
  return CF_IPV6_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}:`));
}

/** Published Vercel anycast/control ranges. Outbound rewrite egress is often AWS and is not listed. */
const VERCEL_IPV4: Array<[string, number]> = [
  ['76.76.21.0', 24],
  ['66.33.60.0', 24],
  ['64.29.17.0', 24],
  ['64.239.109.0', 24],
  ['64.239.123.0', 24],
  ['216.198.79.0', 24],
  ['216.150.1.0', 24],
  ['216.150.16.0', 24],
  ['198.169.1.0', 24],
  ['198.169.2.0', 24],
  ['143.13.0.0', 16],
  ['155.121.0.0', 16],
];

export function isVercelIp(ip: string | null | undefined): boolean {
  const value = normalizedIp(ip);
  if (!value || isIP(value) === 0) return false;
  if (isIP(value) === 6) return value.toLowerCase().startsWith('2607:db00');
  return VERCEL_IPV4.some(([base, bits]) => inCidr(value, base, bits));
}

export function isTrustedPlatformHop(ip: string | null | undefined): boolean {
  return isPrivateOrReservedIp(ip ?? null) || isCloudflareIp(ip) || isVercelIp(ip);
}

export function isVercelRegionId(raw: string | null | undefined): boolean {
  return /^[a-z]{3}[0-9]?::/i.test(String(raw ?? '').trim());
}

export function originPullSecretMatches(provided: string | null | undefined, expected: string | null | undefined): boolean {
  const left = String(provided ?? '');
  const right = String(expected ?? '');
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export function isOriginProtectionExemptPath(path: string | null | undefined): boolean {
  const value = String(path ?? '');
  return value === '/api/v1/health' || value.endsWith('/health');
}

export function parseForwardedFor(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((part) => normalizedIp(part))
    .filter((part): part is string => Boolean(part && isIP(part) !== 0));
}

export function displaySourceIp(ip: string | null | undefined): string {
  const value = normalizedIp(ip);
  if (!value || isPrivateOrReservedIp(value)) return 'Unknown';
  return value;
}

function publicNonInfraIp(ip: string | null | undefined): string | null {
  const value = normalizedIp(ip);
  if (!value || isTrustedPlatformHop(value)) return null;
  return value;
}

/**
 * Walk the trusted platform chain from the right (peer first).
 * Render/Cloudflare/Vercel hops are skipped. Spoofed leftmost XFF from an
 * untrusted public peer is ignored. A Vercel rewrite (region token present)
 * uses the visitor header and never treats rewrite egress as the client.
 * Missing visitor IP after a rewrite signal is Unknown, not the proxy hop.
 */
export function resolvePublicClientIp(input: {
  reqIp?: string | null;
  peerIp?: string | null;
  forwardedFor?: string | null;
  cfConnectingIp?: string | null;
  vercelForwardedFor?: string | null;
  vercelId?: string | null;
  realIp?: string | null;
  originPullVerified?: boolean;
}): { ip: string | null; display: string; source: 'cf_connecting_ip' | 'trusted_chain' | 'vercel_forwarded_for' | 'req_ip' | 'unknown' } {
  const cfIp = normalizedIp(input.cfConnectingIp);
  const peer = normalizedIp(input.peerIp);
  const canUseCf = Boolean(
    cfIp && !isPrivateOrReservedIp(cfIp) && (input.originPullVerified || isCloudflareIp(peer)),
  );
  if (canUseCf && cfIp) {
    return { ip: cfIp, display: displaySourceIp(cfIp), source: 'cf_connecting_ip' };
  }

  const vercelClient = publicNonInfraIp(input.vercelForwardedFor) ?? publicNonInfraIp(input.realIp);
  const vercelRewriteSignal = isVercelRegionId(input.vercelId);
  const vercelRewrite = vercelRewriteSignal && Boolean(vercelClient);
  const peerTrusted = Boolean(peer && isTrustedPlatformHop(peer));
  if (peerTrusted) {
    if (vercelRewrite && vercelClient) {
      return { ip: vercelClient, display: displaySourceIp(vercelClient), source: 'vercel_forwarded_for' };
    }
    if (vercelRewriteSignal) {
      return { ip: null, display: 'Unknown', source: 'unknown' };
    }
    const hops = [...parseForwardedFor(input.forwardedFor), peer].filter((item): item is string => Boolean(item));
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      if (isTrustedPlatformHop(hops[i])) continue;
      return { ip: hops[i], display: displaySourceIp(hops[i]), source: 'trusted_chain' };
    }
    return { ip: null, display: 'Unknown', source: 'unknown' };
  }

  if (vercelRewrite && vercelClient && peer && vercelClient !== peer) {
    return { ip: vercelClient, display: displaySourceIp(vercelClient), source: 'vercel_forwarded_for' };
  }

  const reqIp = normalizedIp(input.reqIp);
  if (reqIp && !isPrivateOrReservedIp(reqIp)) {
    return { ip: reqIp, display: reqIp, source: 'req_ip' };
  }
  return { ip: null, display: 'Unknown', source: 'unknown' };
}

/**
 * Client IP is trusted only after the immediate peer / origin-pull secret is verified.
 * Raw X-Forwarded-For from an untrusted public peer is ignored.
 */
export function resolveEdgeTrustedIp(input: {
  reqIp?: string | null;
  cfConnectingIp?: string | null;
  peerIp?: string | null;
  forwardedFor?: string | null;
  vercelForwardedFor?: string | null;
  vercelId?: string | null;
  realIp?: string | null;
  originPullVerified?: boolean;
}): { ip: string | null; source: 'req_ip' | 'cf_connecting_ip' | 'trusted_chain' | 'vercel_forwarded_for' | 'unknown' | 'none' } {
  const resolved = resolvePublicClientIp(input);
  return { ip: resolved.ip, source: resolved.source === 'unknown' ? 'unknown' : resolved.source };
}

export function shouldRejectUnprotectedOrigin(input: {
  enabled: boolean;
  path: string;
  originPullConfigured: boolean;
  originPullVerified: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (isOriginProtectionExemptPath(input.path)) return false;
  if (!input.originPullConfigured) return false;
  return !input.originPullVerified;
}
