/**
 * INC-4 — Issue income document from draft (immutable document snapshot).
 * Hardened: one document per draft (DB unique) + optional command idempotency lease.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  extractIncomeIssueThrownMessage,
  resolveIncomeIssueUserFacingMessage,
} from './income-issue-error.pure.js';
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
  assertIssueMonthAllowed,
  parseIssueMonthFromCommandBody,
  resolveIssueDateForIssueMonth,
} from '../work-engine/work-engine-invoice-retainer-issue-month-selector.pure.js';
import {
  assertIssueDateNotBeforeMin,
  clampIssueDateNotBeforeMin,
  isRecurringScheduleDateOverdue,
} from '../work-engine/work-engine-invoice-retainer-overdue-issue-date.pure.js';
import { todayIsoDate } from './income-retainer-template-document-date.pure.js';
import { resolveIncomeIssueMonthWindowForOrg } from './income-issue-month-window-resolver.js';
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
import { scheduleIncomeDocumentPdfRender } from './income-document-pdf.service.js';
import { emitIncomeWorkEventsAfterDocumentIssued } from './income-work-engine-bridge.js';
import {
  findRecurringCycleIssuedDocumentId,
  linkRecurringCycleIssuedDocument,
} from '../work-engine/work-engine-invoice-retainer-cycles.service.js';
import {
  abortIncomeIssueIdempotency,
  beginIncomeIssueIdempotency,
  completeIncomeIssueIdempotency,
  parseIssueIdempotencyKey,
  type IncomeIssueIdempotencyLease,
} from './income-issue-idempotency.js';
import type { IncomeDocumentType } from './income.types.js';
import {
  createIncomeIssueDiagnostic,
  extractIncomeIssueSafeError,
  logIncomeIssueFailed,
  logIncomeIssueStage,
  optionalRecurringCycleIdFromBody,
  safeUuidForLog,
  withIncomeIssueStage,
  type IncomeIssueDiagnostic,
} from './income-issue-diagnostic.js';
import { parseRecurringCycleReviewCommandContext } from '../work-engine/work-engine-invoice-retainer-cycle-draft-review-context.pure.js';
import {
  resolveAndApplyIssuerScopeFromTrustedOfficeDraftIfNeeded,
  resolveAndApplyRecurringCycleIssueIssuerScope,
} from './income-recurring-cycle-issue-issuer-scope.service.js';
import {
  buildAlreadyIssuedIssueResult,
  buildFreshIssuedIssueResult,
  type IncomeIssueResult,
} from './income-document-issue-result.pure.js';

const PG_UNIQUE_VIOLATION = '23505';

function rethrowIncomeIssueError(
  diag: IncomeIssueDiagnostic,
  failingStage: Parameters<typeof logIncomeIssueFailed>[1],
  error: unknown,
): never {
  logIncomeIssueFailed(diag, failingStage, error);
  const resolvedFailingStage = diag.failing_stage ?? failingStage;
  const safe = extractIncomeIssueSafeError(error);
  const diagnosticDetails = {
    income_issue_diagnostic: {
      correlation_id: diag.correlation_id,
      deploy_marker: diag.deploy_marker,
      last_completed_stage: diag.last_completed_stage,
      failing_stage: resolvedFailingStage,
    },
    safe_error: {
      ...(safe.code != null ? { code: safe.code } : {}),
      ...(safe.message != null ? { message: safe.message } : {}),
      ...(safe.details != null ? { details: safe.details } : {}),
      ...(safe.hint != null ? { hint: safe.hint } : {}),
      ...(safe.name != null ? { name: safe.name } : {}),
    },
  };
  const userMessage = resolveIncomeIssueUserFacingMessage({
    message: error instanceof AppError ? error.message : extractIncomeIssueThrownMessage(error),
    failingStage: resolvedFailingStage,
  });
  if (error instanceof AppError) {
    throw new AppError(error.statusCode, userMessage, error.code, {
      ...(error.details ?? {}),
      ...diagnosticDetails,
    });
  }
  throw new AppError(400, userMessage, 'INCOME_ISSUE_FAILED', {
    ...diagnosticDetails,
  });
}

export interface IssueIncomeDocumentResult {
  issuedDocumentId: string;
  idempotentReplay: boolean;
  issue_result: IncomeIssueResult;
  /** Observability only — used by command layer for refreshed_case stage logs. */
  diagnostic: IncomeIssueDiagnostic;
}

