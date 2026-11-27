/**
 * Client CSV/Excel import/export. Backend authoritative: validation, duplicate detection, audit.
 * Tenant-safe: all operations scoped to organization_id from context.
 */

import crypto from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import type { RequestContext } from '../../shared/context.js';
import { addTimelineEvent, TIMELINE_SOURCE, TIMELINE_EVENTS } from './timeline.service.js';
import { buildClientSearchText, upsertClientSearchIndex } from './search-index.service.js';
import { assertOfficeAdministration } from '../../shared/office-administration.js';
import {
  applyColumnMap,
  csvFromGrid,
  detectColumnMap,
  fileDuplicateTaxIdIndices,
  israeliIdentifierDigits,
  parseCsvGrid,
  preserveIdentifierText,
  taxIdDuplicateKey,
  templateHeaders,
  validateImportRow,
  type ClientImportColumnMap,
  type ClientImportIssueCode,
} from './client-import-mapping.pure.js';
import { buildXlsxTwoColumnTemplate, parseXlsxFirstSheet } from './client-import-xlsx.pure.js';
import { invalidateClientOperationsRegistryMaterializationCache } from '../client-operations/client-operations-registry-materialization-cache.js';

const ENTITY_TYPE_CLIENT = 'client';
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_ROWS = 10_000;

export type CsvRow = Record<string, string>;

function assertOrg(ctx: RequestContext, orgId: string): void {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
}

function assertClientsWrite(ctx: RequestContext): void {
  const perms = ctx.membership?.permissions ?? [];
  if (!perms.includes('clients:write')) throw forbidden('Insufficient permission');
}

const BULK_EXPORT_MAX_IDS = 2000;

export type ImportFileInput = {
  csv?: string;
  filename?: string;
  file_base64?: string;
  column_map?: ClientImportColumnMap;
};

function fileKind(filename: string | undefined, csv: string | undefined): 'csv' | 'xlsx' {
  const name = String(filename ?? '').toLowerCase();
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (name.endsWith('.csv') || csv) return 'csv';
  if (name) throw badRequest('Unsupported file format', 'UNSUPPORTED_FILE_FORMAT');
  return 'csv';
}

function decodeBase64File(fileBase64: string): Buffer {
  const buf = Buffer.from(fileBase64, 'base64');
  if (!buf.length) throw badRequest('Unsupported file format', 'UNSUPPORTED_FILE_FORMAT');
  if (buf.length > MAX_FILE_BYTES) throw badRequest('File too large', 'FILE_TOO_LARGE');
  return buf;
}

function parseImportGrid(input: ImportFileInput): { headers: string[]; rows: string[][] } {
  const kind = fileKind(input.filename, input.csv);
  if (kind === 'xlsx') {
    if (!input.file_base64) throw badRequest('Unsupported file format', 'UNSUPPORTED_FILE_FORMAT');
    const buf = decodeBase64File(input.file_base64);
    try {
      return parseXlsxFirstSheet(buf);
    } catch {
      throw badRequest('Excel sheet structure is invalid', 'SHEET_STRUCTURE_INVALID');
    }
  }
  const csv = input.csv ?? (input.file_base64 ? decodeBase64File(input.file_base64).toString('utf8') : '');
  if (Buffer.byteLength(csv, 'utf8') > MAX_FILE_BYTES) throw badRequest('File too large', 'FILE_TOO_LARGE');
  return parseCsvGrid(csv);
}

/** Kept for existing CSV callers/tests: auto-mapped rows from a CSV string. */
export function parseCsv(csv: string): CsvRow[] {
  const grid = parseCsvGrid(csv);
  const detected = detectColumnMap(grid.headers);
  return applyColumnMap(grid.headers, grid.rows.slice(0, MAX_ROWS), detected.map);
}

async function findOrgDuplicateTaxIds(orgId: string, rows: CsvRow[]): Promise<Set<string>> {
  const lookup = new Set<string>();
  for (const row of rows) {
    const tax = preserveIdentifierText(row.tax_id ?? '');
    if (!tax) continue;
    lookup.add(tax);
    const digits = israeliIdentifierDigits(tax);
    if (digits) lookup.add(digits);
  }
  if (!lookup.size) return new Set();
  const { data } = await supabaseAdmin.from('clients').select('tax_id').eq('organization_id', orgId).in('tax_id', [...lookup]);
  return new Set((data ?? []).map((row: { tax_id: string }) => taxIdDuplicateKey(row.tax_id)));
}

