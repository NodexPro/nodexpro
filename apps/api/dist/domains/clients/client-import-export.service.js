/**
 * Client CSV import/export. Backend authoritative: validation, duplicate detection, audit.
 * Tenant-safe: all operations scoped to organization_id from context.
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden, badRequest } from '../../shared/errors.js';
import { writeAudit, AUDIT_ACTIONS } from '../../shared/audit-events.js';
import { addTimelineEvent, TIMELINE_SOURCE, TIMELINE_EVENTS } from './timeline.service.js';
import { buildClientSearchText, upsertClientSearchIndex } from './search-index.service.js';
const ENTITY_TYPE_CLIENT = 'client';
const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_ROWS = 10_000;
function assertOrg(ctx, orgId) {
    if (ctx.organizationId !== orgId)
        throw forbidden('Organization context required');
}
function assertClientsWrite(ctx) {
    const perms = ctx.membership?.permissions ?? [];
    if (!perms.includes('clients:write'))
        throw forbidden('Insufficient permission');
}
const BULK_EXPORT_MAX_IDS = 2000;
/**
 * Parse CSV string into rows of key-value objects. First row = headers (normalized to lowercase).
 * Handles quoted fields and limits rows.
 */
export function parseCsv(csv) {
    const lines = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < csv.length; i++) {
        const c = csv[i];
        if (c === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes && (c === '\n' || c === '\r')) {
            if (c === '\r' && csv[i + 1] === '\n')
                i++;
            lines.push(current);
            current = '';
            continue;
        }
        current += c;
    }
    if (current.length)
        lines.push(current);
    const rows = [];
    const rawHeaders = lines[0]?.split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase()) ?? [];
    const headerMap = rawHeaders.map((h) => h.replace(/\s+/g, '_')); // "company name" -> company_name
    for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
        const values = parseCsvLine(lines[i]);
        const row = {};
        headerMap.forEach((key, j) => {
            row[key] = values[j]?.trim() ?? '';
        });
        if (Object.keys(row).length)
            rows.push(row);
    }
    return rows;
}
function parseCsvLine(line) {
    const out = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes && c === ',') {
            out.push(current.trim());
            current = '';
            continue;
        }
        current += c;
    }
    out.push(current.trim());
    return out;
}
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validateRow(row, index) {
    const errors = [];
    const name = (row.name ?? row.display_name ?? '').trim();
    if (!name)
        errors.push('name is required');
    const email = (row.email ?? '').trim();
    if (email && !EMAIL_REGEX.test(email))
        errors.push('invalid email format');
    return { valid: errors.length === 0, errors };
}
/**
 * Find existing clients in org that match any of the given rows by (email OR phone OR tax_id).
 * Returns Set of row indices (0-based) that are duplicates.
 */