type IssuedDocumentSummary = {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  document_number: string;
  document_type: string;
  issue_date: string;
  represented_client_id: string | null;
  accounting_posting_status: string | null;
  accounting_entry_id: string | null;
  pdf_render_status: string;
};

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
  tax_allocation_number: string | null;
}

async function loadFullDraftForIssue(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
): Promise<FullDraftRow> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, actor_user_id, acting_mode, document_type, income_customer_id, one_time_customer_snapshot_json, draft_lines_json, draft_totals_preview_json, payment_terms_json, due_date, document_date, payment_received_json, notes, currency, language, status, issued_document_id, tax_allocation_number',
    )
    .eq('id', draftId)
    .eq('organization_id', scope.org_id)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadFullDraftForIssue', {
    migrationHint: '147_income_document_tax_allocation_number.sql',
  });
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
  throwIfSupabaseError(error, 'findIssuedDocumentBySourceDraft');
  if (!data) return null;
  return { id: String((data as { id: string }).id) };
}

async function loadIssuedDocumentSummary(
  scope: ActiveIncomeIssuerScope,
  issuedDocumentId: string,
): Promise<IssuedDocumentSummary> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, document_number, document_type, issue_date, represented_client_id, accounting_posting_status, accounting_entry_id, pdf_render_status',
    )
    .eq('id', issuedDocumentId)
    .eq('organization_id', scope.org_id)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadIssuedDocumentSummary');
  if (!data) throw notFound('Issued income document not found');
  const row = data as IssuedDocumentSummary;
  assertRowMatchesIssuerScope(scope, row);
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    issuer_business_id: String(row.issuer_business_id),
    document_number: String(row.document_number ?? ''),
    document_type: String(row.document_type ?? ''),
    issue_date: String(row.issue_date ?? ''),
    represented_client_id: row.represented_client_id,
    accounting_posting_status: row.accounting_posting_status,
    accounting_entry_id: row.accounting_entry_id,
    pdf_render_status: String(row.pdf_render_status ?? 'pending'),
  };
}

