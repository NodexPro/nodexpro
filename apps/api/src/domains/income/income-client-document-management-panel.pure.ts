/**
 * Pure helpers for Income client document management panel grouping.
 */

export type OfficeClientDocumentScopeRow = {
  represented_client_id: string | null;
  issuer_business_id: string;
  acting_mode: string;
  /** When set, document belongs to end-customer population — not the office-client row. */
  income_customer_id?: string | null;
};

export type IncomeClientDocumentManagementPopulationKey =
  | 'office_client'
  | 'office_client_customer';

/**
 * Canonical visual action-slot order for Invoice CDM **office** rows.
 * Retainer slot is present only when the panel includes retainer actions.
 */
export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEYS_BASE = [
  'open_branding_studio',
  'open_end_customers',
  'open_reports',
  'open_income_ledger_card',
  'open_email_history',
] as const;

/**
 * Work Engine invoices office_clients rows: omit customer-list + document-settings
 * entrypoints (settings live on section.header_actions with office self issuer).
 * Issuer-group /m/income office rows keep those actions.
 */
export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEYS_WE_OFFICE = [
  'open_reports',
  'open_income_ledger_card',
  'open_email_history',
] as const;

/**
 * Issuer/group-level actions for end-customer population parents (e.g. Test3).
 * Document settings + customer list + issuer-scoped reports live here — not on recipient rows.
 */
export const INCOME_CDM_ISSUER_GROUP_ACTION_SLOT_KEYS = [
  'open_branding_studio',
  'open_end_customers',
  'open_reports',
] as const;

/**
 * Recipient/end-customer row slots (WE invoices).
 * Issuer-owned settings/customers are omitted; reports + email stay recipient-scoped.
 */
export const INCOME_CDM_END_CUSTOMER_ROW_ACTION_SLOT_KEYS_BASE = [
  'open_reports',
  'open_income_ledger_card',
  'open_email_history',
] as const;

export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_RETAINER = 'open_invoice_retainer_setup' as const;
export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_MORE = 'more' as const;
/** Work Engine invoices tab: replaces `more` with new-document action. */
export const INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_NEW_DOCUMENT = 'open_new_income_document' as const;

export function incomeCdmCanonicalActionSlotKeys(
  includeRetainer: boolean,
  options?: {
    newDocumentInsteadOfMore?: boolean;
    omitEndCustomersAction?: boolean;
    omitBrandingStudioAction?: boolean;
  },
): string[] {
  const trailing = options?.newDocumentInsteadOfMore
    ? INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_NEW_DOCUMENT
    : INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_MORE;
  let base: string[] = options?.omitEndCustomersAction
    ? [...INCOME_CDM_CANONICAL_ACTION_SLOT_KEYS_WE_OFFICE]
    : [...INCOME_CDM_CANONICAL_ACTION_SLOT_KEYS_BASE];
  if (options?.omitBrandingStudioAction) {
    base = base.filter((key) => key !== 'open_branding_studio');
  }
  return [
    ...base,
    ...(includeRetainer ? [INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_RETAINER] : []),
    trailing,
  ];
}

/** Recipient-row slot keys for WE invoices (issuer settings/customers live on the group). */
export function incomeCdmEndCustomerRowActionSlotKeys(
  includeRetainer: boolean,
  options?: { newDocumentInsteadOfMore?: boolean },
): string[] {
  const trailing = options?.newDocumentInsteadOfMore
    ? INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_NEW_DOCUMENT
    : INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_MORE;
  return [
    ...INCOME_CDM_END_CUSTOMER_ROW_ACTION_SLOT_KEYS_BASE,
    ...(includeRetainer ? [INCOME_CDM_CANONICAL_ACTION_SLOT_KEY_RETAINER] : []),
    trailing,
  ];
}

export function incomeCdmActionKeysMatchCanonical(
  actionKeys: string[],
  includeRetainer: boolean,
  options?: {
    newDocumentInsteadOfMore?: boolean;
    omitEndCustomersAction?: boolean;
    omitBrandingStudioAction?: boolean;
  },
): boolean {
  const expected = incomeCdmCanonicalActionSlotKeys(includeRetainer, options);
  if (actionKeys.length !== expected.length) return false;
  return actionKeys.every((key, index) => key === expected[index]);
}

export type IncomeClientDocumentReportScope = 'issuer' | 'recipient';

export type IncomeClientDocumentReportCatalogItem = {
  key: string;
  label: string;
  enabled: boolean;
  disabled_reason: string | null;
};

