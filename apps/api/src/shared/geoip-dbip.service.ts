import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Reader } from 'mmdb-lib';
import { config } from '../config.js';
import { geoIpUnavailable, isPrivateOrReservedIp, type GeoIpEnrichment } from './request-source.pure.js';

export const DBIP_ATTRIBUTION_TEXT = 'IP geolocation data by DB-IP.com — CC BY 4.0';
export const DBIP_ATTRIBUTION_URL = 'https://db-ip.com/db/download/ip-to-city-lite';

const ACTIVE_FILENAME = 'dbip-city-lite.mmdb';
const STATUS_FILENAME = 'dbip-city-lite-status.json';
const MAX_COMPRESSED_BYTES = 180 * 1024 * 1024;
const MAX_DATABASE_BYTES = 700 * 1024 * 1024;
const DOWNLOAD_TEMPLATE = 'https://download.db-ip.com/free/dbip-city-lite-{month}.mmdb.gz';

type DbIpCityResponse = {
  country?: { iso_code?: string; names?: Record<string, string> };
  registered_country?: { iso_code?: string; names?: Record<string, string> };
  city?: { names?: Record<string, string> };
  subdivisions?: Array<{ iso_code?: string; names?: Record<string, string> }>;
};

type DbIpProvisionStatus = {
  provider: 'dbip_lite';
  status: 'current' | 'updated' | 'not_configured' | 'failed';
  active_path: string;
  last_successful_update_at: string | null;
  database_age_days: number | null;
  last_error: string | null;
  source_url_template: string;
  attribution: string;
};

let readerCache: { path: string; mtimeMs: number; reader: Reader<any> } | null = null;
let updateInFlight: Promise<DbIpProvisionStatus> | null = null;

function activeDbPath(): string {
  return config.dbIpLite.cityDbPath ?? join(config.dbIpLite.dataDir, ACTIVE_FILENAME);
}

function statusPath(): string {
  return join(config.dbIpLite.dataDir, STATUS_FILENAME);
}

function updateDays(): number {
  return Number.isFinite(config.dbIpLite.updateDays) && config.dbIpLite.updateDays > 0
    ? config.dbIpLite.updateDays
    : 32;
}

function downloadTimeoutMs(): number {
  return Number.isFinite(config.dbIpLite.downloadTimeoutMs) && config.dbIpLite.downloadTimeoutMs > 0
    ? config.dbIpLite.downloadTimeoutMs
    : 60_000;
}

function monthTag(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function previousMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1));
}

export function dbIpCandidateMonths(now = new Date()): string[] {
  return [monthTag(now), monthTag(previousMonth(now))];
}

function downloadUrl(month: string): string {
  return DOWNLOAD_TEMPLATE.replace('{month}', month);
}

async function databaseAgeDays(path: string): Promise<number | null> {
  try {
    const current = await stat(path);
    return Math.max(0, Math.floor((Date.now() - current.mtimeMs) / (24 * 60 * 60 * 1000)));
  } catch {
    return null;
  }
}

async function shouldRefresh(path: string): Promise<boolean> {
  const age = await databaseAgeDays(path);
  return age === null || age >= updateDays();
}

async function readLastSuccess(): Promise<string | null> {
  try {
    const raw = JSON.parse(await readFile(statusPath(), 'utf8')) as { last_successful_update_at?: unknown };
    return typeof raw.last_successful_update_at === 'string' ? raw.last_successful_update_at : null;
  } catch {
    return null;
  }
}

async function writeStatus(status: DbIpProvisionStatus): Promise<void> {
  await mkdir(dirname(statusPath()), { recursive: true });
  await writeFile(statusPath(), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/https:\/\/download\.db-ip\.com\/[^\s]+/g, 'DBIP_DOWNLOAD_URL').slice(0, 160);
}

class ByteLimit extends Transform {
  private total = 0;
  constructor(private readonly maxBytes: number, private readonly label: string) {
    super();
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    this.total += chunk.length;
    if (this.total > this.maxBytes) callback(new Error(`${this.label}_size_limit_exceeded`));
    else callback(null, chunk);
  }
}

async function validateDb(path: string): Promise<void> {
  const reader = new Reader<any>(await readFile(path));
  reader.get('8.8.8.8');
}

async function downloadAndInstall(month: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true });
  const tempGz = join(dirname(targetPath), `.dbip-${month}-${Date.now()}.mmdb.gz.part`);
  const tempDb = join(dirname(targetPath), `.dbip-${month}-${Date.now()}.mmdb.part`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), downloadTimeoutMs());
  try {
    const response = await fetch(downloadUrl(month), {
      signal: controller.signal,
      headers: { 'user-agent': 'NodexPro-Security-GeoIP/1.0' },
    });
    if (!response.ok || !response.body) throw new Error(`dbip_download_failed_${response.status}`);
    const contentLength = Number(response.headers.get('content-length') ?? '0');
    if (contentLength > MAX_COMPRESSED_BYTES) throw new Error('dbip_compressed_size_limit_exceeded');
    await pipeline(
      Readable.fromWeb(response.body as never),
      new ByteLimit(MAX_COMPRESSED_BYTES, 'dbip_compressed'),
      createWriteStream(tempGz),
    );
    await pipeline(
      createReadStream(tempGz),
      createGunzip(),
      new ByteLimit(MAX_DATABASE_BYTES, 'dbip_database'),
      createWriteStream(tempDb),
    );
    await validateDb(tempDb);
    await rename(tempDb, targetPath);
  } finally {
    clearTimeout(timeout);
    await rm(tempGz, { force: true }).catch(() => undefined);
    await rm(tempDb, { force: true }).catch(() => undefined);
  }
}