async function ensureRecurringCycleLinked(params: {
  scope: ActiveIncomeIssuerScope;
  draftId: string;
  issuedDocumentId: string;
  cycleId: string | null;
  diag: IncomeIssueDiagnostic;
}): Promise<void> {
  await withIncomeIssueStage(
    params.diag,
    {
      started: 'recurring_cycle_link_started',
      completed: 'recurring_cycle_link_completed',
      failing_stage: 'recurring_cycle_link',
    },
    async () => {
      const link = await linkRecurringCycleIssuedDocument({
        organizationId: params.scope.org_id,
        draftId: params.draftId,
        issuedDocumentId: params.issuedDocumentId,
        cycleId: params.cycleId,
      });
      if (params.cycleId && !link.linked) {
        throw badRequest(
          'Recurring cycle not found for issued document link',
          'INCOME_RECURRING_CYCLE_LINK_MISSING',
        );
      }
    },
  );
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
  throwIfSupabaseError(error, 'syncDraftMarkedIssued');
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
    throwIfSupabaseError(error, 'resolveAlreadyIssuedDocumentId');
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
    throwIfSupabaseError(error, 'buildCustomerSnapshot');
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
  diag: IncomeIssueDiagnostic,
): Promise<{ issuedId: string; created: boolean }> {
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

  const todayIso = todayIsoDate();
  const reviewContext = parseRecurringCycleReviewCommandContext(body);
  let overdueMinIssueDate: string | null = null;
  if (reviewContext) {
    const { data: cycleRow, error: cycleErr } = await supabaseAdmin
      .from('income_recurring_document_cycles')
      .select('scheduled_document_date, generated_document_id')
      .eq('organization_id', scope.org_id)
      .eq('id', reviewContext.cycle_id)
      .eq('recurring_profile_id', reviewContext.profile_id)
      .maybeSingle();
    throwIfSupabaseError(cycleErr, 'loadRecurringCycleForOverdueIssueDate');
    const cycle = cycleRow as {
      scheduled_document_date: string;
      generated_document_id: string | null;
    } | null;
    if (
      cycle &&
      !cycle.generated_document_id &&
      isRecurringScheduleDateOverdue(cycle.scheduled_document_date, todayIso)
    ) {
      overdueMinIssueDate = todayIso;
    }
  }

  const issueMonth = parseIssueMonthFromCommandBody(body);
  const explicitIssueDate = optionalIssueDateFromBody(body);
  let issue_date: string;
  if (overdueMinIssueDate) {
    // Overdue unissued: explicit calendar date wins; never earlier than today.
    if (explicitIssueDate) {
      issue_date = explicitIssueDate;
    } else if (issueMonth) {
      const issueMonthWindow = await resolveIncomeIssueMonthWindowForOrg(scope.org_id, 'IL', todayIso);
      try {
        assertIssueMonthAllowed({
          todayIso,
          issueMonth,
          monthsBack: 0,
          monthsAhead: issueMonthWindow.months_ahead,
        });
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'issue_month is invalid');
      }
      issue_date = resolveIssueDateForIssueMonth(issueMonth, overdueMinIssueDate);
    } else {
      issue_date = overdueMinIssueDate;
    }
    issue_date = clampIssueDateNotBeforeMin(issue_date, overdueMinIssueDate);
    try {
      assertIssueDateNotBeforeMin(issue_date, overdueMinIssueDate);
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'issue_date is invalid');
    }
  } else if (issueMonth) {
    const issueMonthWindow = await resolveIncomeIssueMonthWindowForOrg(scope.org_id, 'IL', todayIso);
    try {
      assertIssueMonthAllowed({
        todayIso,
        issueMonth,
        monthsBack: issueMonthWindow.months_back,
        monthsAhead: issueMonthWindow.months_ahead,
      });
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : 'issue_month is invalid');
    }
    issue_date = resolveIssueDateForIssueMonth(issueMonth, draft.document_date);
  } else {
    issue_date = resolveIssueDateFromDraft(draft.document_date, explicitIssueDate);
  }
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

  const allocated = await withIncomeIssueStage(
    diag,
    {
      started: 'numbering_started',
      completed: 'numbering_completed',
      failing_stage: 'numbering',
    },
    () => allocateIncomeDocumentNumber(scope, draft.document_type!, issue_date),
  );

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

  const issuedInsert = await withIncomeIssueStage(
    diag,
    {
      started: 'issued_document_insert_started',
      completed: 'issued_document_insert_completed',
      failing_stage: 'issued_document_insert',
    },
    async () => {
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
          notes: draft.notes,
          source_draft_id: draft.id,
          accounting_posting_status: 'pending',
          tax_allocation_number:
            typeof draft.tax_allocation_number === 'string' && draft.tax_allocation_number.trim()
              ? draft.tax_allocation_number.trim()
              : null,
        })
        .select('id')
        .single();

      if (insertErr) {
        if (isUniqueViolation(insertErr)) {
          const existing = await findIssuedDocumentBySourceDraft(scope.org_id, draft.id);
          if (existing) {
            await syncDraftMarkedIssued(scope, draft.id, existing.id);
            return { issuedId: existing.id, created: false };
          }
        }
        throwIfSupabaseError(insertErr, 'issueIncomeDocumentInsert', {
          migrationHint: '147_income_document_tax_allocation_number.sql',
        });
      }
      if (!issued) throw badRequest('Failed to create issued income document');
      return { issuedId: (issued as { id: string }).id, created: true };
    },
  );

  if (!issuedInsert.created) {
    return issuedInsert;
  }

  const issuedId = issuedInsert.issuedId;
  diag.issued_document_id = issuedId;

  const postingStartedAt = Date.now();
  logIncomeIssueStage(diag, 'accounting_posting_started', { duration_ms: 0 });
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
    logIncomeIssueStage(diag, 'accounting_posting_completed', {
      duration_ms: Date.now() - postingStartedAt,
    });
  } catch (postingErr) {
    logIncomeIssueStage(diag, 'accounting_posting_failed', {
      ...extractIncomeIssueSafeError(postingErr),
      duration_ms: Date.now() - postingStartedAt,
    });
    const cleanupStartedAt = Date.now();
    logIncomeIssueStage(diag, 'issued_document_cleanup_started', { duration_ms: 0 });
    await supabaseAdmin
      .from('income_documents')
      .delete()
      .eq('id', issuedId)
      .eq('organization_id', scope.org_id);
    logIncomeIssueStage(diag, 'issued_document_cleanup_completed', {
      duration_ms: Date.now() - cleanupStartedAt,
    });
    logIncomeIssueFailed(diag, 'accounting_posting', postingErr);
    throw postingErr;
  }

  await withIncomeIssueStage(
    diag,
    {
      started: 'draft_mark_issued_started',
      completed: 'draft_mark_issued_completed',
      failing_stage: 'draft_mark_issued',
    },
    async () => {
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

      throwIfSupabaseError(draftUpdateErr, 'markDraftIssuedAfterIssue');

      if (!draftUpdated) {
        const raced = await findIssuedDocumentBySourceDraft(scope.org_id, draft.id);
        if (raced?.id === issuedId || raced) {
          await syncDraftMarkedIssued(scope, draft.id, raced?.id ?? issuedId);
          return;
        }
        throw conflict('Draft was modified during issue', 'INCOME_DRAFT_ISSUE_CONFLICT');
      }
    },
  );

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

  return { issuedId, created: true };
}

