/**
 * convert_income_document_to_draft + cancel_income_preliminary_document.
 * Target is always a draft. No Accounting Base posting on conversion/cancel.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  assertDocumentTypeEnabled,
  findAvailableDocumentType,
  resolveAvailableDocumentTypes,
} from './income-document-types.resolver.js';
import {
  applyOfficialIncomeIssuerContext,
  buildIncomeWorkspaceContextAggregate,
} from './income-issuer-context.service.js';
import {
  assertIncomeEditPermission,
  loadActiveIncomeIssuerScope,
} from './income-issuer-scope.service.js';
import {
  buildIncomeWorkspaceAggregate,
  buildIncomeWorkspaceWizardPatchAggregate,
} from './income-workspace-aggregate.service.js';
import {
  createIncomeCommandTimings,
  logIncomeCommandTimings,
} from './income-command-timings.pure.js';
import { buildWorkEngineInvoicesTabAggregate } from '../work-engine/work-engine-invoices-tab.read-model.service.js';
import { buildWorkEngineInvoicesClientDocumentsByTypeAggregate } from '../work-engine/work-engine-invoices-client-documents-by-type.read-model.service.js';
import { validateDraftAgainstDocumentTypeRules } from './income-document-draft.helpers.js';
import { resumeIncomeDocumentDraftFromContext } from './income-document-draft-editor.service.js';
import type { IncomeCommandResponse, IncomeDocumentType } from './income.types.js';
import {
  CANCEL_SOURCE_CONVERSION_LINEAGE_RULE,
  conversionTypeKey,
  decideConversionTargetDocumentLink,
  draftLinesFromIssuedSnapshot,
  INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT,
  INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT,
  INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT,
  isIncomeConversionSourceType,
  isIncomeConversionTargetType,
  isPreliminaryCancellableType,
  isPreliminaryEditableType,
  isTaxDocumentDirectCancelForbidden,
  PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY,
  decidePreliminaryEditStagingDateHeal,
  resolveDocumentSettingsForConversion,
  serializeConversionDocumentSettings,
  serializeConvertedDraftLines,
  type IncomeConversionSourceType,
  type IncomeConversionTargetType,
} from './income-document-conversion.pure.js';

type SourceDoc = {
  id: string;
  organization_id: string;
  represented_client_id: string | null;
  issuer_business_id: string;
  acting_mode: string;
  document_type: string;
  document_status: string;
  document_number: string;
  income_customer_id: string | null;
  customer_snapshot_json: Record<string, unknown> | null;
  currency: string;
  language: string;
  notes: string | null;
  issue_date: string | null;
  due_date: string | null;
  lines_snapshot_json: unknown;
  tax_allocation_number: string | null;
  customer_po_reference: string | null;
  source_draft_id: string | null;
  legal_snapshot_json: Record<string, unknown> | null;
  totals_snapshot_json: Record<string, unknown> | null;
};

async function loadSourceDocument(orgId: string, documentId: string): Promise<SourceDoc> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, represented_client_id, issuer_business_id, acting_mode, document_type, document_status, document_number, income_customer_id, customer_snapshot_json, currency, language, notes, issue_date, due_date, lines_snapshot_json, tax_allocation_number, customer_po_reference, source_draft_id, legal_snapshot_json, totals_snapshot_json',
    )
    .eq('organization_id', orgId)
    .eq('id', documentId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadConversionSourceDocument', {
    migrationHint: '158_income_document_conversion_and_preliminary_cancel.sql',
  });
  if (!data) throw notFound('Income document not found');
  return data as SourceDoc;
}

async function loadSourceDraftTerms(orgId: string, draftId: string | null): Promise<{
  payment_terms_json: Record<string, unknown> | null;
  customer_po_reference: string | null;
  document_settings_json: unknown;
}> {
  if (!draftId) {
    return {
      payment_terms_json: null,
      customer_po_reference: null,
      document_settings_json: null,
    };
  }
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('payment_terms_json, customer_po_reference, document_settings_json')
    .eq('organization_id', orgId)
    .eq('id', draftId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadConversionSourceDraftTerms');
  const row = data as {
    payment_terms_json: Record<string, unknown> | null;
    customer_po_reference: string | null;
    document_settings_json: unknown;
  } | null;
  return {
    payment_terms_json: row?.payment_terms_json ?? null,
    customer_po_reference: row?.customer_po_reference ?? null,
    document_settings_json: row?.document_settings_json ?? null,
  };
}

/**
 * Canonical issue hook: link conversion.target_document_id when a converted draft is issued.
 * No-op for normal / retainer drafts that have no conversion row.
 */