async function updateDatabase(force: boolean, now = new Date()): Promise<DbIpProvisionStatus> {
  const activePath = activeDbPath();
  if (config.dbIpLite.cityDbPath) {
    const exists = await databaseAgeDays(activePath);
    const status: DbIpProvisionStatus = {
      provider: 'dbip_lite',
      status: exists === null ? 'not_configured' : 'current',
      active_path: activePath,
      last_successful_update_at: exists === null ? null : await readLastSuccess(),
      database_age_days: exists,
      last_error: exists === null ? 'DBIP_CITY_LITE_DB_PATH is configured but unavailable.' : null,
      source_url_template: DOWNLOAD_TEMPLATE,
      attribution: DBIP_ATTRIBUTION_TEXT,
    };
    await writeStatus(status).catch(() => undefined);
    return status;
  }
  if (!force && !(await shouldRefresh(activePath))) {
    const status: DbIpProvisionStatus = {
      provider: 'dbip_lite',
      status: 'current',
      active_path: activePath,
      last_successful_update_at: await readLastSuccess(),
      database_age_days: await databaseAgeDays(activePath),
      last_error: null,
      source_url_template: DOWNLOAD_TEMPLATE,
      attribution: DBIP_ATTRIBUTION_TEXT,
    };
    await writeStatus(status).catch(() => undefined);
    return status;
  }
  const errors: string[] = [];
  for (const month of dbIpCandidateMonths(now)) {
    try {
      await downloadAndInstall(month, activePath);
      readerCache = null;
      const status: DbIpProvisionStatus = {
        provider: 'dbip_lite',
        status: 'updated',
        active_path: activePath,
        last_successful_update_at: new Date().toISOString(),
        database_age_days: await databaseAgeDays(activePath),
        last_error: null,
        source_url_template: DOWNLOAD_TEMPLATE,
        attribution: DBIP_ATTRIBUTION_TEXT,
      };
      await writeStatus(status).catch(() => undefined);
      return status;
    } catch (error) {
      errors.push(`${month}:${safeError(error)}`);
    }
  }
  const status: DbIpProvisionStatus = {
    provider: 'dbip_lite',
    status: (await databaseAgeDays(activePath)) === null ? 'not_configured' : 'failed',
    active_path: activePath,
    last_successful_update_at: await readLastSuccess(),
    database_age_days: await databaseAgeDays(activePath),
    last_error: errors.join('; '),
    source_url_template: DOWNLOAD_TEMPLATE,
    attribution: DBIP_ATTRIBUTION_TEXT,
  };
  await writeStatus(status).catch(() => undefined);
  return status;
}

export async function ensureDbIpLiteDatabase(force = false): Promise<DbIpProvisionStatus> {
  if (!updateInFlight) {
    updateInFlight = updateDatabase(force).finally(() => {
      updateInFlight = null;
    });
  }
  return updateInFlight;
}

async function openReader(): Promise<Reader<any> | null> {
  const path = activeDbPath();
  try {
    const current = await stat(path);
    if (!readerCache || readerCache.path !== path || readerCache.mtimeMs !== current.mtimeMs) {
      readerCache = { path, mtimeMs: current.mtimeMs, reader: new Reader<any>(await readFile(path)) };
    }
    return readerCache.reader;
  } catch {
    return null;
  }
}

function firstKnown(...values: Array<string | number | null | undefined>): string {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return 'Unknown';
}

export async function enrichGeoIp(sourceIp: string | null): Promise<GeoIpEnrichment> {
  if (isPrivateOrReservedIp(sourceIp)) return geoIpUnavailable(sourceIp);
  try {
    const reader = await openReader();
    const record = (reader?.get(sourceIp as string) ?? null) as DbIpCityResponse | null;
    if (!record) return geoIpUnavailable(sourceIp);
    return {
      source_ip: sourceIp,
      country: firstKnown(record.country?.names?.en, record.registered_country?.names?.en),
      country_code: firstKnown(record.country?.iso_code, record.registered_country?.iso_code),
      city: firstKnown(record.city?.names?.en),
      region: firstKnown(record.subdivisions?.[0]?.names?.en, record.subdivisions?.[0]?.iso_code),
      asn: 'Unknown',
      network: 'Unknown',
      risk: 'unknown',
      provider: 'dbip_lite',
      looked_up_at: new Date().toISOString(),
      accuracy_note: 'Approximate DB-IP Lite lookup. This is not exact location, identity, or residential address data.',
    };
  } catch {
    return geoIpUnavailable(sourceIp);
  }
}

export async function writeDbIpLiteProvisioningReadme(targetDir = config.dbIpLite.dataDir): Promise<string> {
  await mkdir(targetDir, { recursive: true });
  const path = join(targetDir, 'README.txt');
  await writeFile(
    path,
    [
      'NodexPro DB-IP Lite local database directory.',
      'Do not commit .mmdb or .mmdb.gz files.',
      'Data source: https://db-ip.com/db/download/ip-to-city-lite',
      DBIP_ATTRIBUTION_TEXT,
      '',
    ].join('\n'),
    'utf8',
  );
  return path;
}