export interface PreviewRow {
  row_index: number;
  name: string;
  email: string;
  phone: string;
  company_name: string;
  tax_id: string;
  address: string;
  city: string;
  country: string;
  notes: string;
  reason_code?: ClientImportIssueCode;
}

export interface ImportPreviewResult {
  valid_rows: PreviewRow[];
  duplicates: PreviewRow[];
  invalid_rows: { row_index: number; codes: ClientImportIssueCode[]; name: string; tax_id: string }[];
  needs_column_mapping: boolean;
  headers: string[];
  suggested_map: ClientImportColumnMap;
  new_count: number;
  duplicate_count: number;
  invalid_count: number;
}

function toPreviewRow(row: CsvRow, rowIndex: number, reason_code?: ClientImportIssueCode): PreviewRow {
  return {
    row_index: rowIndex + 1,
    name: preserveIdentifierText(row.name ?? ''),
    email: (row.email ?? '').trim(),
    phone: (row.phone ?? '').trim(),
    company_name: (row.company_name ?? '').trim(),
    tax_id: preserveIdentifierText(row.tax_id ?? ''),
    address: (row.address ?? '').trim(),
    city: (row.city ?? '').trim(),
    country: (row.country ?? '').trim(),
    notes: (row.notes ?? '').trim(),
    reason_code,
  };
}

function classifyRows(rows: CsvRow[], orgTaxIds: Set<string>, fileDup: Set<number>) {
  const valid_rows: PreviewRow[] = [];
  const duplicates: PreviewRow[] = [];
  const invalid_rows: ImportPreviewResult['invalid_rows'] = [];
  rows.forEach((row, index) => {
    const issues = validateImportRow(row);
    const preview = toPreviewRow(row, index);
    if (issues.length) {
      invalid_rows.push({ row_index: index + 1, codes: issues, name: preview.name, tax_id: preview.tax_id });
      return;
    }
    if (fileDup.has(index)) {
      duplicates.push({ ...preview, reason_code: 'DUPLICATE_IN_FILE' });
      return;
    }
    if (orgTaxIds.has(taxIdDuplicateKey(preview.tax_id))) {
      duplicates.push({ ...preview, reason_code: 'DUPLICATE_IN_ORGANIZATION' });
      return;
    }
    valid_rows.push(preview);
  });
  return { valid_rows, duplicates, invalid_rows };
}

export async function previewImport(ctx: RequestContext, orgId: string, input: ImportFileInput | string): Promise<ImportPreviewResult> {
  assertOrg(ctx, orgId);
  assertClientsWrite(ctx);
  assertOfficeAdministration(ctx);

  const source: ImportFileInput = typeof input === 'string' ? { csv: input } : input;
  const grid = parseImportGrid(source);
  if (grid.rows.length > MAX_ROWS) throw badRequest('Too many rows', 'TOO_MANY_ROWS');
  const detected = detectColumnMap(grid.headers);
  const userMap = source.column_map?.name && source.column_map?.tax_id ? source.column_map : null;
  const requiredCollision = detected.collisions.some((field) => field === 'name' || field === 'tax_id');
  if (!userMap && (detected.missingRequired || requiredCollision)) {
    return {
      valid_rows: [],
      duplicates: [],
      invalid_rows: [],
      needs_column_mapping: true,
      headers: grid.headers,
      suggested_map: detected.map,
      new_count: 0,
      duplicate_count: 0,
      invalid_count: 0,
    };
  }
  const columnMap = userMap ?? detected.map;
  const rows = applyColumnMap(grid.headers, grid.rows, columnMap);
  const fileDup = fileDuplicateTaxIdIndices(rows);
  const orgTaxIds = await findOrgDuplicateTaxIds(orgId, rows);
  const classified = classifyRows(rows, orgTaxIds, fileDup);
  return {
    ...classified,
    needs_column_mapping: false,
    headers: grid.headers,
    suggested_map: columnMap,
    new_count: classified.valid_rows.length,
    duplicate_count: classified.duplicates.length,
    invalid_count: classified.invalid_rows.length,
  };
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: { row_index: number; code: ClientImportIssueCode }[];
  clients_list?: unknown;
}