async function findDuplicateRowIndices(orgId, rows) {
    const emails = new Set();
    const phones = new Set();
    const taxIds = new Set();
    rows.forEach((r, i) => {
        const e = (r.email ?? '').trim();
        const p = (r.phone ?? '').trim();
        const t = (r.tax_id ?? '').trim();
        if (e)
            emails.add(e);
        if (p)
            phones.add(p);
        if (t)
            taxIds.add(t);
    });
    const existingByEmail = emails.size
        ? await supabaseAdmin.from('clients').select('email').eq('organization_id', orgId).eq('is_archived', false).in('email', [...emails])
        : { data: [] };
    const existingByPhone = phones.size
        ? await supabaseAdmin.from('clients').select('phone').eq('organization_id', orgId).eq('is_archived', false).in('phone', [...phones])
        : { data: [] };
    const existingByTaxId = taxIds.size
        ? await supabaseAdmin.from('clients').select('tax_id').eq('organization_id', orgId).in('tax_id', [...taxIds])
        : { data: [] };
    const existingEmails = new Set((existingByEmail.data ?? []).map((x) => x.email).filter(Boolean));
    const existingPhones = new Set((existingByPhone.data ?? []).map((x) => x.phone).filter(Boolean));
    const existingTaxIds = new Set((existingByTaxId.data ?? []).map((x) => x.tax_id));
    const duplicateIndices = new Set();
    rows.forEach((r, i) => {
        const e = (r.email ?? '').trim();
        const p = (r.phone ?? '').trim();
        const t = (r.tax_id ?? '').trim();
        if ((e && existingEmails.has(e)) || (p && existingPhones.has(p)) || (t && existingTaxIds.has(t)))
            duplicateIndices.add(i);
    });
    return duplicateIndices;
}
export async function previewImport(ctx, orgId, csv) {
    assertOrg(ctx, orgId);
    assertClientsWrite(ctx);
    if (Buffer.byteLength(csv, 'utf8') > MAX_FILE_BYTES)
        throw badRequest(`CSV too large. Max ${MAX_FILE_BYTES / 1024}KB`);
    const rows = parseCsv(csv);
    if (rows.length > MAX_ROWS)
        throw badRequest(`Too many rows. Max ${MAX_ROWS}`);
    const valid_rows = [];
    const invalid_rows = [];
    rows.forEach((row, i) => {
        const { valid, errors } = validateRow(row, i);
        const previewRow = toPreviewRow(row, i);
        if (valid)
            valid_rows.push(previewRow);
        else
            invalid_rows.push({ row_index: i + 1, errors, raw: row });
    });
    const duplicateIndices = await findDuplicateRowIndices(orgId, rows);
    const duplicates = [];
    const validNonDup = [];
    valid_rows.forEach((r) => {
        const idx = r.row_index;
        if (duplicateIndices.has(idx)) {
            duplicates.push({ ...r, reason: 'Duplicate (email, phone, or tax_id exists)' });
        }
        else {
            validNonDup.push(r);
        }
    });
    return {
        valid_rows: validNonDup,
        duplicates,
        invalid_rows,
    };
}
function toPreviewRow(row, rowIndex) {
    return {
        row_index: rowIndex + 1,
        name: (row.name ?? row.display_name ?? '').trim(),
        email: (row.email ?? '').trim(),
        phone: (row.phone ?? '').trim(),
        company_name: (row.company_name ?? row.legal_name ?? '').trim(),
        tax_id: (row.tax_id ?? '').trim(),
        address: (row.address ?? '').trim(),
        city: (row.city ?? '').trim(),
        country: (row.country ?? '').trim(),
        notes: (row.notes ?? '').trim(),
    };
}
export async function executeImport(ctx, orgId, csv) {
    assertOrg(ctx, orgId);
    assertClientsWrite(ctx);
    if (Buffer.byteLength(csv, 'utf8') > MAX_FILE_BYTES)
        throw badRequest(`CSV too large. Max ${MAX_FILE_BYTES / 1024}KB`);
    const rows = parseCsv(csv);
    if (rows.length > MAX_ROWS)
        throw badRequest(`Too many rows. Max ${MAX_ROWS}`);
    const duplicateIndices = await findDuplicateRowIndices(orgId, rows);
    let imported = 0;
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const { valid, errors: errs } = validateRow(row, i);
        if (!valid) {
            errors.push({ row_index: i + 1, message: errs.join('; ') });
            continue;
        }
        if (duplicateIndices.has(i))
            continue; // skip duplicate
        const name = (row.name ?? row.display_name ?? '').trim();
        const taxIdRaw = (row.tax_id ?? '').trim();
        const taxId = taxIdRaw || `IMP-${Date.now()}-${i}`;
        const countryCode = (row.country ?? '').trim().slice(0, 2) || null;
        const { data: existing } = await supabaseAdmin
            .from('clients')
            .select('id')
            .eq('organization_id', orgId)
            .eq('tax_id', taxId)
            .maybeSingle();
        if (existing) {
            errors.push({ row_index: i + 1, message: 'Duplicate tax_id' });
            continue;
        }
        const emailVal = (row.email ?? '').trim();
        const phoneVal = (row.phone ?? '').trim();
        if (!emailVal && !phoneVal) {
            errors.push({ row_index: i + 1, message: 'Client must have at least one contact method: phone or email.' });
            continue;
        }
        const { data: client, error } = await supabaseAdmin
            .from('clients')
            .insert({
            organization_id: orgId,
            tax_id: taxId,
            client_type: 'business_customer',
            display_name: name,
            legal_name: (row.company_name ?? row.legal_name ?? '').trim() || null,
            email: emailVal || null,
            phone: phoneVal || null,
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
            errors.push({ row_index: i + 1, message: error?.message ?? 'Insert failed' });
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
            payload: { display_name: client.display_name, source: 'import' },
        });
        imported++;
    }
    const skipped = duplicateIndices.size;
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        entityType: 'client',
        entityId: null,
        action: AUDIT_ACTIONS.CLIENTS_IMPORT,
        payload: {
            imported_count: imported,
            skipped_count: skipped,
            invalid_count: errors.length,
            total_rows: rows.length,
            timestamp: new Date().toISOString(),
        },
    });
    return { imported, skipped, errors };
}
/**
 * Export clients for organization as CSV. Tenant-scoped.
 */
export async function exportClientsCsv(ctx, orgId) {
    assertOrg(ctx, orgId);
    assertClientsWrite(ctx);
    const { data: clients } = await supabaseAdmin
        .from('clients')
        .select('display_name, email, phone, legal_name, tax_id, address, city, country_code, notes')
        .eq('organization_id', orgId)
        .eq('is_archived', false)
        .order('display_name');
    const rows = (clients ?? []);
    const header = 'name,email,phone,company_name,tax_id,address,city,country,notes';
    const escape = (v) => {
        if (v == null)
            return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n'))
            return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    const lines = [
        header,
        ...rows.map((r) => [
            escape(r.display_name),
            escape(r.email),
            escape(r.phone),
            escape(r.legal_name),
            escape(r.tax_id),
            escape(r.address),
            escape(r.city),
            escape(r.country_code),
            escape(r.notes),
        ].join(',')),
    ];
    return lines.join('\r\n');
}
/**
 * Export selected clients as CSV by id. Tenant-scoped; only clients in org are exported.
 */
export async function exportSelectedClientsCsv(ctx, orgId, clientIds) {
    assertOrg(ctx, orgId);
    assertClientsWrite(ctx);
    const ids = clientIds.filter((id) => typeof id === 'string' && id.trim().length > 0).slice(0, BULK_EXPORT_MAX_IDS);
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
    const rows = (clients ?? []);
    const header = 'name,email,phone,company_name,tax_id,address,city,country,notes';
    const escape = (v) => {
        if (v == null)
            return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n'))
            return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    const lines = [
        header,
        ...rows.map((r) => [
            escape(r.display_name),
            escape(r.email),
            escape(r.phone),
            escape(r.legal_name),
            escape(r.tax_id),
            escape(r.address),
            escape(r.city),
            escape(r.country_code),
            escape(r.notes),
        ].join(',')),
    ];
    return lines.join('\r\n');
}