export async function linkIncomeDocumentConversionTargetOnIssue(params: {
  orgId: string;
  draftId: string;
  issuedDocumentId: string;
  actorUserId: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('income_document_conversions')
    .select('id, target_document_id, status, source_document_id, target_draft_id')
    .eq('organization_id', params.orgId)
    .eq('target_draft_id', params.draftId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadConversionForIssueLink', {
    migrationHint: '158_income_document_conversion_and_preliminary_cancel.sql',
  });
  const row = data as {
    id: string;
    target_document_id: string | null;
    status: string;
    source_document_id: string;
    target_draft_id: string;
  } | null;

  const decision = decideConversionTargetDocumentLink({
    conversionRow: row,
    issuedDocumentId: params.issuedDocumentId,
  });
  if (decision.action === 'noop' || decision.action === 'idempotent') return;
  if (decision.action === 'conflict') {
    await writeAudit({
      organizationId: params.orgId,
      actorUserId: params.actorUserId,
      moduleCode: 'income',
      entityType: 'income_document_conversion',
      entityId: row!.id,
      action: AUDIT_ACTIONS.INCOME_DOCUMENT_CONVERSION_LINEAGE_CONFLICT,
      payload: {
        conversion_id: row!.id,
        source_document_id: row!.source_document_id,
        target_draft_id: row!.target_draft_id,
        existing_target_document_id: row!.target_document_id,
        attempted_issued_document_id: params.issuedDocumentId,
      },
    });
    throw conflict(decision.reason, 'INCOME_CONVERSION_LINEAGE_CONFLICT');
  }

  const { error: updateErr } = await supabaseAdmin
    .from('income_document_conversions')
    .update({
      target_document_id: params.issuedDocumentId,
      status: 'target_issued',
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', params.orgId)
    .eq('id', row!.id)
    .is('target_document_id', null);
  throwIfSupabaseError(updateErr, 'linkConversionTargetDocumentOnIssue');

  // Race: another worker linked first — re-read and enforce idempotency/conflict.
  const { data: after, error: afterErr } = await supabaseAdmin
    .from('income_document_conversions')
    .select('target_document_id')
    .eq('organization_id', params.orgId)
    .eq('id', row!.id)
    .maybeSingle();
  throwIfSupabaseError(afterErr, 'reloadConversionAfterIssueLink');
  const linkedId = (after as { target_document_id: string | null } | null)?.target_document_id ?? null;
  const afterDecision = decideConversionTargetDocumentLink({
    conversionRow: { target_document_id: linkedId },
    issuedDocumentId: params.issuedDocumentId,
  });
  if (afterDecision.action === 'conflict') {
    throw conflict(afterDecision.reason, 'INCOME_CONVERSION_LINEAGE_CONFLICT');
  }

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'income',
    entityType: 'income_document_conversion',
    entityId: row!.id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_CONVERSION_TARGET_LINKED,
    payload: {
      conversion_id: row!.id,
      source_document_id: row!.source_document_id,
      target_draft_id: row!.target_draft_id,
      target_document_id: params.issuedDocumentId,
      cancel_lineage_rule: CANCEL_SOURCE_CONVERSION_LINEAGE_RULE,
    },
  });
}

async function findConversionByIdempotency(orgId: string, key: string) {
  const { data, error } = await supabaseAdmin
    .from('income_document_conversions')
    .select(
      'id, source_document_id, source_document_type, target_document_type, conversion_type, target_draft_id, target_document_id, status, idempotency_key',
    )
    .eq('organization_id', orgId)
    .eq('idempotency_key', key)
    .maybeSingle();
  throwIfSupabaseError(error, 'findConversionByIdempotency', {
    migrationHint: '158_income_document_conversion_and_preliminary_cancel.sql',
  });
  return data as {
    id: string;
    source_document_id: string;
    source_document_type: string;
    target_document_type: string;
    conversion_type: string;
    target_draft_id: string;
    target_document_id: string | null;
    status: string;
    idempotency_key: string;
  } | null;
}