export async function executeImport(ctx: RequestContext, orgId: string, input: ImportFileInput | string): Promise<ImportResult> {
  assertOrg(ctx, orgId);
  assertClientsWrite(ctx);
  assertOfficeAdministration(ctx);

  const source: ImportFileInput = typeof input === 'string' ? { csv: input } : input;
  const preview = await previewImport(ctx, orgId, source);
  if (preview.needs_column_mapping) throw badRequest('Column mapping required', 'COLUMN_MAPPING_REQUIRED');

  const grid = parseImportGrid(source);
  const columnMap = source.column_map?.name && source.column_map?.tax_id ? source.column_map : detectColumnMap(grid.headers).map;
  const rows = applyColumnMap(grid.headers, grid.rows, columnMap);
  const allowed = new Set(preview.valid_rows.map((row) => row.row_index));
  let imported = 0;
  const errors: ImportResult['errors'] = preview.invalid_rows.map((row) => ({
    row_index: row.row_index,
    code: row.codes[0] ?? 'NAME_MISSING',
  }));

  for (let i = 0; i < rows.length; i++) {
    if (!allowed.has(i + 1)) continue;
    const row = rows[i];
    const name = preserveIdentifierText(row.name ?? '');
    const taxId = preserveIdentifierText(row.tax_id ?? '');
    const countryCode = (row.country ?? '').trim().slice(0, 2) || null;
    const { data: client, error } = await supabaseAdmin
      .from('clients')
      .insert({
        organization_id: orgId,
        tax_id: taxId,
        display_name: name,
        legal_name: (row.company_name ?? '').trim() || null,
        email: (row.email ?? '').trim() || null,
        phone: (row.phone ?? '').trim() || null,
        country_code: countryCode,
        address: (row.address ?? '').trim() || null,
        city: (row.city ?? '').trim() || null,
        notes: (row.notes ?? '').trim() || null,
        status: 'active',
        lifecycle_state: 'lead',
        created_by: ctx.user.id,
      })
      .select()
      .single();

    if (error || !client) {
      const duplicate = error?.code === '23505' || /duplicate|unique/i.test(error?.message ?? '');
      errors.push({ row_index: i + 1, code: duplicate ? 'DUPLICATE_IN_ORGANIZATION' : 'GENERIC' });
      continue;
    }

    await upsertClientSearchIndex(orgId, client.id, buildClientSearchText(client));
    await addTimelineEvent({
      organizationId: orgId,
      entityType: ENTITY_TYPE_CLIENT,
      entityId: client.id,
      eventType: TIMELINE_EVENTS.CLIENT_CREATED,
      sourceType: TIMELINE_SOURCE.SYSTEM,
      sourceModule: 'shared',
      actorUserId: ctx.user.id,
      payload: { display_name: (client as { display_name: string }).display_name, source: 'import' },
    });
    imported++;
  }

  if (imported > 0) invalidateClientOperationsRegistryMaterializationCache(orgId);

  const skipped = preview.duplicate_count;
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(JSON.stringify({ orgId, tax_ids: preview.valid_rows.map((row) => row.tax_id) }))
    .digest('hex');

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    entityType: 'client',
    entityId: null,
    action: AUDIT_ACTIONS.CLIENTS_IMPORT,
    payload: {
      imported_count: imported,
      skipped_count: skipped,
      invalid_count: preview.invalid_count,
      total_rows: rows.length,
      idempotency_key: idempotencyKey,
      timestamp: new Date().toISOString(),
    },
  });

  const { listClients } = await import('./clients.service.js');
  const clients_list = await listClients(ctx, orgId, { view: 'all', limit: 20, offset: 0 });
  return { imported, skipped, errors, clients_list };
}

