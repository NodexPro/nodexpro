/**
 * Client import header mapping and row checks. Codes only — no user-facing language.
 * Hebrew and English aliases are recognized regardless of UI locale.
 */

import { isValidIsraeliTeudatZehutChecksum } from '../trial/legal-identity.pure.js';

export const CLIENT_IMPORT_FIELDS = [
  'name',
  'tax_id',
  'email',
  'phone',
  'company_name',
  'address',
  'city',
  'country',
  'notes',
] as const;

export type ClientImportField = (typeof CLIENT_IMPORT_FIELDS)[number];

export type ClientImportIssueCode =
  | 'NAME_MISSING'
  | 'TAX_ID_MISSING'
  | 'TAX_ID_INVALID_FORMAT'
  | 'INVALID_EMAIL'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_IN_ORGANIZATION'
  | 'UNSUPPORTED_FILE_FORMAT'
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_ROWS'
  | 'COLUMN_MAPPING_REQUIRED'
  | 'SHEET_STRUCTURE_INVALID'
  | 'GENERIC';

export type ClientImportColumnMap = Partial<Record<ClientImportField, string>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NAME_ALIASES = new Set([
  'name',
  'full_name',
  'full name',
  'display_name',
  'display name',
  'שם',
  'שם מלא',
  'שם_מלא',
  'שם לקוח',
  'שם_לקוח',
]);

const TAX_ID_ALIASES = new Set([
  'tax_id',
  'tax id',
  'taxid',
  'hp',
  'ח.פ.',
  'ח.פ',
  'חפ',
  'תעודת זהות',
  'תעודת_זהות',
  'ת.ז.',
  'ת.ז',
  'תז',
  'מספר זהות',
  'מספר_זהות',
  'מספר עוסק',
  'מספר_עוסק',
]);

const OPTIONAL_ALIASES: Record<Exclude<ClientImportField, 'name' | 'tax_id'>, string[]> = {
  email: ['email', 'e-mail', 'אימייל', 'דוא"ל', 'דואל', 'דוא׳ל'],
  phone: ['phone', 'tel', 'mobile', 'טלפון', 'פלאפון', 'נייד'],
  company_name: ['company_name', 'company name', 'company', 'legal_name', 'legal name', 'חברה', 'שם חברה', 'שם_חברה'],
  address: ['address', 'street', 'כתובת'],
  city: ['city', 'עיר'],
  country: ['country', 'country_code', 'מדינה'],
  notes: ['notes', 'note', 'הערות', 'הערה'],
};

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function normalizeImportHeader(raw: string): string {
  return stripBom(String(raw ?? ''))
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function fieldForHeader(raw: string): ClientImportField | null {
  const key = normalizeImportHeader(raw);
  if (!key) return null;
  const underscored = key.replace(/\s+/g, '_');
  if (NAME_ALIASES.has(key) || NAME_ALIASES.has(underscored)) return 'name';
  if (TAX_ID_ALIASES.has(key) || TAX_ID_ALIASES.has(underscored)) return 'tax_id';
  for (const [field, aliases] of Object.entries(OPTIONAL_ALIASES) as Array<
    [Exclude<ClientImportField, 'name' | 'tax_id'>, string[]]
  >) {
    if (aliases.some((alias) => alias === key || alias === underscored)) return field;
  }
  return null;
}

export function detectColumnMap(headers: string[]): {
  map: ClientImportColumnMap;
  ambiguous: boolean;
  missingRequired: boolean;
  collisions: ClientImportField[];
} {
  const map: ClientImportColumnMap = {};
  const collisions: ClientImportField[] = [];
  const claimed = new Set<ClientImportField>();
  for (const header of headers) {
    const field = fieldForHeader(header);
    if (!field) continue;
    if (claimed.has(field)) {
      if (!collisions.includes(field)) collisions.push(field);
      continue;
    }
    claimed.add(field);
    map[field] = header;
  }
  const missingRequired = !map.name || !map.tax_id;
  return {
    map,
    ambiguous: collisions.length > 0 || missingRequired,
    missingRequired,
    collisions,
  };
}

export function applyColumnMap(
  headers: string[],
  rows: string[][],
  columnMap: ClientImportColumnMap,
): Record<string, string>[] {
  const indexByHeader = new Map(headers.map((header, index) => [header, index]));
  return rows.map((values) => {
    const row: Record<string, string> = {};
    for (const field of CLIENT_IMPORT_FIELDS) {
      const header = columnMap[field];
      if (!header) {
        row[field] = '';
        continue;
      }
      const index = indexByHeader.get(header);
      row[field] = index == null ? '' : String(values[index] ?? '').trim();
    }
    return row;
  });
}

export function preserveIdentifierText(value: string): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').trim();
}