/**
 * Backend-owned report catalogs for WE invoices CDM.
 * Bodies remain disabled until canonical AB / Income report aggregates exist.
 * Frontend must render this list as returned — do not invent income at recipient scope.
 */
export function buildIncomeClientDocumentReportCatalog(
  scope: IncomeClientDocumentReportScope,
): IncomeClientDocumentReportCatalogItem[] {
  const blockedAbIncome =
    'BLOCKED: אין read model מוכן לדוח הכנסות לפי מנפיק+תקופה מ-Accounting Base (accounting_entries)';
  const blockedArSemantics =
    'BLOCKED: A/R קיים (accounts_receivable) אך חסרה סמנטיקת תקופה מאושרת + סינון recipient מפורש למרכז הדוחות';
  const blockedReceipts =
    'BLOCKED: אין דוח קבלות/תשלומים לפי תקופה — allocations קיימים per-invoice בלבד';
  const blockedDocuments =
    'BLOCKED: documents-by-type קיים לפי שנה/סוג; חסר דוח תקופתי חודש/טווח לכל הסוגים';
  const blockedCancelled =
    'BLOCKED: cancelled_future + cancelled_at קיימים במסמכים; חסר דוח תקופתי ייעודי';

  const unpaid: IncomeClientDocumentReportCatalogItem = {
    key: 'unpaid_outstanding',
    label: 'דוח חובות / טרם שילמו',
    enabled: false,
    disabled_reason: blockedArSemantics,
  };
  const receipts: IncomeClientDocumentReportCatalogItem = {
    key: 'receipts',
    label: 'דוח קבלות',
    enabled: false,
    disabled_reason: blockedReceipts,
  };
  const documents: IncomeClientDocumentReportCatalogItem = {
    key: 'documents',
    label: 'דוח מסמכים',
    enabled: false,
    disabled_reason: blockedDocuments,
  };
  const cancelled: IncomeClientDocumentReportCatalogItem = {
    key: 'cancelled_documents',
    label: 'דוח מסמכים שבוטלו',
    enabled: false,
    disabled_reason: blockedCancelled,
  };

  if (scope === 'issuer') {
    return [
      {
        key: 'income_summary',
        label: 'דוח הכנסות',
        enabled: false,
        disabled_reason: blockedAbIncome,
      },
      unpaid,
      receipts,
      documents,
      cancelled,
    ];
  }

  return [unpaid, receipts, documents, cancelled];
}

export type IncomeClientDocumentReportPeriodMode = 'month' | 'range';

export type IncomeClientDocumentReportPeriodInput =
  | { mode: 'month'; month: number; year: number }
  | {
      mode: 'range';
      from_month: number;
      from_year: number;
      to_month: number;
      to_year: number;
    };

export type IncomeClientDocumentReportPeriodNormalized = {
  mode: IncomeClientDocumentReportPeriodMode;
  from_month: number;
  from_year: number;
  to_month: number;
  to_year: number;
  /** Inclusive ISO date YYYY-MM-DD (UTC calendar month bounds). */
  normalized_from: string;
  normalized_to: string;
};

function assertMonthYear(month: number, year: number, label: string): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`${label}: month must be 1–12`);
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`${label}: year out of supported range`);
  }
}