async function findOpenDraftConversion(
  orgId: string,
  sourceId: string,
  targetType: string,
) {
  const { data, error } = await supabaseAdmin
    .from('income_document_conversions')
    .select('id, target_draft_id, status, target_document_id')
    .eq('organization_id', orgId)
    .eq('source_document_id', sourceId)
    .eq('target_document_type', targetType)
    .eq('status', 'draft_created')
    .is('target_document_id', null)
    .maybeSingle();
  throwIfSupabaseError(error, 'findOpenDraftConversion');
  return data as { id: string; target_draft_id: string } | null;
}

async function buildConversionCommandResponse(params: {
  ctx: RequestContext;
  command:
    | typeof INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT
    | typeof INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT
    | typeof INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT;
  source: SourceDoc;
  draftId: string | null;
  replay: boolean;
  documentsListYear: number | null;
}): Promise<IncomeCommandResponse> {
  const sourceTypeKey = params.source.document_type as 'quote' | 'deal_invoice';
  const year =
    params.documentsListYear != null && Number.isFinite(params.documentsListYear)
      ? Number(params.documentsListYear)
      : new Date().getFullYear();

  const timings = createIncomeCommandTimings();

  // Pencil open: lean wizard_patch only. Do not rebuild full workspace / branding studio /
  // invoices history / by-type tables — the editor already has the list on screen.
  if (params.command === INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT && params.draftId) {
    const resumed = await resumeIncomeDocumentDraftFromContext(
      params.ctx,
      { draft_id: params.draftId },
      { leanDetails: true },
    );
    timings.mark('draft_load_ms');
    const workspace = await buildIncomeWorkspaceWizardPatchAggregate(
      resumed.scope,
      resumed.result.wizardOverlay,
      resumed.result.recipientOverlay,
      resumed.result.starting_step_key,
      { includeBrandingProfile: false },
    );
    timings.mark('wizard_patch_aggregate_ms');
    const snapshot = timings.snapshot();
    logIncomeCommandTimings(params.command, snapshot, {
      path: 'pencil_lean_open',
      draft_id: params.draftId,
    });
    return {
      ok: true,
      command: params.command,
      income_workspace_aggregate: workspace,
      meta: {
        idempotent_replay: params.replay,
        income_document_id: params.source.id,
        edited_draft_id: params.draftId,
        converted_draft_id: params.draftId,
        workspace_aggregate_mode: 'wizard_patch',
        command_timings: snapshot,
      },
    };
  }

  // When a staging/target draft is present, skip the unused full aggregate that was
  // previously built and immediately overwritten (major begin-edit / convert latency).
  let workspace: Awaited<ReturnType<typeof buildIncomeWorkspaceAggregate>>;
  let wizard_starting_step_key: string | null | undefined;
  if (params.draftId) {
    const resumed = await resumeIncomeDocumentDraftFromContext(params.ctx, {
      draft_id: params.draftId,
    });
    timings.mark('draft_load_ms');
    workspace = await buildIncomeWorkspaceAggregate(
      params.ctx,
      resumed.scope,
      resumed.result.recipientOverlay,
      resumed.result.wizardOverlay,
    );
    wizard_starting_step_key = resumed.result.starting_step_key;
    if (wizard_starting_step_key) {
      workspace = { ...workspace, wizard_starting_step_key };
    }
  } else {
    workspace = await buildIncomeWorkspaceAggregate(params.ctx);
  }

  const [context, invoicesTab, documentsByType] = await Promise.all([
    buildIncomeWorkspaceContextAggregate(params.ctx),
    buildWorkEngineInvoicesTabAggregate({ ctx: params.ctx }),
    params.source.represented_client_id
      ? buildWorkEngineInvoicesClientDocumentsByTypeAggregate({
          ctx: params.ctx,
          representedClientId: params.source.represented_client_id,
          documentTypeKey: sourceTypeKey,
          year,
        })
      : Promise.resolve(null),
  ]);
  timings.mark('invoices_tab_aggregate_ms');
  timings.mark('documents_by_type_aggregate_ms');
  const snapshot = timings.snapshot();
  logIncomeCommandTimings(params.command, snapshot, { path: 'conversion_full' });

  return {
    ok: true,
    command: params.command,
    income_workspace_aggregate: workspace,
    income_workspace_context_aggregate: context,
    work_engine_invoices_tab_aggregate: invoicesTab,
    work_engine_invoices_client_documents_by_type_aggregate: documentsByType ?? undefined,
    meta: {
      idempotent_replay: params.replay,
      income_document_id: params.source.id,
      command_timings: snapshot,
      ...(params.draftId && params.command === INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT
        ? { converted_draft_id: params.draftId }
        : {}),
    } as IncomeCommandResponse['meta'],
  };
}

