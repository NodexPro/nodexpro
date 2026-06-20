/**
 * INC-4 — Issue income document from draft (immutable document snapshot).
 * Hardened: one document per draft (DB unique) + optional command idempotency lease.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, notFound } from '../../shared/errors.js';
import {
  assertRowMatchesIssuerScope,
  reqUuid,
  type ActiveIncomeIssuerScope,
} from './income.guards.js';
import {
  assertIncomeIssuePermission,
  loadActiveIncomeIssuerScope,
} from './income-issuer-scope.service.js';
import { buildIncomeIssuerSnapshotForScope } from './income-issuer-snapshot.service.js';
import {
  assertIncomeDocumentIssueDateAllowed,
  resolveIssueDateFromDraft,
} from './income-document-issue-date.validation.js';
import {
  assertDocumentTypeEnabled,
  findAvailableDocumentType,
  resolveAvailableDocumentTypes,
} from './income-document-types.resolver.js';
import { allocateIncomeDocumentNumber } from './income-document-numbering.service.js';
import {
  assertDraftReadyToIssue,
  buildLegalSnapshotForIssue,
  buildTotalsSnapshotForIssue,
} from './income-document-issue.pure.js';
import { applyAccountingPostingForIssuedDocument } from './income-accounting-posting.service.js';
import { renderIncomeDocumentPdf } from './income-document-pdf.service.js';
import { emitIncomeWorkEventsAfterDocumentIssued } from './income-work-engine-bridge.js';
import { linkRecurringCycleIssuedDocument } from '../work-engine/work-engine-invoice-retainer-cycles.service.js';
import {
  abortIncomeIssueIdempotency,
  beginIncomeIssueIdempotency,
  completeIncomeIssueIdempotency,
  parseIssueIdempotencyKey,
  type IncomeIssueIdempotencyLease,
} from './income-issue-idempotency.js';
import type { IncomeDocumentType } from './income.types.js';

const PG_UNIQUE_VIOLATION = '23505';

export interface IssueIncomeDocumentResult {
  issuedDocumentId: string;
  idempotentReplay: boolean;
}

function optionalIssueDateFromBody(body: Record<string, unknown>): string | null {
  const raw = body.document_date ?? body.issue_date;
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | undefined)?.code === PG_UNIQUE_VIOLATION;
}

interface FullDraftRow {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  actor_user_id: string;
  acting_mode: string;
  document_type: IncomeDocumentType | null;
  income_customer_id: string | null;
  one_time_customer_snapshot_json: Record<string, unknown> | null;
  draft_lines_json: unknown;
  draft_totals_preview_json: Record<string, unknown> | null;
  payment_terms_json: Record<string, unknown> | null;
  due_date: string | null;
  document_date: string | null;
  payment_received_json: Record<string, unknown> | null;
  notes: string | null;
  currency: string | null;
  language: string | null;
  status: string;
  issued_document_id: string | null;
}

async function loadFullDraftForIssue(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
): Promise<FullDraftRow> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, actor_user_id, acting_mode, document_type, income_customer_id, one_time_customer_snapshot_json, draft_lines_json, draft_totals_preview_json, payment_terms_json, due_date, document_date, payment_received_json, notes, currency, language, status, issued_document_id',
    )
    .eq('id', draftId)
    .eq('organization_id', scope.org_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Income document draft not found');
  const row = data as FullDraftRow;
  assertRowMatchesIssuerScope(scope, row);
  return row;
}

async function findIssuedDocumentBySourceDraft(
  orgId: string,
  sourceDraftId: string,
): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select('id')
    .eq('organization_id', orgId)
    .eq('source_draft_id', sourceDraftId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: String((data as { id: string }).id) };
}

async function syncDraftMarkedIssued(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
  issuedDocumentId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('income_document_drafts')
    .update({
      status: 'issued',
      issued_document_id: issuedDocumentId,
      issued_at: new Date().toISOString(),
    })
    .eq('id', draftId)
    .eq('organization_id', scope.org_id)
    .in('status', ['draft', 'issued']);
  if (error) throw error;
}

async function resolveAlreadyIssuedDocumentId(
  scope: ActiveIncomeIssuerScope,
  draft: FullDraftRow,
): Promise<string | null> {
  if (draft.issued_document_id) {
    const { data, error } = await supabaseAdmin
      .from('income_documents')
      .select('id')
      .eq('id', draft.issued_document_id)
      .eq('organization_id', scope.org_id)
      .maybeSingle();
    if (error) throw error;
    if (data) return String((data as { id: string }).id);
  }
  const byDraft = await findIssuedDocumentBySourceDraft(scope.org_id, draft.id);
  if (byDraft) {
    await syncDraftMarkedIssued(scope, draft.id, byDraft.id);
    return byDraft.id;
  }
  if (draft.status === 'issued') {
    throw conflict('Draft is already issued but issued document is missing', 'INCOME_DRAFT_ALREADY_ISSUED');
  }
  return null;
}

async function buildCustomerSnapshot(
  scope: ActiveIncomeIssuerScope,
  draft: FullDraftRow,
): Promise<Record<string, unknown>> {
  if (draft.income_customer_id) {
    const { data, error } = await supabaseAdmin
      .from('income_customers')
      .select(
        'id, organization_id, issuer_business_id, represented_client_id, display_name, phone, email, tax_id, address_json, is_one_time, status',
      )
      .eq('id', draft.income_customer_id)
      .eq('organization_id', scope.org_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw badRequest('Income customer not found');
    const customer = data as {
      id: string;
      organization_id: string;
      issuer_business_id: string;
      represented_client_id: string | null;
      display_name: string;
      phone: string | null;
      email: string | null;
      tax_id: string | null;
      address_json: Record<string, unknown> | null;
      is_one_time: boolean;
      status: string;
    };
    assertRowMatchesIssuerScope(scope, customer);
    if (customer.status !== 'active') throw badRequest('Income customer is not active');
    return {
      source: 'income_customer',
      income_customer_id: customer.id,
      display_name: customer.display_name,
      phone: customer.phone,
      email: customer.email,
      tax_id: customer.tax_id,
      address_json: customer.address_json,
      is_one_time: customer.is_one_time,
    };
  }
  return {
    source: 'one_time_snapshot',
    ...(draft.one_time_customer_snapshot_json ?? {}),
  };
}

async function issueNewDocumentFromDraft(
  ctx: RequestContext,
  scope: ActiveIncomeIssuerScope,
  draft: FullDraftRow,
  body: Record<string, unknown>,
): Promise<string> {
  try {
    assertDraftReadyToIssue(draft);
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'Draft is not ready to issue');
  }

  const docTypesResult = await resolveAvailableDocumentTypes(scope.org_id, scope);
  assertDocumentTypeEnabled(docTypesResult.available_document_types, draft.document_type!);
  const docType = findAvailableDocumentType(
    docTypesResult.available_document_types,
    draft.document_type!,
  );
  if (!docType) throw badRequest('document_type is invalid');

  const issue_date = resolveIssueDateFromDraft(
    draft.document_date,
    optionalIssueDateFromBody(body),
  );
  await assertIncomeDocumentIssueDateAllowed({
    scope,
    documentType: draft.document_type!,
    issueDate: issue_date,
  });

  const lines = Array.isArray(draft.draft_lines_json) ? draft.draft_lines_json : [];
  const customer_snapshot_json = await buildCustomerSnapshot(scope, draft);
  const issuer_snapshot_json = await buildIncomeIssuerSnapshotForScope(scope);
  const legal_snapshot_json = buildLegalSnapshotForIssue({
    country_code: docTypesResult.country_code,
    ruleset_id: docType.ruleset_id,
    document_type: draft.document_type!,
    docType,
    business_type: docTypesResult.business_type,
    business_type_raw: null,
    warnings: docTypesResult.warnings,
  });
  const totals_snapshot_json = buildTotalsSnapshotForIssue(
    draft.draft_totals_preview_json,
    draft.currency ?? 'ILS',
    lines.length,
  );

  const allocated = await allocateIncomeDocumentNumber(scope, draft.document_type!, issue_date);

  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_numbering_sequence',
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_NUMBER_ALLOCATED,
    payload: {
      document_type: draft.document_type,
      document_number: allocated.document_number,
      sequence_number: allocated.sequence_number,
      year: allocated.year,
      issuer_business_id: scope.issuer_business_id,
      source_draft_id: draft.id,
    },
  });

  const { data: issued, error: insertErr } = await supabaseAdmin
    .from('income_documents')
    .insert({
      organization_id: scope.org_id,
      represented_client_id: scope.represented_client_id,
      issuer_business_id: scope.issuer_business_id,
      actor_user_id: scope.actor_user_id,
      acting_mode: scope.acting_mode,
      income_customer_id: draft.income_customer_id,
      customer_snapshot_json,
      document_type: draft.document_type,
      document_number: allocated.document_number,
      document_status: 'issued',
      issue_date,
      due_date: draft.due_date,
      currency: draft.currency ?? 'ILS',
      language: draft.language ?? 'he',
      lines_snapshot_json: lines,
      totals_snapshot_json,
      legal_snapshot_json,
      issuer_snapshot_json,
      source_draft_id: draft.id,
      accounting_posting_status: 'pending',
    })
    .select('id')
    .single();

  if (insertErr) {
    if (isUniqueViolation(insertErr)) {
      const existing = await findIssuedDocumentBySourceDraft(scope.org_id, draft.id);
      if (existing) {
        await syncDraftMarkedIssued(scope, draft.id, existing.id);
        return existing.id;
      }
    }
    throw insertErr;
  }
  if (!issued) throw new Error('Failed to create issued income document');

  const issuedId = (issued as { id: string }).id;

  try {
    await applyAccountingPostingForIssuedDocument(ctx, {
      id: issuedId,
      organization_id: scope.org_id,
      document_type: draft.document_type!,
      document_number: allocated.document_number,
      issue_date,
      currency: draft.currency ?? 'ILS',
      represented_client_id: scope.represented_client_id,
      totals_snapshot_json,
      lines_snapshot_json: lines,
      accounting_posting_status: 'pending',
      accounting_entry_id: null,
      notes: draft.notes,
    });
  } catch (postingErr) {
    await supabaseAdmin
      .from('income_documents')
      .delete()
      .eq('id', issuedId)
      .eq('organization_id', scope.org_id);
    throw postingErr;
  }

  const { data: draftUpdated, error: draftUpdateErr } = await supabaseAdmin
    .from('income_document_drafts')
    .update({
      status: 'issued',
      issued_document_id: issuedId,
      issued_at: new Date().toISOString(),
    })
    .eq('id', draft.id)
    .eq('organization_id', scope.org_id)
    .eq('status', 'draft')
    .select('id')
    .maybeSingle();

  if (draftUpdateErr) throw draftUpdateErr;

  if (!draftUpdated) {
    const raced = await findIssuedDocumentBySourceDraft(scope.org_id, draft.id);
    if (raced?.id === issuedId || raced) {
      await syncDraftMarkedIssued(scope, draft.id, raced?.id ?? issuedId);
      return raced?.id ?? issuedId;
    }
    throw conflict('Draft was modified during issue', 'INCOME_DRAFT_ISSUE_CONFLICT');
  }

  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document',
    entityId: issuedId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_ISSUED,
    payload: {
      source_draft_id: draft.id,
      document_type: draft.document_type,
      document_number: allocated.document_number,
      issuer_business_id: scope.issuer_business_id,
    },
  });

  await renderIncomeDocumentPdf(ctx, scope.org_id, issuedId);

  void emitIncomeWorkEventsAfterDocumentIssued({
    ctx,
    orgId: scope.org_id,
    incomeDocumentId: issuedId,
    representedClientId: scope.represented_client_id,
    documentType: draft.document_type!,
    documentNumber: allocated.document_number,
    issueDate: issue_date,
    dueDate: draft.due_date,
    currency: draft.currency ?? 'ILS',
    customerSnapshotJson: customer_snapshot_json,
    totalsSnapshotJson: totals_snapshot_json,
  }).catch(() => {
    /* fire-and-forget — Income issue must not fail on Work Engine intake */
  });

  return issuedId;
}

