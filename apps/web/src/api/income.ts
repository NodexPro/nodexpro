/**
 * Income module API — aggregate-only reads, named commands only.
 *
 * Allowed reads:
 *   GET /income/aggregates/workspace-context
 *   GET /income/aggregates/workspace
 *   GET /income/aggregates/client-income-ledger-card
 *   GET /income/aggregates/document-email-history
 *   GET /income/aggregates/represented-client-email-history
 *   GET /income/aggregates/document-docflow-send
 *   GET /income/aggregates/issued-document-view
 *   GET /income/documents/:id/download (binary)
 *
 * Writes: POST /income/commands
 */

import { apiFetch, apiJson } from './client';
import { INCOME } from './endpoints';
import type {
  IncomeClientIncomeLedgerCardAggregate,
  IncomeCommandResponse,
  IncomeDocumentDocflowSendAggregate,
  IncomeDocumentEmailHistoryAggregate,
  IncomeRepresentedClientEmailHistoryAggregate,
  IncomeIssuedDocumentViewAggregate,
  IncomeWorkspaceAggregate,
  IncomeWorkspaceContextAggregate,
  SelectIncomeIssuerContextCommandResponse,
} from '../income/income-workspace-types';
import type { IncomeBrandingPreviewDraftCommandResponse } from '../income/income-document-branding-types';

export type {
  IncomeActingMode,
  IncomeAvailableDocumentType,
  IncomeClientDocumentManagementCustomerGroup,
  IncomeClientDocumentManagementPanel,
  IncomeClientDocumentManagementReportItem,
  IncomeClientDocumentManagementRow,
  IncomeClientDocumentManagementRowAction,
  IncomeClientDocumentManagementSection,
  IncomeClientIncomeLedgerCardAggregate,
  IncomeCommandResponse,
  IncomeCommandType,
  IncomeCustomerEditorField,
  IncomeCustomersTableRow,
  IncomeDocumentCreationSchema,
  IncomeDocumentCreationStep,
  IncomeDraftsTableRow,
  IncomeDocumentDocflowSendAggregate,
  IncomeDocumentEmailHistoryAggregate,
  IncomeRepresentedClientEmailHistoryAggregate,
  IncomeIssuedDocumentViewAggregate,
  IncomeIssuedDocumentsTableRow,
  IncomeItemsTableRow,
  IncomeIssuerContextSummary,
  IncomeIssuerOption,
  IncomeTableColumn,
  IncomeTableModel,
  IncomeWorkspaceAggregate,
  IncomeWorkspaceCard,
  IncomeWorkspaceContextAggregate,
  SelectIncomeIssuerContextCommandResponse,
} from '../income/income-workspace-types';

export {
  EMPTY_INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL,
  resolveIncomeClientDocumentManagementPanel,
} from '../income/income-workspace-types';

export type { IncomeBrandingPreviewDraftCommandResponse } from '../income/income-document-branding-types';

export function isBrandingPreviewDraftCommandResponse(
  res: IncomeCommandResponse | SelectIncomeIssuerContextCommandResponse | IncomeBrandingPreviewDraftCommandResponse,
): res is IncomeBrandingPreviewDraftCommandResponse {
  return (
    res.command === 'update_income_document_branding_profile_preview_draft' &&
    'document_branding_studio_preview' in res
  );
}

/** Narrow executeIncomeCommand union to the general Income command response (not select-issuer / branding-preview). */
export function isIncomeCommandResponse(res: unknown): res is IncomeCommandResponse {
  if (typeof res !== 'object' || res == null) return false;
  if (!('command' in res) || !('income_workspace_aggregate' in res)) return false;
  const command = (res as { command: unknown }).command;
  return (
    typeof command === 'string' &&
    command !== 'select_income_issuer_context' &&
    command !== 'update_income_document_branding_profile_preview_draft'
  );
}

export async function fetchIncomeDocumentEmailHistoryAggregate(params: {
  incomeDocumentId: string;
}): Promise<IncomeDocumentEmailHistoryAggregate> {
  const q = new URLSearchParams({ income_document_id: params.incomeDocumentId });
  return apiJson<IncomeDocumentEmailHistoryAggregate>(
    `${INCOME.documentEmailHistoryAggregate}?${q.toString()}`,
  );
}