function monthStartIso(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function monthEndIso(year: number, month: number): string {
  // Day 0 of next month = last day of this month (UTC).
  const end = new Date(Date.UTC(year, month, 0));
  const y = end.getUTCFullYear();
  const m = String(end.getUTCMonth() + 1).padStart(2, '0');
  const d = String(end.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ymKey(year: number, month: number): number {
  return year * 12 + month;
}

/**
 * Normalize report period for future report aggregates.
 * Deterministic UTC calendar month bounds — no browser-local heuristics.
 */
export function normalizeIncomeClientDocumentReportPeriod(
  input: IncomeClientDocumentReportPeriodInput,
): IncomeClientDocumentReportPeriodNormalized {
  if (input.mode === 'month') {
    assertMonthYear(input.month, input.year, 'month');
    return {
      mode: 'month',
      from_month: input.month,
      from_year: input.year,
      to_month: input.month,
      to_year: input.year,
      normalized_from: monthStartIso(input.year, input.month),
      normalized_to: monthEndIso(input.year, input.month),
    };
  }

  assertMonthYear(input.from_month, input.from_year, 'from');
  assertMonthYear(input.to_month, input.to_year, 'to');
  if (ymKey(input.from_year, input.from_month) > ymKey(input.to_year, input.to_month)) {
    throw new Error('range: from must be <= to');
  }
  return {
    mode: 'range',
    from_month: input.from_month,
    from_year: input.from_year,
    to_month: input.to_month,
    to_year: input.to_year,
    normalized_from: monthStartIso(input.from_year, input.from_month),
    normalized_to: monthEndIso(input.to_year, input.to_month),
  };
}

/** Stable dual-identity key: parent office client + end customer. */
export function endCustomerPopulationKey(params: {
  representedClientId: string;
  incomeCustomerId: string;
}): string {
  return `${params.representedClientId}::${params.incomeCustomerId}`;
}

/** Zero document-management counters for an office client with no stats row. */
export function zeroOfficeClientDocumentStat(representedClientId: string): {
  represented_client_id: string;
  total_documents_count: number;
  draft_documents_count: number;
  quote_count: number;
  deal_count: number;
  tax_invoice_count: number;
  receipt_count: number;
  credit_count: number;
  quote_issued_count: number;
  deal_issued_count: number;
  tax_invoice_issued_count: number;
  tax_invoice_receipt_issued_count: number;
  receipt_issued_count: number;
  credit_issued_count: number;
  last_document_date: string | null;
  last_activity_at: string | null;
  unpaid_reference: number | null;
  currency: string | null;
} {
  return {
    represented_client_id: representedClientId,
    total_documents_count: 0,
    draft_documents_count: 0,
    quote_count: 0,
    deal_count: 0,
    tax_invoice_count: 0,
    receipt_count: 0,
    credit_count: 0,
    quote_issued_count: 0,
    deal_issued_count: 0,
    tax_invoice_issued_count: 0,
    tax_invoice_receipt_issued_count: 0,
    receipt_issued_count: 0,
    credit_issued_count: 0,
    last_document_date: null,
    last_activity_at: null,
    unpaid_reference: null,
    currency: null,
  };
}

/** Zero counters for an end customer with no stats row (population still includes the customer). */
export function zeroEndCustomerDocumentStat(params: {
  representedClientId: string;
  incomeCustomerId: string;
}): {
  represented_client_id: string;
  income_customer_id: string;
  total_documents_count: number;
  draft_documents_count: number;
  quote_count: number;
  deal_count: number;
  tax_invoice_count: number;
  receipt_count: number;
  credit_count: number;
  quote_issued_count: number;
  deal_issued_count: number;
  tax_invoice_issued_count: number;
  tax_invoice_receipt_issued_count: number;
  receipt_issued_count: number;
  credit_issued_count: number;
  last_document_date: string | null;
  last_activity_at: string | null;
  unpaid_reference: number | null;
  currency: string | null;
} {
  return {
    represented_client_id: params.representedClientId,
    income_customer_id: params.incomeCustomerId,
    total_documents_count: 0,
    draft_documents_count: 0,
    quote_count: 0,
    deal_count: 0,
    tax_invoice_count: 0,
    receipt_count: 0,
    credit_count: 0,
    quote_issued_count: 0,
    deal_issued_count: 0,
    tax_invoice_issued_count: 0,
    tax_invoice_receipt_issued_count: 0,
    receipt_issued_count: 0,
    credit_issued_count: 0,
    last_document_date: null,
    last_activity_at: null,
    unpaid_reference: null,
    currency: null,
  };
}

/**
 * End-customer section population: ALL eligible income_customers, left-join stats.
 * Does not invent membership — `customers` must already be the canonical list.
 */
export function mergeEndCustomersWithDocumentStats<
  TStat extends { represented_client_id: string; income_customer_id: string },
>(
  customers: Array<{ id: string; represented_client_id: string }>,
  statsByPairKey: Map<string, TStat>,
  zeroStat: (params: { representedClientId: string; incomeCustomerId: string }) => TStat,
): Array<{ representedClientId: string; incomeCustomerId: string; stat: TStat }> {
  return customers.map((customer) => {
    const representedClientId = String(customer.represented_client_id);
    const incomeCustomerId = String(customer.id);
    const pairKey = endCustomerPopulationKey({ representedClientId, incomeCustomerId });
    return {
      representedClientId,
      incomeCustomerId,
      stat:
        statsByPairKey.get(pairKey) ??
        zeroStat({ representedClientId, incomeCustomerId }),
    };
  });
}

/**
 * Office section population: start from ALL eligible office clients, left-join stats.
 * Does not invent membership — `officeClients` must already be the canonical Core list.
 */
export function mergeOfficeClientsWithDocumentStats<TStat extends { represented_client_id: string }>(
  officeClients: Array<{ id: string }>,
  statsByClientId: Map<string, TStat>,
  zeroStat: (clientId: string) => TStat,
): Array<{ clientId: string; stat: TStat }> {
  return officeClients.map((client) => {
    const clientId = String(client.id);
    return {
      clientId,
      stat: statsByClientId.get(clientId) ?? zeroStat(clientId),
    };
  });
}

/**
 * Group end-customer rows by explicit parent represented client.
 * Parent labels must already be backend-resolved on each row.
 */
export function groupEndCustomerRowsByParent<
  T extends {
    parent_represented_client_id: string;
    parent_client_display_name: string;
  },
>(
  rows: T[],
): Array<{
  parent_represented_client_id: string;
  parent_client_display_name: string;
  total_customers: number;
  rows: T[];
}> {
  const order: string[] = [];
  const map = new Map<string, { parent_client_display_name: string; rows: T[] }>();
  for (const row of rows) {
    const parentId = row.parent_represented_client_id;
    const existing = map.get(parentId);
    if (!existing) {
      order.push(parentId);
      map.set(parentId, {
        parent_client_display_name: row.parent_client_display_name,
        rows: [row],
      });
      continue;
    }
    existing.rows.push(row);
  }
  return order.map((parentId) => {
    const g = map.get(parentId)!;
    return {
      parent_represented_client_id: parentId,
      parent_client_display_name: g.parent_client_display_name,
      total_customers: g.rows.length,
      rows: g.rows,
    };
  });
}

function isExplicitSelfMode(row: OfficeClientDocumentScopeRow): boolean {
  return row.acting_mode === 'self';
}

function isLegacyOfficeRepresentativeRow(row: OfficeClientDocumentScopeRow): boolean {
  return (
    !row.acting_mode &&
    row.represented_client_id != null &&
    row.represented_client_id === row.issuer_business_id
  );
}

/**
 * Resolve the single office-client issuer-scope key for a document/draft.
 * Returns null for self mode, cross-client mismatches, or non-office rows.
 * Does not decide office-row vs end-customer counters — see
 * `classifyDocumentPopulationForCounters` / `resolveOfficeClientCounterGroupKey`.
 */
export function resolveOfficeClientGroupKey(row: OfficeClientDocumentScopeRow): string | null {
  if (isExplicitSelfMode(row)) return null;

  if (row.represented_client_id) {
    if (row.issuer_business_id !== row.represented_client_id) return null;
    if (row.acting_mode === 'office_representative' || isLegacyOfficeRepresentativeRow(row)) {
      return row.represented_client_id;
    }
    return null;
  }

  if (row.acting_mode === 'office_representative') {
    return row.issuer_business_id;
  }

  return null;
}

/**
 * Office-client COUNTER scope key for OFFICE → Core client documents.
 *
 * Domain truth: `office_representative` means issuer = represented client
 * (Client → recipient), NEVER Accounting Office → Core client.
 * True Office→Core-client recipient linkage is not modeled yet (self-mode has
 * no Core-client-as-recipient FK). Until that exists, counter key is always null.
 */
export function resolveOfficeClientCounterGroupKey(_row: OfficeClientDocumentScopeRow): string | null {
  return null;
}

/**
 * Pure counter composition for office-client vs end-customer populations.
 * Mirrors SQL directional rules (panel_stats vs end_customer_stats).
 *
 * - Saved end customer (income_customer_id set) under office_representative → end-customer
 * - office_representative without income_customer_id → excluded (one-time/orphan; not Office→client)
 * - Office→Core client → not classifiable until schema exists (excluded)
 */
export function classifyDocumentPopulationForCounters(row: {
  represented_client_id: string | null;
  issuer_business_id: string;
  acting_mode: string;
  income_customer_id: string | null;
}):
  | { population: 'office_client'; represented_client_id: string }
  | { population: 'office_client_customer'; represented_client_id: string; income_customer_id: string }
  | { population: 'excluded' } {
  const issuerScopeKey = resolveOfficeClientGroupKey({
    represented_client_id: row.represented_client_id,
    issuer_business_id: row.issuer_business_id,
    acting_mode: row.acting_mode,
  });
  if (!issuerScopeKey) return { population: 'excluded' };

  const customerId =
    row.income_customer_id != null && String(row.income_customer_id).trim() !== ''
      ? String(row.income_customer_id).trim()
      : null;

  if (customerId) {
    return {
      population: 'office_client_customer',
      represented_client_id: issuerScopeKey,
      income_customer_id: customerId,
    };
  }

  // Client-as-issuer without saved income_customer is not Office→client.
  return { population: 'excluded' };
}

export type DocumentCounterBucket = {
  quote: number;
  deal_invoice: number;
  tax_invoice: number;
  receipt: number;
  credit_tax_invoice: number;
};

function emptyCounterBucket(): DocumentCounterBucket {
  return { quote: 0, deal_invoice: 0, tax_invoice: 0, receipt: 0, credit_tax_invoice: 0 };
}

function bumpCounter(bucket: DocumentCounterBucket, documentType: string): void {
  if (documentType === 'quote') bucket.quote += 1;
  else if (documentType === 'deal_invoice') bucket.deal_invoice += 1;
  else if (documentType === 'tax_invoice' || documentType === 'tax_invoice_receipt') {
    bucket.tax_invoice += 1;
  } else if (documentType === 'receipt') bucket.receipt += 1;
  else if (documentType === 'credit_tax_invoice') bucket.credit_tax_invoice += 1;
}

/**
 * Aggregate fixture documents into office-client and end-customer counter maps.
 * Used by focused directional-scope tests (no DB).
 */
export function aggregateDirectionalDocumentCounters(
  docs: Array<{
    represented_client_id: string | null;
    issuer_business_id: string;
    acting_mode: string;
    income_customer_id: string | null;
    document_type: string;
  }>,
): {
  office_clients: Map<string, DocumentCounterBucket>;
  office_client_customers: Map<string, DocumentCounterBucket>;
} {
  const office_clients = new Map<string, DocumentCounterBucket>();
  const office_client_customers = new Map<string, DocumentCounterBucket>();

  for (const doc of docs) {
    const classified = classifyDocumentPopulationForCounters(doc);
    if (classified.population === 'excluded') continue;
    if (classified.population === 'office_client') {
      const bucket = office_clients.get(classified.represented_client_id) ?? emptyCounterBucket();
      bumpCounter(bucket, doc.document_type);
      office_clients.set(classified.represented_client_id, bucket);
      continue;
    }
    const key = endCustomerPopulationKey({
      representedClientId: classified.represented_client_id,
      incomeCustomerId: classified.income_customer_id,
    });
    const bucket = office_client_customers.get(key) ?? emptyCounterBucket();
    bumpCounter(bucket, doc.document_type);
    office_client_customers.set(key, bucket);
  }

  return { office_clients, office_client_customers };
}

/** True when the row belongs exclusively to the given office client row. */
export function belongsToOfficeClientRow(
  row: OfficeClientDocumentScopeRow,
  officeClientId: string,
): boolean {
  const key = resolveOfficeClientGroupKey(row);
  return key != null && key === officeClientId;
}

/** Supabase OR filter for one office client row (includes legacy null acting_mode rows). */
export function officeClientDocumentsOrFilter(officeClientId: string): string {
  return [
    `and(represented_client_id.eq.${officeClientId},issuer_business_id.eq.${officeClientId})`,
    `and(represented_client_id.is.null,issuer_business_id.eq.${officeClientId})`,
  ].join(',');
}

/** Exclude organization self-mode rows while keeping office + legacy office rows. */
export function excludeSelfModeActingFilter(): string {
  return 'acting_mode.eq.office_representative,acting_mode.is.null';
}

/** P4.1 — CDM population page defaults (matches WE queue / A/R list scale). */
export const CDM_POPULATION_DEFAULT_LIMIT = 50;
export const CDM_POPULATION_MAX_LIMIT = 100;

export type CdmPopulationPagination = {
  limit: number;
  offset: number;
};

/**
 * Clamp CDM section pagination. Backend owns defaults/max — callers cannot unbounded.
 */
export function clampCdmPopulationPagination(
  rawLimit: unknown,
  rawOffset: unknown,
): CdmPopulationPagination {
  let limit = Number(rawLimit ?? CDM_POPULATION_DEFAULT_LIMIT);
  if (!Number.isFinite(limit) || limit <= 0) limit = CDM_POPULATION_DEFAULT_LIMIT;
  if (limit > CDM_POPULATION_MAX_LIMIT) limit = CDM_POPULATION_MAX_LIMIT;
  limit = Math.floor(limit);

  let offset = Number(rawOffset ?? 0);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);
  return { limit, offset };
}

/**
 * Prefer limit+1 fetch: return at most `limit` rows; has_more when one extra existed.
 * Avoids COUNT(*) solely for has_more.
 */
export function takeCdmPopulationPage<T>(
  fetched: T[],
  limit: number,
): { page: T[]; has_more: boolean } {
  const has_more = fetched.length > limit;
  return {
    page: has_more ? fetched.slice(0, limit) : fetched,
    has_more,
  };
}
