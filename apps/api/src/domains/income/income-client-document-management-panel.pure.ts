/**
 * Pure helpers for Income client document management panel grouping.
 */

export type OfficeClientDocumentScopeRow = {
  represented_client_id: string | null;
  issuer_business_id: string;
  acting_mode: string;
};

export type IncomeClientDocumentManagementPopulationKey =
  | 'office_client'
  | 'office_client_customer';

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
 * Resolve the single office-client row key for a document/draft.
 * Returns null for self mode, cross-client mismatches, or non-office rows.
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