async function finishIdempotentIssue(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
  issuedDocumentId: string,
  lease: IncomeIssueIdempotencyLease | null,
  diag: IncomeIssueDiagnostic,
  cycleId: string | null,
): Promise<IssueIncomeDocumentResult> {
  diag.issued_document_id = issuedDocumentId;
  await syncDraftMarkedIssued(scope, draftId, issuedDocumentId);
  await ensureRecurringCycleLinked({
    scope,
    draftId,
    issuedDocumentId,
    cycleId,
    diag,
  });
  if (lease?.kind === 'fresh') {
    await completeIncomeIssueIdempotency({
      leaseRowId: lease.leaseRowId,
      incomeDocumentId: issuedDocumentId,
      sourceDraftId: draftId,
    });
  }
  const summary = await loadIssuedDocumentSummary(scope, issuedDocumentId);
  return {
    issuedDocumentId,
    idempotentReplay: true,
    diagnostic: diag,
    issue_result: buildAlreadyIssuedIssueResult({
      document_id: summary.id,
      document_number: summary.document_number,
      document_type_key: summary.document_type,
      issued_date: summary.issue_date,
      pdf_render_status: summary.pdf_render_status,
    }),
  };
}

export async function executeIssueIncomeDocument(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IssueIncomeDocumentResult> {
  // Observability-first: emit before any await / DB / permission / draft_id throw.
  const recurringCycleId = optionalRecurringCycleIdFromBody(body);
  const diag = createIncomeIssueDiagnostic({
    org_id: typeof ctx.organizationId === 'string' && ctx.organizationId ? ctx.organizationId : 'unknown',
    draft_id: safeUuidForLog(body.draft_id) ?? 'unvalidated',
    recurring_cycle_id: recurringCycleId,
    correlation_id: ctx.correlationId,
  });
  logIncomeIssueStage(diag, 'issue_command_received', { duration_ms: 0 });

  let draft_id: string;
  try {
    logIncomeIssueStage(diag, 'draft_id_validation_started', { duration_ms: 0 });
    draft_id = reqUuid(body.draft_id, 'draft_id');
    diag.draft_id = draft_id;
    logIncomeIssueStage(diag, 'draft_id_validation_completed');
  } catch (error) {
    rethrowIncomeIssueError(diag, 'draft_id_validation', error);
  }

  const reviewContext = parseRecurringCycleReviewCommandContext(body);
  try {
    if (reviewContext) {
      diag.recurring_cycle_id = diag.recurring_cycle_id ?? reviewContext.cycle_id;
      await withIncomeIssueStage(
        diag,
        {
          started: 'recurring_issuer_scope_resolve_started',
          completed: 'recurring_issuer_scope_resolve_completed',
          failing_stage: 'recurring_issuer_scope_resolve',
        },
        () =>
          resolveAndApplyRecurringCycleIssueIssuerScope(ctx, {
            draftId: draft_id,
            review: reviewContext,
          }),
      );
    } else {
      // Wizard / non-retainer office issue: FE may send only draft_id while workspace
      // issuer context is stale. Resolve from trusted draft (+ linked cycle/profile).
      await withIncomeIssueStage(
        diag,
        {
          started: 'recurring_issuer_scope_resolve_started',
          completed: 'recurring_issuer_scope_resolve_completed',
          failing_stage: 'recurring_issuer_scope_resolve',
        },
        () =>
          resolveAndApplyIssuerScopeFromTrustedOfficeDraftIfNeeded(ctx, {
            draftId: draft_id,
          }),
      );
    }
  } catch (error) {
    // withIncomeIssueStage already logged; attach Hebrew + diagnostic for the client.
    if (error instanceof AppError && error.details?.income_issue_diagnostic) throw error;
    rethrowIncomeIssueError(diag, 'recurring_issuer_scope_resolve', error);
  }

  let scope: ActiveIncomeIssuerScope;
  try {
    scope = await withIncomeIssueStage(
      diag,
      {
        started: 'issuer_scope_load_started',
        completed: 'issuer_scope_load_completed',
        failing_stage: 'issuer_scope_load',
      },
      () => loadActiveIncomeIssuerScope(ctx),
    );
  } catch (error) {
    if (error instanceof AppError && error.details?.income_issue_diagnostic) throw error;
    rethrowIncomeIssueError(diag, 'issuer_scope_load', error);
  }
  diag.org_id = scope.org_id;

  try {
    logIncomeIssueStage(diag, 'permission_check_started', { duration_ms: 0 });
    assertIncomeIssuePermission(scope);
    logIncomeIssueStage(diag, 'permission_check_completed');
  } catch (error) {
    rethrowIncomeIssueError(diag, 'permission_check', error);
  }

  const idempotencyKey = parseIssueIdempotencyKey(body);

  let lease: IncomeIssueIdempotencyLease | null = null;
  if (idempotencyKey) {
    lease = await beginIncomeIssueIdempotency({
      organizationId: scope.org_id,
      idempotencyKey,
      sourceDraftId: draft_id,
    });
    if (lease.kind === 'replay') {
      return finishIdempotentIssue(
        scope,
        draft_id,
        lease.incomeDocumentId,
        null,
        diag,
        recurringCycleId,
      );
    }
  }

  try {
    const existingEarly = await findIssuedDocumentBySourceDraft(scope.org_id, draft_id);
    if (existingEarly) {
      logIncomeIssueStage(diag, 'existing_issued_document_checked');
      return finishIdempotentIssue(scope, draft_id, existingEarly.id, lease, diag, recurringCycleId);
    }

    if (recurringCycleId) {
      const fromCycle = await findRecurringCycleIssuedDocumentId({
        organizationId: scope.org_id,
        cycleId: recurringCycleId,
        expectedDraftId: draft_id,
      });
      if (fromCycle) {
        logIncomeIssueStage(diag, 'existing_issued_document_checked');
        return finishIdempotentIssue(scope, draft_id, fromCycle, lease, diag, recurringCycleId);
      }
    }

    let draft: FullDraftRow;
    try {
      draft = await loadFullDraftForIssue(scope, draft_id);
      logIncomeIssueStage(diag, 'draft_loaded');
    } catch (error) {
      rethrowIncomeIssueError(diag, 'draft_load', error);
    }

    let alreadyIssuedId: string | null;
    try {
      alreadyIssuedId = await resolveAlreadyIssuedDocumentId(scope, draft);
      logIncomeIssueStage(diag, 'existing_issued_document_checked');
    } catch (error) {
      rethrowIncomeIssueError(diag, 'existing_issued_document_check', error);
    }

    if (alreadyIssuedId) {
      return finishIdempotentIssue(scope, draft_id, alreadyIssuedId, lease, diag, recurringCycleId);
    }

    if (draft.status !== 'draft') {
      throw conflict('Draft cannot be issued', 'INCOME_DRAFT_ALREADY_ISSUED');
    }

    const issued = await issueNewDocumentFromDraft(ctx, scope, draft, body, diag);
    if (!issued.created) {
      return finishIdempotentIssue(
        scope,
        draft_id,
        issued.issuedId,
        lease,
        diag,
        recurringCycleId,
      );
    }

    const issuedDocumentId = issued.issuedId;
    diag.issued_document_id = issuedDocumentId;

    await ensureRecurringCycleLinked({
      scope,
      draftId: draft_id,
      issuedDocumentId,
      cycleId: recurringCycleId,
      diag,
    });

    await withIncomeIssueStage(
      diag,
      {
        started: 'pdf_scheduling_started',
        completed: 'pdf_scheduling_completed',
        failing_stage: 'pdf_scheduling',
      },
      () => scheduleIncomeDocumentPdfRender(ctx, scope.org_id, issuedDocumentId),
    );

    if (lease?.kind === 'fresh') {
      await completeIncomeIssueIdempotency({
        leaseRowId: lease.leaseRowId,
        incomeDocumentId: issuedDocumentId,
        sourceDraftId: draft_id,
      });
    }

    const summary = await loadIssuedDocumentSummary(scope, issuedDocumentId);
    return {
      issuedDocumentId,
      idempotentReplay: false,
      diagnostic: diag,
      issue_result: buildFreshIssuedIssueResult({
        document_id: summary.id,
        document_number: summary.document_number,
        document_type_key: summary.document_type,
        issued_date: summary.issue_date,
        pdf_render_status: summary.pdf_render_status,
      }),
    };
  } catch (e) {
    if (lease?.kind === 'fresh') {
      await abortIncomeIssueIdempotency(lease.leaseRowId);
    }
    if (e instanceof AppError && e.details?.income_issue_diagnostic) throw e;
    rethrowIncomeIssueError(diag, 'issue_command', e);
  }
}