async function findOpenPreliminaryEditDraft(params: {
  orgId: string;
  representedClientId: string;
  sourceDocumentId: string;
  documentType: string;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('id, document_settings_json')
    .eq('organization_id', params.orgId)
    .eq('represented_client_id', params.representedClientId)
    .eq('document_type', params.documentType)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(40);
  throwIfSupabaseError(error, 'findOpenPreliminaryEditDraft');
  for (const raw of data ?? []) {
    const row = raw as { id: string; document_settings_json: unknown };
    const settings =
      row.document_settings_json &&
      typeof row.document_settings_json === 'object' &&
      !Array.isArray(row.document_settings_json)
        ? (row.document_settings_json as Record<string, unknown>)
        : null;
    if (settings?.[PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY] === params.sourceDocumentId) {
      return row.id;
    }
  }
  return null;
}

/**
 * Null-only reconcile of an open preliminary-edit staging draft against the source document.
 * Preserves already-entered staging dates; heals empty document_date / due_date only.
 */
async function healPreliminaryEditStagingDraftDates(params: {
  orgId: string;
  draftId: string;
  source: SourceDoc;
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('id, document_date, due_date, draft_totals_preview_json')
    .eq('organization_id', params.orgId)
    .eq('id', params.draftId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadPreliminaryEditStagingForHeal');
  if (!data) return;
  const staging = data as {
    id: string;
    document_date: string | null;
    due_date: string | null;
    draft_totals_preview_json: unknown;
  };

  const heal = decidePreliminaryEditStagingDateHeal({
    stagingDocumentDate: staging.document_date,
    stagingDueDate: staging.due_date,
    sourceIssueDate: params.source.issue_date,
    sourceDueDate: params.source.due_date,
  });
  if (!heal.document_date && !heal.due_date) return;

  const priorPreview =
    staging.draft_totals_preview_json &&
    typeof staging.draft_totals_preview_json === 'object' &&
    !Array.isArray(staging.draft_totals_preview_json)
      ? (staging.draft_totals_preview_json as Record<string, unknown>)
      : {};
  const patch: Record<string, unknown> = { ...heal };
  // Keep same-number preview identity when healing stale staging rows.
  if (
    params.source.document_number &&
    (typeof priorPreview.document_number_preview !== 'string' ||
      !String(priorPreview.document_number_preview).trim())
  ) {
    patch.draft_totals_preview_json = {
      ...priorPreview,
      document_number_preview: params.source.document_number,
    };
  }

  const { error: updateErr } = await supabaseAdmin
    .from('income_document_drafts')
    .update(patch)
    .eq('organization_id', params.orgId)
    .eq('id', params.draftId)
    .eq('status', 'draft');
  throwIfSupabaseError(updateErr, 'healPreliminaryEditStagingDraftDates');
}

export async function executeBeginEditIncomePreliminaryDocument(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IncomeCommandResponse> {
  const orgId = ctx.organizationId!;
  if (!orgId) throw forbidden('Organization context required');

  const sourceDocumentId = String(body.income_document_id ?? body.source_document_id ?? '').trim();
  if (!sourceDocumentId) throw badRequest('income_document_id required');

  const documentsListYearRaw = body.documents_list_year;
  const documentsListYear =
    documentsListYearRaw == null || documentsListYearRaw === ''
      ? null
      : Number(documentsListYearRaw);

  const source = await loadSourceDocument(orgId, sourceDocumentId);
  if (!isPreliminaryEditableType(source.document_type)) {
    throw badRequest('Only quote or deal_invoice can be opened for edit');
  }
  if (source.document_status === 'cancelled_future') {
    throw badRequest('Cancelled documents cannot be edited');
  }
  if (source.document_status !== 'issued') {
    throw badRequest('Document cannot be edited');
  }
  if (!source.represented_client_id) {
    throw badRequest('Edit requires office represented client');
  }

  await applyOfficialIncomeIssuerContext(
    ctx,
    {
      acting_mode: 'office_representative',
      issuer_business_id: source.represented_client_id,
      represented_client_id: source.represented_client_id,
    },
    { source: INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT },
  );
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);

  const existingEditDraftId = await findOpenPreliminaryEditDraft({
    orgId,
    representedClientId: source.represented_client_id,
    sourceDocumentId: source.id,
    documentType: source.document_type,
  });
  if (existingEditDraftId) {
    await healPreliminaryEditStagingDraftDates({
      orgId,
      draftId: existingEditDraftId,
      source,
    });
    return buildConversionCommandResponse({
      ctx,
      command: INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT,
      source,
      draftId: existingEditDraftId,
      replay: true,
      documentsListYear,
    });
  }

  const { available_document_types } = await resolveAvailableDocumentTypes(scope.org_id, scope);
  assertDocumentTypeEnabled(available_document_types, source.document_type as IncomeDocumentType);
  const docType = findAvailableDocumentType(
    available_document_types,
    source.document_type as IncomeDocumentType,
  );
  if (!docType) throw badRequest('document_type is not available');

  const draftLines = draftLinesFromIssuedSnapshot(source.lines_snapshot_json, source.currency);
  const sourceDraftTerms = await loadSourceDraftTerms(orgId, source.source_draft_id);
  const documentSettings = resolveDocumentSettingsForConversion({
    sourceDraftSettingsJson: sourceDraftTerms.document_settings_json,
    sourceTotalsSnapshotJson: source.totals_snapshot_json,
  });
  const documentSettingsJson = {
    ...serializeConversionDocumentSettings(documentSettings),
    [PRELIMINARY_EDIT_SOURCE_DOCUMENT_ID_KEY]: source.id,
  };
  const customerPo =
    source.customer_po_reference ??
    sourceDraftTerms.customer_po_reference ??
    (typeof source.legal_snapshot_json?.customer_po_reference === 'string'
      ? String(source.legal_snapshot_json.customer_po_reference)
      : null);
  const oneTimeSnapshot =
    !source.income_customer_id && source.customer_snapshot_json
      ? source.customer_snapshot_json
      : null;

  const payload = {
    document_type: source.document_type as IncomeDocumentType,
    income_customer_id: source.income_customer_id,
    one_time_customer_snapshot_json: oneTimeSnapshot,
    draft_lines_json: serializeConvertedDraftLines(draftLines),
    payment_terms_json: sourceDraftTerms.payment_terms_json,
    due_date: source.due_date,
    document_date: source.issue_date,
    payment_received_json: null as Record<string, unknown> | null,
    notes: source.notes,
    currency: source.currency || 'ILS',
    language: source.language || 'he',
    document_settings_json: documentSettingsJson,
  };

  const { validation_warnings_json, draft_totals_preview_json } =
    await validateDraftAgainstDocumentTypeRules(payload, docType);
  const editDraftTotalsPreview = {
    ...draft_totals_preview_json,
    document_number_preview: source.document_number,
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('income_document_drafts')
    .insert({
      organization_id: scope.org_id,
      represented_client_id: scope.represented_client_id,
      issuer_business_id: scope.issuer_business_id,
      actor_user_id: scope.actor_user_id,
      acting_mode: scope.acting_mode,
      document_type: source.document_type,
      income_customer_id: source.income_customer_id,
      one_time_customer_snapshot_json: oneTimeSnapshot,
      draft_lines_json: serializeConvertedDraftLines(draftLines),
      payment_terms_json: sourceDraftTerms.payment_terms_json,
      due_date: source.due_date,
      document_date: source.issue_date,
      notes: source.notes,
      currency: source.currency || 'ILS',
      language: source.language || 'he',
      tax_allocation_number: source.tax_allocation_number,
      customer_po_reference: customerPo,
      document_settings_json: documentSettingsJson,
      draft_totals_preview_json: editDraftTotalsPreview,
      validation_warnings_json,
      status: 'draft',
      user_saved_at: null,
    })
    .select('id')
    .single();
  throwIfSupabaseError(insertErr, 'insertPreliminaryEditDraft');
  const draftId = String((inserted as { id: string }).id);

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draftId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_CREATED,
    payload: {
      edit_source_document_id: source.id,
      document_type: source.document_type,
      represented_client_id: source.represented_client_id,
      command: INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT,
    },
  });

  return buildConversionCommandResponse({
    ctx,
    command: INCOME_COMMAND_BEGIN_EDIT_PRELIMINARY_DOCUMENT,
    source,
    draftId,
    replay: false,
    documentsListYear,
  });
}

export async function executeConvertIncomeDocumentToDraft(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IncomeCommandResponse> {
  const orgId = ctx.organizationId!;
  if (!orgId) throw forbidden('Organization context required');

  const sourceDocumentId = String(body.source_document_id ?? body.income_document_id ?? '').trim();
  if (!sourceDocumentId) throw badRequest('source_document_id required');
  const targetTypeRaw = String(body.target_document_type ?? '').trim();
  if (!isIncomeConversionTargetType(targetTypeRaw)) {
    throw badRequest('target_document_type is invalid');
  }
  const targetType = targetTypeRaw as IncomeConversionTargetType;
  const idempotencyKey = String(body.idempotency_key ?? '').trim();
  if (!idempotencyKey) throw badRequest('idempotency_key required');
  if (idempotencyKey.length > 256) throw badRequest('idempotency_key too long');

  const documentsListYearRaw = body.documents_list_year;
  const documentsListYear =
    documentsListYearRaw == null || documentsListYearRaw === ''
      ? null
      : Number(documentsListYearRaw);

  const existing = await findConversionByIdempotency(orgId, idempotencyKey);
  if (existing) {
    const source = await loadSourceDocument(orgId, existing.source_document_id);
    if (source.represented_client_id) {
      await applyOfficialIncomeIssuerContext(
        ctx,
        {
          acting_mode: 'office_representative',
          issuer_business_id: source.represented_client_id,
          represented_client_id: source.represented_client_id,
        },
        { source: INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT },
      );
    }
    return buildConversionCommandResponse({
      ctx,
      command: INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT,
      source,
      draftId: existing.target_draft_id,
      replay: true,
      documentsListYear,
    });
  }

  const source = await loadSourceDocument(orgId, sourceDocumentId);
  if (!isIncomeConversionSourceType(source.document_type)) {
    throw badRequest('Only quote or deal_invoice can be converted');
  }
  if (source.document_status !== 'issued') {
    throw badRequest('Cancelled or inactive documents cannot be converted');
  }
  if (!source.represented_client_id) {
    throw badRequest('Conversion requires office represented client');
  }

  const sourceType = source.document_type as IncomeConversionSourceType;
  const allowed = sourceType === 'quote'
    ? (['deal_invoice', 'tax_invoice', 'tax_invoice_receipt'] as const)
    : (['tax_invoice', 'tax_invoice_receipt'] as const);
  if (!allowed.includes(targetType as never)) {
    throw badRequest(`Conversion ${sourceType} → ${targetType} is not allowed`);
  }

  await applyOfficialIncomeIssuerContext(
    ctx,
    {
      acting_mode: 'office_representative',
      issuer_business_id: source.represented_client_id,
      represented_client_id: source.represented_client_id,
    },
    { source: INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT },
  );
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);

  const openExisting = await findOpenDraftConversion(orgId, source.id, targetType);
  if (openExisting) {
    // Safe V1: one open draft per (source, target_type). Reuse instead of duplicating.
    return buildConversionCommandResponse({
      ctx,
      command: INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT,
      source,
      draftId: openExisting.target_draft_id,
      replay: true,
      documentsListYear,
    });
  }

  const { available_document_types } = await resolveAvailableDocumentTypes(scope.org_id, scope);
  assertDocumentTypeEnabled(available_document_types, targetType);
  const docType = findAvailableDocumentType(available_document_types, targetType);
  if (!docType) throw badRequest('target_document_type is not available');

  const draftLines = draftLinesFromIssuedSnapshot(source.lines_snapshot_json, source.currency);
  const sourceDraftTerms = await loadSourceDraftTerms(orgId, source.source_draft_id);
  const documentSettings = resolveDocumentSettingsForConversion({
    sourceDraftSettingsJson: sourceDraftTerms.document_settings_json,
    sourceTotalsSnapshotJson: source.totals_snapshot_json,
  });
  const documentSettingsJson = serializeConversionDocumentSettings(documentSettings);
  const customerPo =
    source.customer_po_reference ??
    sourceDraftTerms.customer_po_reference ??
    (typeof source.legal_snapshot_json?.customer_po_reference === 'string'
      ? String(source.legal_snapshot_json.customer_po_reference)
      : null);

  const oneTimeSnapshot =
    !source.income_customer_id && source.customer_snapshot_json
      ? source.customer_snapshot_json
      : null;

  const payload = {
    document_type: targetType as IncomeDocumentType,
    income_customer_id: source.income_customer_id,
    one_time_customer_snapshot_json: oneTimeSnapshot,
    draft_lines_json: serializeConvertedDraftLines(draftLines),
    payment_terms_json: sourceDraftTerms.payment_terms_json,
    due_date: source.due_date,
    document_date: null as string | null,
    payment_received_json: null as Record<string, unknown> | null,
    notes: source.notes,
    currency: source.currency || 'ILS',
    language: source.language || 'he',
    document_settings_json: documentSettingsJson,
  };

  const { validation_warnings_json, draft_totals_preview_json } =
    await validateDraftAgainstDocumentTypeRules(payload, docType);

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('income_document_drafts')
    .insert({
      organization_id: scope.org_id,
      represented_client_id: scope.represented_client_id,
      issuer_business_id: scope.issuer_business_id,
      actor_user_id: scope.actor_user_id,
      acting_mode: scope.acting_mode,
      document_type: targetType,
      income_customer_id: source.income_customer_id,
      one_time_customer_snapshot_json: oneTimeSnapshot,
      draft_lines_json: serializeConvertedDraftLines(draftLines),
      payment_terms_json: sourceDraftTerms.payment_terms_json,
      due_date: source.due_date,
      notes: source.notes,
      currency: source.currency || 'ILS',
      language: source.language || 'he',
      tax_allocation_number: source.tax_allocation_number,
      customer_po_reference: customerPo,
      document_settings_json: documentSettingsJson,
      draft_totals_preview_json,
      validation_warnings_json,
      status: 'draft',
      user_saved_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  throwIfSupabaseError(insertErr, 'insertConvertedDraft', {
    migrationHint: '158_income_document_conversion_and_preliminary_cancel.sql',
  });
  const draftId = String((inserted as { id: string }).id);

  const { error: convErr } = await supabaseAdmin.from('income_document_conversions').insert({
    organization_id: orgId,
    source_document_id: source.id,
    source_document_type: sourceType,
    target_document_type: targetType,
    conversion_type: conversionTypeKey(sourceType, targetType),
    target_draft_id: draftId,
    status: 'draft_created',
    idempotency_key: idempotencyKey,
    created_by: ctx.user.id,
  });
  if (convErr) {
    // Cleanup orphan draft on lineage failure
    await supabaseAdmin
      .from('income_document_drafts')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', draftId)
      .eq('organization_id', orgId);
    if (String(convErr.code ?? '') === '23505') {
      const raced = await findConversionByIdempotency(orgId, idempotencyKey);
      if (raced) {
        return buildConversionCommandResponse({
          ctx,
          command: INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT,
          source,
          draftId: raced.target_draft_id,
          replay: true,
          documentsListYear,
        });
      }
      throw conflict('Conversion already in progress for this source and target type');
    }
    throwIfSupabaseError(convErr, 'insertConversionLineage');
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'income',
    entityType: 'income_document_conversion',
    entityId: draftId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_CONVERSION_CREATED,
    payload: {
      source_document_id: source.id,
      source_document_type: sourceType,
      source_document_number: source.document_number,
      target_document_type: targetType,
      conversion_type: conversionTypeKey(sourceType, targetType),
      target_draft_id: draftId,
      represented_client_id: source.represented_client_id,
      idempotency_key: idempotencyKey,
    },
  });

  return buildConversionCommandResponse({
    ctx,
    command: INCOME_COMMAND_CONVERT_DOCUMENT_TO_DRAFT,
    source,
    draftId,
    replay: false,
    documentsListYear,
  });
}

export async function executeCancelIncomePreliminaryDocument(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IncomeCommandResponse> {
  const orgId = ctx.organizationId!;
  if (!orgId) throw forbidden('Organization context required');

  const documentId = String(body.income_document_id ?? body.source_document_id ?? '').trim();
  if (!documentId) throw badRequest('income_document_id required');
  const reason = String(body.reason ?? '').trim() || null;

  const documentsListYearRaw = body.documents_list_year;
  const documentsListYear =
    documentsListYearRaw == null || documentsListYearRaw === ''
      ? null
      : Number(documentsListYearRaw);

  const source = await loadSourceDocument(orgId, documentId);
  if (isTaxDocumentDirectCancelForbidden(source.document_type)) {
    throw badRequest(
      'Issued tax documents cannot be cancelled directly. Use credit tax invoice workflow.',
    );
  }
  if (!isPreliminaryCancellableType(source.document_type)) {
    throw badRequest('Only quote or deal_invoice can be cancelled with this command');
  }
  if (source.document_status === 'cancelled_future') {
    // Idempotent cancel
    if (source.represented_client_id) {
      await applyOfficialIncomeIssuerContext(
        ctx,
        {
          acting_mode: 'office_representative',
          issuer_business_id: source.represented_client_id,
          represented_client_id: source.represented_client_id,
        },
        { source: INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT },
      );
    }
    return buildConversionCommandResponse({
      ctx,
      command: INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT,
      source,
      draftId: null,
      replay: true,
      documentsListYear,
    });
  }
  if (source.document_status !== 'issued') {
    throw badRequest('Document cannot be cancelled');
  }
  if (!source.represented_client_id) {
    throw badRequest('Cancel requires office represented client');
  }

  await applyOfficialIncomeIssuerContext(
    ctx,
    {
      acting_mode: 'office_representative',
      issuer_business_id: source.represented_client_id,
      represented_client_id: source.represented_client_id,
    },
    { source: INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT },
  );
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);

  const { error } = await supabaseAdmin
    .from('income_documents')
    .update({
      document_status: 'cancelled_future',
      cancelled_at: new Date().toISOString(),
      cancelled_by_user_id: ctx.user.id,
      cancel_reason: reason,
    })
    .eq('organization_id', orgId)
    .eq('id', source.id)
    .eq('document_status', 'issued');
  throwIfSupabaseError(error, 'cancelPreliminaryDocument', {
    migrationHint: '158_income_document_conversion_and_preliminary_cancel.sql',
  });

  const cancelled = { ...source, document_status: 'cancelled_future' };

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'income',
    entityType: 'income_document',
    entityId: source.id,
    action: AUDIT_ACTIONS.INCOME_PRELIMINARY_DOCUMENT_CANCELLED,
    payload: {
      income_document_id: source.id,
      document_type: source.document_type,
      document_number: source.document_number,
      reason,
      represented_client_id: source.represented_client_id,
    },
  });

  return buildConversionCommandResponse({
    ctx,
    command: INCOME_COMMAND_CANCEL_PRELIMINARY_DOCUMENT,
    source: cancelled,
    draftId: null,
    replay: false,
    documentsListYear,
  });
}
