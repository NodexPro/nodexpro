import { isIP } from 'node:net';

export type GeoIpEnrichment = {
  source_ip: string | null;
  country: string;
  country_code: string;
  city: string;
  region: string;
  asn: string;
  network: string;
  risk: 'unknown';
  provider: 'none' | 'dbip_lite';
  looked_up_at: string | null;
  accuracy_note: string;
};

function normalizedIp(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (value.startsWith('::ffff:')) return value.slice(7);
  return value;
}

export function resolveTrustedSourceIp(input: { reqIp?: string | null }): string | null {
  const ip = normalizedIp(input.reqIp);
  if (!ip || isIP(ip) === 0) return null;
  return ip;
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

function inCidr(value: number, base: string, bits: number): boolean {
  const baseValue = ipv4ToInt(base);
  if (baseValue === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (baseValue & mask);
}

export function isPrivateOrReservedIp(ip: string | null): boolean {
  if (!ip) return true;
  const kind = isIP(ip);
  if (kind === 0) return true;
  if (kind === 4) {
    const value = ipv4ToInt(ip);
    if (value === null) return true;
    return [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ].some(([base, bits]) => inCidr(value, String(base), Number(bits)));
  }
  const lower = ip.toLowerCase();
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe80:') ||
    lower.startsWith('ff')
  );
}

export function geoIpUnavailable(sourceIp: string | null): GeoIpEnrichment {
  return {
    source_ip: sourceIp,
    country: 'Unknown',
    country_code: 'Unknown',
    city: 'Unknown',
    region: 'Unknown',
    asn: 'Unknown',
    network: 'Unknown',
    risk: 'unknown',
    provider: 'none',
    looked_up_at: null,
    accuracy_note: 'DB-IP Lite GeoIP is unavailable. Source IP comes from Express req.ip after the trusted proxy setting.',
  };
}