async function finishIdempotentIssue(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
  issuedDocumentId: string,
  lease: IncomeIssueIdempotencyLease | null,
): Promise<IssueIncomeDocumentResult> {
  await syncDraftMarkedIssued(scope, draftId, issuedDocumentId);
  if (lease?.kind === 'fresh') {
    await completeIncomeIssueIdempotency({
      leaseRowId: lease.leaseRowId,
      incomeDocumentId: issuedDocumentId,
      sourceDraftId: draftId,
    });
  }
  return { issuedDocumentId, idempotentReplay: true };
}

export async function executeIssueIncomeDocument(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IssueIncomeDocumentResult> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeIssuePermission(scope);

  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const idempotencyKey = parseIssueIdempotencyKey(body);

  let lease: IncomeIssueIdempotencyLease | null = null;
  if (idempotencyKey) {
    lease = await beginIncomeIssueIdempotency({
      organizationId: scope.org_id,
      idempotencyKey,
      sourceDraftId: draft_id,
    });
    if (lease.kind === 'replay') {
      await linkRecurringCycleIssuedDocument({
        organizationId: scope.org_id,
        draftId: draft_id,
        issuedDocumentId: lease.incomeDocumentId,
      }).catch(() => undefined);
      return finishIdempotentIssue(scope, draft_id, lease.incomeDocumentId, null);
    }
  }

  try {
    const existingEarly = await findIssuedDocumentBySourceDraft(scope.org_id, draft_id);
    if (existingEarly) {
      await linkRecurringCycleIssuedDocument({
        organizationId: scope.org_id,
        draftId: draft_id,
        issuedDocumentId: existingEarly.id,
      }).catch(() => undefined);
      return finishIdempotentIssue(scope, draft_id, existingEarly.id, lease);
    }

    const draft = await loadFullDraftForIssue(scope, draft_id);

    const alreadyIssuedId = await resolveAlreadyIssuedDocumentId(scope, draft);
    if (alreadyIssuedId) {
      await linkRecurringCycleIssuedDocument({
        organizationId: scope.org_id,
        draftId: draft_id,
        issuedDocumentId: alreadyIssuedId,
      }).catch(() => undefined);
      return finishIdempotentIssue(scope, draft_id, alreadyIssuedId, lease);
    }

    if (draft.status !== 'draft') {
      throw conflict('Draft cannot be issued', 'INCOME_DRAFT_ALREADY_ISSUED');
    }

    const issuedDocumentId = await issueNewDocumentFromDraft(ctx, scope, draft, body);

    await linkRecurringCycleIssuedDocument({
      organizationId: scope.org_id,
      draftId: draft_id,
      issuedDocumentId,
    }).catch((linkErr) => {
      console.warn('[income-issue] retainer cycle link failed', draft_id, linkErr);
    });

    if (lease?.kind === 'fresh') {
      await completeIncomeIssueIdempotency({
        leaseRowId: lease.leaseRowId,
        incomeDocumentId: issuedDocumentId,
        sourceDraftId: draft_id,
      });
    }

    return { issuedDocumentId, idempotentReplay: false };
  } catch (e) {
    if (lease?.kind === 'fresh') {
      await abortIncomeIssueIdempotency(lease.leaseRowId);
    }
    throw e;
  }
}