export function formatExcelNumericIdentifier(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  const asInt = Math.round(value);
  if (Math.abs(value - asInt) < 1e-9) return String(asInt);
  return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 12 });
}

function compactIdentifier(raw: string): string {
  return preserveIdentifierText(raw).replace(/[\s-]/g, '');
}

/** Digit-only 8–9 char Israeli TZ/HP is a known type. Other shapes stay opaque text. */
export function israeliIdentifierDigits(raw: string): string | null {
  const compact = compactIdentifier(raw);
  if (!/^\d{8,9}$/.test(compact)) return null;
  return compact.padStart(9, '0');
}

export function taxIdDuplicateKey(raw: string): string {
  const text = preserveIdentifierText(raw);
  const digits = israeliIdentifierDigits(text);
  return digits ? `d:${digits}` : `t:${text}`;
}

/** Known IL 9-digit TZ/HP checksum. Other shapes stay opaque text. Leading zeros are kept as entered. */
export function validateImportedTaxId(raw: string): ClientImportIssueCode | null {
  const text = preserveIdentifierText(raw);
  if (!text) return 'TAX_ID_MISSING';
  const padded = israeliIdentifierDigits(text);
  if (!padded) return null;
  if (!isValidIsraeliTeudatZehutChecksum(padded)) return 'TAX_ID_INVALID_FORMAT';
  return null;
}

export function validateImportRow(row: Record<string, string>): ClientImportIssueCode[] {
  const issues: ClientImportIssueCode[] = [];
  if (!preserveIdentifierText(row.name ?? '')) issues.push('NAME_MISSING');
  const taxIssue = validateImportedTaxId(row.tax_id ?? '');
  if (taxIssue) issues.push(taxIssue);
  const email = (row.email ?? '').trim();
  if (email && !EMAIL_REGEX.test(email)) issues.push('INVALID_EMAIL');
  return issues;
}

export function fileDuplicateTaxIdIndices(rows: Record<string, string>[]): Set<number> {
  const first = new Map<string, number>();
  const dup = new Set<number>();
  rows.forEach((row, index) => {
    const tax = preserveIdentifierText(row.tax_id ?? '');
    if (!tax) return;
    const key = taxIdDuplicateKey(tax);
    const seen = first.get(key);
    if (seen == null) first.set(key, index);
    else dup.add(index);
  });
  return dup;
}

export function templateHeaders(locale: string): { name: string; tax_id: string } {
  if (locale === 'he') return { name: 'שם מלא', tax_id: 'מספר עוסק' };
  return { name: 'name', tax_id: 'tax_id' };
}

export function parseCsvGrid(csv: string): { headers: string[]; rows: string[][] } {
  const text = stripBom(csv);
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      lines.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  if (current.length) lines.push(current);
  const headers = parseCsvLine(lines[0] ?? '');
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    rows.push(parseCsvLine(lines[i]));
  }
  return { headers, rows };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
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

export function csvFromGrid(headers: string[], rows: string[][]): string {
  const escape = (value: string): string => {
    if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  return [`\uFEFF${headers.map(escape).join(',')}`, ...rows.map((row) => row.map(escape).join(','))].join('\r\n');
}