export async function fetchIncomeRepresentedClientEmailHistoryAggregate(params: {
  representedClientId: string;
  incomeCustomerId?: string | null;
}): Promise<IncomeRepresentedClientEmailHistoryAggregate> {
  const q = new URLSearchParams({ represented_client_id: params.representedClientId });
  if (params.incomeCustomerId) q.set('income_customer_id', params.incomeCustomerId);
  return apiJson<IncomeRepresentedClientEmailHistoryAggregate>(
    `${INCOME.representedClientEmailHistoryAggregate}?${q.toString()}`,
  );
}

export async function fetchIncomeDocumentDocflowSendAggregate(params: {
  incomeDocumentId: string;
}): Promise<IncomeDocumentDocflowSendAggregate> {
  const q = new URLSearchParams({ income_document_id: params.incomeDocumentId });
  return apiJson<IncomeDocumentDocflowSendAggregate>(
    `${INCOME.documentDocflowSendAggregate}?${q.toString()}`,
  );
}

export async function fetchIncomeIssuedDocumentViewAggregate(params: {
  incomeDocumentId: string;
}): Promise<IncomeIssuedDocumentViewAggregate> {
  const q = new URLSearchParams({ income_document_id: params.incomeDocumentId });
  return apiJson<IncomeIssuedDocumentViewAggregate>(
    `${INCOME.issuedDocumentViewAggregate}?${q.toString()}`,
  );
}


export async function fetchIncomeWorkspaceContextAggregate(): Promise<IncomeWorkspaceContextAggregate> {
  return apiJson<IncomeWorkspaceContextAggregate>(INCOME.workspaceContextAggregate);
}

export async function fetchIncomeWorkspaceAggregate(): Promise<IncomeWorkspaceAggregate> {
  return apiJson<IncomeWorkspaceAggregate>(INCOME.workspaceAggregate);
}

export async function fetchIncomeClientIncomeLedgerCardAggregate(params: {
  representedClientId: string;
  endCustomerId?: string | null;
  year?: number | null;
}): Promise<IncomeClientIncomeLedgerCardAggregate> {
  const q = new URLSearchParams({
    represented_client_id: params.representedClientId,
  });
  if (params.endCustomerId) q.set('end_customer_id', params.endCustomerId);
  if (params.year != null) q.set('year', String(params.year));
  return apiJson<IncomeClientIncomeLedgerCardAggregate>(
    `${INCOME.clientIncomeLedgerCardAggregate}?${q.toString()}`,
  );
}

export async function executeIncomeCommand(
  command: string,
  body: Record<string, unknown>,
): Promise<
  IncomeCommandResponse | SelectIncomeIssuerContextCommandResponse | IncomeBrandingPreviewDraftCommandResponse
> {
  return apiJson<
    IncomeCommandResponse | SelectIncomeIssuerContextCommandResponse | IncomeBrandingPreviewDraftCommandResponse
  >(INCOME.commands, {
    method: 'POST',
    body: JSON.stringify({ command, ...body }),
  });
}

/** Normalize backend download path to apiFetch-relative path. */
export function incomeApiPathFromBackend(backendPath: string): string {
  const prefix = '/api/v1';
  if (backendPath.startsWith(prefix)) return backendPath.slice(prefix.length);
  return backendPath;
}

/** After create draft, locate new row id from refreshed aggregate (transport helper only). */
export function pickDraftIdAfterSave(
  aggregate: IncomeWorkspaceAggregate,
  previousDraftIds: Set<string>,
): string | null {
  const fresh = aggregate.drafts_table_model.rows.find((r) => !previousDraftIds.has(r.draft_id));
  return fresh?.draft_id ?? null;
}

export async function downloadIncomeDocumentPdf(backendDownloadPath: string, defaultFilename: string): Promise<void> {
  const path = incomeApiPathFromBackend(backendDownloadPath);
  const res = await apiFetch(path, { method: 'GET' });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const message = typeof errBody.message === 'string' ? errBody.message : res.statusText;
    throw new Error(message || 'Download failed');
  }
  const cd = res.headers.get('Content-Disposition');
  let filename = defaultFilename;
  const q = cd?.match(/filename="([^"]+)"/);
  if (q?.[1]) filename = q[1];
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.position = 'fixed';
  a.style.left = '-9999px';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
