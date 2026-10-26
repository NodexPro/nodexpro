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

/**
 * Walk the trusted platform chain from the right (peer first).
 * Render/Cloudflare private hops are skipped. Spoofed leftmost XFF is ignored.
 * Private or unverified results become Unknown and are not stored as source IP.
 */
export function resolvePublicClientIp(input: {
  reqIp?: string | null;
  peerIp?: string | null;
  forwardedFor?: string | null;
  cfConnectingIp?: string | null;
  originPullVerified?: boolean;
}): { ip: string | null; display: string; source: 'cf_connecting_ip' | 'trusted_chain' | 'req_ip' | 'unknown' } {
  const cfIp = normalizedIp(input.cfConnectingIp);
  const peer = normalizedIp(input.peerIp);
  const canUseCf = Boolean(
    cfIp && !isPrivateOrReservedIp(cfIp) && (input.originPullVerified || isCloudflareIp(peer)),
  );
  if (canUseCf && cfIp) {
    return { ip: cfIp, display: displaySourceIp(cfIp), source: 'cf_connecting_ip' };
  }

  const peerTrusted = Boolean(peer && (isPrivateOrReservedIp(peer) || isCloudflareIp(peer)));
  if (peerTrusted) {
    const hops = [...parseForwardedFor(input.forwardedFor), peer].filter((item): item is string => Boolean(item));
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      if (isPrivateOrReservedIp(hops[i]) || isCloudflareIp(hops[i])) continue;
      return { ip: hops[i], display: hops[i], source: 'trusted_chain' };
    }
    return { ip: null, display: 'Unknown', source: 'unknown' };
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
  originPullVerified?: boolean;
}): { ip: string | null; source: 'req_ip' | 'cf_connecting_ip' | 'trusted_chain' | 'unknown' | 'none' } {
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