export function buildImportTemplate(locale: string, format: 'csv' | 'xlsx'): { body: Buffer; contentType: string; filename: string } {
  const headers = templateHeaders(locale === 'he' ? 'he' : 'en');
  if (format === 'xlsx') {
    return {
      body: Buffer.from(buildXlsxTwoColumnTemplate([headers.name, headers.tax_id])),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: locale === 'he' ? 'clients-import-template-he.xlsx' : 'clients-import-template.xlsx',
    };
  }
  return {
    body: Buffer.from(csvFromGrid([headers.name, headers.tax_id], []), 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    filename: locale === 'he' ? 'clients-import-template-he.csv' : 'clients-import-template.csv',
  };
}

/**
 * Export clients for organization as CSV. Tenant-scoped.
 */
export async function exportClientsCsv(ctx: RequestContext, orgId: string): Promise<string> {
  assertOrg(ctx, orgId);
  assertClientsWrite(ctx);

  const {
    resolveOrganizationClientAccessScopeFromContext,
    filterAuthorizedClientIds,
  } = await import('../client-operations/organization-client-access.js');
  const accessScope = await resolveOrganizationClientAccessScopeFromContext(ctx);
  if (accessScope.authorized_client_ids && accessScope.authorized_client_ids.length === 0) {
    return 'name,email,phone,company_name,tax_id,address,city,country,notes\r\n';
  }

  let query = supabaseAdmin
    .from('clients')
    .select('id, display_name, email, phone, legal_name, tax_id, address, city, country_code, notes')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('display_name');
  if (accessScope.authorized_client_ids) {
    const ids = filterAuthorizedClientIds(accessScope, accessScope.authorized_client_ids);
    if (ids.length === 0) {
      return 'name,email,phone,company_name,tax_id,address,city,country,notes\r\n';
    }
    query = query.in('id', ids);
  }

  const { data: clients } = await query;

  const rows = (clients ?? []) as Array<{
    display_name: string;
    email: string | null;
    phone: string | null;
    legal_name: string | null;
    tax_id: string;
    address: string | null;
    city: string | null;
    country_code: string | null;
    notes: string | null;
  }>;

  const header = 'name,email,phone,company_name,tax_id,address,city,country,notes';
  const escape = (v: string | null | undefined): string => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    header,
    ...rows.map((r) =>
      [
        escape(r.display_name),
        escape(r.email),
        escape(r.phone),
        escape(r.legal_name),
        escape(r.tax_id),
        escape(r.address),
        escape(r.city),
        escape(r.country_code),
        escape(r.notes),
      ].join(',')
    ),
  ];
  return lines.join('\r\n');
}

/**
 * Export selected clients as CSV by id. Tenant-scoped; only clients in org are exported.
 */
export async function exportSelectedClientsCsv(
  ctx: RequestContext,
  orgId: string,
  clientIds: string[]
): Promise<string> {
  assertOrg(ctx, orgId);
  assertClientsWrite(ctx);

  const idsRaw = clientIds.filter((id) => typeof id === 'string' && id.trim().length > 0).slice(0, BULK_EXPORT_MAX_IDS);
  if (idsRaw.length === 0) {
    const header = 'name,email,phone,company_name,tax_id,address,city,country,notes';
    return header + '\r\n';
  }

  const {
    resolveOrganizationClientAccessScopeFromContext,
    filterAuthorizedClientIds,
  } = await import('../client-operations/organization-client-access.js');
  const accessScope = await resolveOrganizationClientAccessScopeFromContext(ctx);
  const ids = filterAuthorizedClientIds(accessScope, idsRaw);
  if (ids.length === 0) {
    const header = 'name,email,phone,company_name,tax_id,address,city,country,notes';
    return header + '\r\n';
  }

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('display_name, email, phone, legal_name, tax_id, address, city, country_code, notes')
    .eq('organization_id', orgId)
    .in('id', ids)
    .order('display_name');

  const rows = (clients ?? []) as Array<{
    display_name: string;
    email: string | null;
    phone: string | null;
    legal_name: string | null;
    tax_id: string;
    address: string | null;
    city: string | null;
    country_code: string | null;
    notes: string | null;
  }>;

  const header = 'name,email,phone,company_name,tax_id,address,city,country,notes';
  const escape = (v: string | null | undefined): string => {
    if (v == null) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    header,
    ...rows.map((r) =>
      [
        escape(r.display_name),
        escape(r.email),
        escape(r.phone),
        escape(r.legal_name),
        escape(r.tax_id),
        escape(r.address),
        escape(r.city),
        escape(r.country_code),
        escape(r.notes),
      ].join(',')
    ),
  ];
  return lines.join('\r\n');
}
