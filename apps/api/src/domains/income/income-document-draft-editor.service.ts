/**
 * Work Engine wizard — granular income draft mutations (command-only writes).
 */

import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import { assertRowMatchesIssuerScope } from './income.guards.js';
import { validateDraftAgainstDocumentTypeRules } from './income-document-draft.helpers.js';
import {
  buildIncomeDocumentDetailsStep,
  type IncomeDocumentDetailsStep,
  type IncomeWizardDraftRow,
} from './income-document-details-step.builders.js';
import {
  applyLineFieldUpdate,
  createEmptyDraftLine,
  deleteDraftLine,
  normalizeDraftLines,
  reorderDraftLines,
  serializeDraftLines,
} from './income-document-draft-lines.pure.js';
import { recomputeDraftLineAmounts } from './income-draft-line-compute.pure.js';
import {
  computeDraftTotalsPreview,
  DEFAULT_DOCUMENT_SETTINGS,
  parseDocumentSettingsJson,
  serializeDocumentSettingsJson,
} from './income-document-draft-totals.pure.js';
import {
  normalizeDocumentDiscountInput,
  validateDocumentDiscount,
} from './income-document-discount.pure.js';
import {
  readVatResolutionFromDraftPreview,
  vatResolutionCachePayload,
} from './income-draft-vat-fallback.pure.js';
import { resolveIncomeDraftVatForOrg, type IncomeDraftVatResolution } from './income-draft-vat-resolver.js';
import type { DraftTotalsPreview } from './income-document-draft-totals.pure.js';
import { previewNextIncomeDocumentNumber } from './income-document-numbering.service.js';
import { findAvailableDocumentType, resolveAvailableDocumentTypes } from './income-document-types.resolver.js';
import type { IncomeAvailableDocumentType, IncomeDocumentType } from './income.types.js';
import { optionalJsonObject, optionalString, optionalUuid, parseIncomeDocumentType, reqUuid } from './income.guards.js';
import type { RecipientSearchOverlay } from './income-recipient.service.js';
import {
  loadIncomeRecipientById,
  selectedFromSavedRow,
  type IncomeRecipientSelected,
} from './income-recipient.service.js';
import type { RequestContext } from '../../shared/context.js';
import { hasPermission } from '../rbac/rbac.service.js';
import { INCOME_PERMISSIONS } from './income.types.js';

async function loadIssuerDisplayName(orgId: string, issuerBusinessId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, display_name')
    .eq('organization_id', orgId)
    .eq('id', issuerBusinessId)
    .maybeSingle();
  if (error) throw error;
  const row = data as { display_name?: string } | null;
  return row?.display_name?.trim() ? String(row.display_name).trim() : '—';
}

function scopePermissionsFromContext(ctx: RequestContext): ActiveIncomeIssuerScope['permissions'] {
  const perms = ctx.membership?.permissions ?? [];
  return {
    view: hasPermission(perms, INCOME_PERMISSIONS.view),
    edit: hasPermission(perms, INCOME_PERMISSIONS.edit),
    issue: hasPermission(perms, INCOME_PERMISSIONS.issue),
    issue_on_behalf: hasPermission(perms, INCOME_PERMISSIONS.issueOnBehalf),
  };
}

async function buildScopeForDraftResume(ctx: RequestContext, draft: { issuer_business_id: string; represented_client_id: string | null }): Promise<ActiveIncomeIssuerScope> {
  const orgId = ctx.organizationId;
  if (!orgId) throw badRequest('Organization context required');
  const issuerLabel = await loadIssuerDisplayName(orgId, draft.issuer_business_id);
  const acting_mode = draft.represented_client_id ? 'office_representative' : 'self';
  return {
    org_id: orgId,
    actor_user_id: ctx.user.id,
    acting_mode,
    issuer_business_id: draft.issuer_business_id,
    represented_client_id: draft.represented_client_id,
    issuer_label: issuerLabel,
    represented_client_label: draft.represented_client_id ? issuerLabel : null,
    permissions: scopePermissionsFromContext(ctx),
  };
}

export async function resumeIncomeDocumentDraftFromContext(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<{ scope: ActiveIncomeIssuerScope; result: WizardDraftResumeResult }> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const orgId = ctx.organizationId;
  if (!orgId) throw badRequest('Organization context required');

  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select('id, organization_id, issuer_business_id, represented_client_id')
    .eq('organization_id', orgId)
    .eq('id', draft_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw notFound('Income document draft not found');
  const row = data as { issuer_business_id: string; represented_client_id: string | null };
  const scope = await buildScopeForDraftResume(ctx, row);
  // Permission + scope enforced before resume.
  if (!scope.permissions.edit) throw badRequest('נדרשת הרשאת income.edit');
  const result = await resumeIncomeDocumentDraft(scope, { draft_id });
  return { scope, result };
}

export type WizardDraftOverlay = {
  active_wizard_draft_id?: string;
  document_details_step?: IncomeDocumentDetailsStep | null;
};

export type WizardDraftResumeResult = {
  wizardOverlay: WizardDraftOverlay;
  recipientOverlay: RecipientSearchOverlay;
  starting_step_key: string;
};

const DRAFT_SELECT =
  'id, organization_id, issuer_business_id, represented_client_id, document_type, document_date, due_date, notes, currency, language, draft_lines_json, payment_received_json, delivery_contact_json, document_settings_json, validation_warnings_json, draft_totals_preview_json, income_customer_id, one_time_customer_snapshot_json, status, updated_at';

export async function loadWizardDraftRow(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
): Promise<IncomeWizardDraftRow & { status: string }> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select(DRAFT_SELECT)
    .eq('id', draftId)
    .eq('organization_id', scope.org_id)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadWizardDraftRow');
  if (!data) throw notFound('Income document draft not found');
  const row = data as IncomeWizardDraftRow & {
    organization_id: string;
    issuer_business_id: string;
    represented_client_id: string | null;
    status: string;
  };
  assertRowMatchesIssuerScope(scope, row);
  return row;
}

async function persistWizardDraft(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
  patch: Record<string, unknown>,
  auditPayload: Record<string, unknown>,
  existingRow?: (IncomeWizardDraftRow & { status: string }) | null,
): Promise<IncomeWizardDraftRow & { status: string }> {
  const existing = existingRow ?? (await loadWizardDraftRow(scope, draftId));
  if (existing.status !== 'draft') throw badRequest('Draft is not editable');

  const { error } = await supabaseAdmin
    .from('income_document_drafts')
    .update(patch)
    .eq('id', draftId)
    .eq('organization_id', scope.org_id);
  if (error) throw error;

  void writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draftId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_UPDATED,
    payload: auditPayload,
  }).catch(() => {
    /* audit must not block wizard UX */
  });

  return { ...existing, ...patch, id: draftId, status: existing.status } as IncomeWizardDraftRow & {
    status: string;
  };
}

function recipientFieldsFromSelected(
  selected: IncomeRecipientSelected,
): { income_customer_id: string | null; one_time_customer_snapshot_json: Record<string, unknown> | null } {
  if (selected.kind === 'saved') {
    return { income_customer_id: selected.income_customer_id, one_time_customer_snapshot_json: null };
  }
  return { income_customer_id: null, one_time_customer_snapshot_json: selected.snapshot };
}

async function deliveryEmailFromRecipient(
  scope: ActiveIncomeIssuerScope,
  selected: IncomeRecipientSelected | null | undefined,
): Promise<string | null> {
  if (!selected) return null;
  if (selected.kind === 'snapshot') {
    const email = selected.snapshot?.email;
    return typeof email === 'string' && email.trim() ? email.trim() : null;
  }
  const row = await loadIncomeRecipientById(scope, selected.income_customer_id);
  return row?.email?.trim() ? row.email.trim() : null;
}

async function resolveDocType(
  scope: ActiveIncomeIssuerScope,
  documentType: IncomeDocumentType,
): Promise<IncomeAvailableDocumentType> {
  const { available_document_types } = await resolveAvailableDocumentTypes(scope.org_id, scope);
  const docType = findAvailableDocumentType(available_document_types, documentType);
  if (!docType) throw badRequest('document_type is invalid');
  return docType;
}

async function buildOverlayForDraft(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
  canEdit: boolean,
  rowOverride?: IncomeWizardDraftRow & { status?: string },
  docTypeOverride?: IncomeAvailableDocumentType | null,
  stepOptions?: {
    vatResolution?: IncomeDraftVatResolution;
    totalsPreview?: DraftTotalsPreview;
  },
): Promise<WizardDraftOverlay> {
  const row = rowOverride ?? (await loadWizardDraftRow(scope, draftId));
  const docType =
    docTypeOverride !== undefined
      ? docTypeOverride
      : row.document_type != null
        ? await resolveDocType(scope, row.document_type)
        : null;
  const step = await buildIncomeDocumentDetailsStep(scope, row, docType, canEdit, stepOptions ?? {});
  return { active_wizard_draft_id: draftId, document_details_step: step };
}

async function validationForRow(
  scope: ActiveIncomeIssuerScope,
  row: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType,
): Promise<{
  validation_warnings_json: Record<string, unknown>[];
  draft_totals_preview_json: Record<string, unknown>;
  draft_lines_json: unknown[];
  vatResolution: IncomeDraftVatResolution;
  totalsPreview: DraftTotalsPreview;
}> {
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const documentDate = row.document_date ?? new Date().toISOString().slice(0, 10);
  let vatResolution = readVatResolutionFromDraftPreview(row.draft_totals_preview_json, documentDate);
  if (!vatResolution) {
    vatResolution = await resolveIncomeDraftVatForOrg(scope.org_id, 'IL', documentDate);
  }
  const lines = await recomputeDraftLineAmounts(
    normalizeDraftLines(row.draft_lines_json),
    settings,
    vatResolution,
    documentDate,
  );
  const totalsPreview = await computeDraftTotalsPreview(
    lines,
    'ILS',
    settings,
    vatResolution,
    documentDate,
  );
  const { validation_warnings_json } = await validateDraftAgainstDocumentTypeRules(
    {
      document_type: row.document_type,
      income_customer_id: row.income_customer_id ?? null,
      one_time_customer_snapshot_json: row.one_time_customer_snapshot_json ?? null,
      draft_lines_json: serializeDraftLines(lines),
      payment_terms_json: null,
      due_date: row.due_date,
      document_date: row.document_date,
      payment_received_json: row.payment_received_json,
      notes: row.notes,
      currency: row.currency,
      language: row.language,
      document_settings_json: row.document_settings_json,
    },
    docType,
  );

  const priorCache =
    row.draft_totals_preview_json &&
    typeof row.draft_totals_preview_json === 'object' &&
    !Array.isArray(row.draft_totals_preview_json)
      ? (row.draft_totals_preview_json as Record<string, unknown>)
      : {};

  let document_number_preview =
    typeof priorCache.document_number_preview === 'string'
      ? priorCache.document_number_preview
      : null;
  let recipient_display_name =
    typeof priorCache.recipient_display_name === 'string'
      ? priorCache.recipient_display_name
      : null;

  if (!document_number_preview && row.document_type) {
    document_number_preview = await previewNextIncomeDocumentNumber(scope, row.document_type);
  }
  if (!recipient_display_name) {
    const snap = row.one_time_customer_snapshot_json;
    if (snap && typeof snap.display_name === 'string' && snap.display_name.trim()) {
      recipient_display_name = snap.display_name.trim();
    } else if (row.income_customer_id) {
      const customer = await loadIncomeRecipientById(scope, row.income_customer_id);
      recipient_display_name = customer?.display_name?.trim() ?? null;
    }
  }

  const draft_totals_preview_json = {
    ...totalsPreview,
    document_number_preview,
    recipient_display_name,
    vat_resolution_cache: vatResolutionCachePayload(documentDate, vatResolution),
  };

  return {
    validation_warnings_json,
    draft_totals_preview_json,
    draft_lines_json: serializeDraftLines(lines),
    vatResolution,
    totalsPreview,
  };
}

/** Resolve wizard draft recipient from overlay or begin_wizard command body (backend truth). */
export async function resolveIncomeRecipientSelectedForDraft(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
  recipientOverlay: RecipientSearchOverlay = {},
): Promise<IncomeRecipientSelected> {
  if (recipientOverlay.selected) return recipientOverlay.selected;

  const income_customer_id = optionalUuid(body.income_customer_id, 'income_customer_id');
  const one_time_customer_snapshot_json = optionalJsonObject(
    body.one_time_customer_snapshot_json,
    'one_time_customer_snapshot_json',
  );
  if (income_customer_id) {
    const row = await loadIncomeRecipientById(scope, income_customer_id);
    if (!row) throw badRequest('Income recipient not found');
    return selectedFromSavedRow(row);
  }
  if (one_time_customer_snapshot_json) {
    return {
      kind: 'snapshot',
      income_customer_id: null,
      display_line: String(one_time_customer_snapshot_json.display_name ?? 'מקבל'),
      snapshot: one_time_customer_snapshot_json,
    };
  }
  throw badRequest('Select a document recipient before document details');
}

export type BeginWizardDraftResult = {
  wizardOverlay: WizardDraftOverlay;
  recipientOverlay: RecipientSearchOverlay;
};

export async function beginIncomeWizardDocumentDraft(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
  recipientOverlay: RecipientSearchOverlay = {},
): Promise<BeginWizardDraftResult> {
  const document_type = parseIncomeDocumentType(body.document_type);
  if (!document_type) throw badRequest('document_type is required');
  const docType = await resolveDocType(scope, document_type);

  const selected = await resolveIncomeRecipientSelectedForDraft(scope, body, recipientOverlay);
  const recipient = recipientFieldsFromSelected(selected);

  const document_date =
    optionalString(body.document_date) ?? new Date().toISOString().slice(0, 10);
  const lines = [createEmptyDraftLine(0)];
  const settings = { ...DEFAULT_DOCUMENT_SETTINGS };
  const currency = optionalString(body.currency) ?? 'ILS';
  const language = optionalString(body.language) === 'en' ? 'en' : 'he';

  const prefilledEmail = await deliveryEmailFromRecipient(scope, selected);
  const draftRow: IncomeWizardDraftRow = {
    id: '',
    document_type,
    document_date,
    due_date: null,
    notes: null,
    currency,
    language,
    draft_lines_json: serializeDraftLines(lines),
    payment_received_json: null,
    delivery_contact_json: prefilledEmail
      ? { email: prefilledEmail, snapshot_only: true }
      : null,
    document_settings_json: settings,
    validation_warnings_json: [],
    income_customer_id: recipient.income_customer_id,
    one_time_customer_snapshot_json: recipient.one_time_customer_snapshot_json,
  };

  const { validation_warnings_json, draft_totals_preview_json } = await validationForRow(scope, draftRow, docType);

  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .insert({
      organization_id: scope.org_id,
      represented_client_id: scope.represented_client_id,
      issuer_business_id: scope.issuer_business_id,
      actor_user_id: scope.actor_user_id,
      acting_mode: scope.acting_mode,
      document_type,
      income_customer_id: recipient.income_customer_id,
      one_time_customer_snapshot_json: recipient.one_time_customer_snapshot_json,
      draft_lines_json: serializeDraftLines(lines),
      document_date,
      currency,
      language,
      notes: null,
      due_date: null,
      payment_received_json: null,
      delivery_contact_json: draftRow.delivery_contact_json,
      document_settings_json: settings,
      draft_totals_preview_json,
      validation_warnings_json,
      status: 'draft',
    })
    .select('id')
    .single();
  throwIfSupabaseError(error, 'beginIncomeWizardDocumentDraft');

  const draftId = String((data as { id: string }).id);
  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draftId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_CREATED,
    payload: {
      document_type,
      wizard: true,
      line_count: 1,
      income_customer_id: recipient.income_customer_id,
      one_time_snapshot: recipient.one_time_customer_snapshot_json != null,
    },
  });

  return {
    wizardOverlay: await buildOverlayForDraft(scope, draftId, true),
    recipientOverlay: { selected },
  };
}

async function wizardDraftMutationOverlay(
  scope: ActiveIncomeIssuerScope,
  draft_id: string,
  loadedRow: IncomeWizardDraftRow & { status: string },
  rowForValidation: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType,
  persistPatch: Record<string, unknown>,
  auditPayload: Record<string, unknown>,
  options?: { totals_preview_patch?: Record<string, unknown> },
): Promise<WizardDraftOverlay> {
  const validation = await validationForRow(scope, rowForValidation, docType);
  const draftTotalsPatched =
    options?.totals_preview_patch && validation.draft_totals_preview_json
      ? { ...validation.draft_totals_preview_json, ...options.totals_preview_patch }
      : validation.draft_totals_preview_json;
  const saved = await persistWizardDraft(
    scope,
    draft_id,
    {
      ...persistPatch,
      draft_lines_json: validation.draft_lines_json,
      validation_warnings_json: validation.validation_warnings_json,
      draft_totals_preview_json: draftTotalsPatched,
    },
    auditPayload,
    loadedRow,
  );
  return buildOverlayForDraft(scope, draft_id, true, saved, docType, {
    vatResolution: validation.vatResolution,
    totalsPreview: validation.totalsPreview,
  });
}

export async function updateIncomeDocumentDiscount(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const row = await loadWizardDraftRow(scope, draft_id);
  if (!row.document_type) throw badRequest('document_type is required');
  const docType = await resolveDocType(scope, row.document_type);
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const enabled = body.enabled === true;
  const discount = normalizeDocumentDiscountInput(enabled, body.type, body.value);

  const documentDate = row.document_date ?? new Date().toISOString().slice(0, 10);
  let vatResolution = readVatResolutionFromDraftPreview(row.draft_totals_preview_json, documentDate);
  if (!vatResolution) {
    vatResolution = await resolveIncomeDraftVatForOrg(scope.org_id, 'IL', documentDate);
  }
  const lines = await recomputeDraftLineAmounts(
    normalizeDraftLines(row.draft_lines_json),
    settings,
    vatResolution,
    documentDate,
  );
  const preTotals = await computeDraftTotalsPreview(
    lines,
    row.currency,
    settings,
    vatResolution,
    documentDate,
  );
  const subtotalBefore = preTotals.subtotal_before_discount_reference ?? 0;
  const fieldErrors = validateDocumentDiscount(discount, subtotalBefore);
  if (Object.keys(fieldErrors).length > 0) {
    throw badRequest(fieldErrors.value ?? 'Invalid document discount');
  }

  const nextSettings = { ...settings, discount };
  const patch = { document_settings_json: serializeDocumentSettingsJson(nextSettings) };
  const merged = { ...row, ...patch } as IncomeWizardDraftRow;

  const priorCache =
    row.draft_totals_preview_json &&
    typeof row.draft_totals_preview_json === 'object' &&
    !Array.isArray(row.draft_totals_preview_json)
      ? (row.draft_totals_preview_json as Record<string, unknown>)
      : {};
  const totalsPreviewPatch =
    typeof priorCache.preview_generated_at === 'string'
      ? { preview_generated_at: new Date().toISOString() }
      : {};

  const overlay = await wizardDraftMutationOverlay(
    scope,
    draft_id,
    row,
    merged,
    docType,
    patch,
    { action: 'update_discount', type: discount.type, value: discount.value, enabled: discount.enabled },
    { totals_preview_patch: totalsPreviewPatch },
  );

  void writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draft_id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DISCOUNT_UPDATED,
    payload: { draft_id, type: discount.type, value: discount.value, enabled: discount.enabled },
  }).catch(() => {
    /* audit must not block wizard UX */
  });

  return overlay;
}

export async function generateIncomeDocumentPreview(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const row = await loadWizardDraftRow(scope, draft_id);
  if (!row.document_type) {
    throw badRequest('document_type is required before preview', 'INCOME_PREVIEW_DOCUMENT_TYPE_REQUIRED');
  }
  const docType = await resolveDocType(scope, row.document_type);

  const overlay = await wizardDraftMutationOverlay(
    scope,
    draft_id,
    row,
    row,
    docType,
    {},
    { action: 'generate_preview', document_type: row.document_type },
    { totals_preview_patch: { preview_generated_at: new Date().toISOString() } },
  );

  void writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draft_id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_PREVIEW_GENERATED,
    payload: { draft_id, preview_mode: 'wizard_step', document_type: row.document_type, issuer_scope: scope.acting_mode },
  }).catch(() => {
    /* audit must not block preview UX */
  });

  return overlay;
}

export async function addIncomeDocumentLine(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const row = await loadWizardDraftRow(scope, draft_id);
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const lines = normalizeDraftLines(row.draft_lines_json);
  lines.push(
    createEmptyDraftLine(lines.length, {
      currency: 'ILS',
      vat_rate_code: settings.vat_mode === 'exempt' ? 'exempt' : 'standard',
      price_includes_vat: false,
    }),
  );
  const docType = await resolveDocType(scope, row.document_type!);
  const serialized = serializeDraftLines(lines);
  return wizardDraftMutationOverlay(
    scope,
    draft_id,
    row,
    { ...row, draft_lines_json: serialized },
    docType,
    { draft_lines_json: serialized },
    { action: 'add_line', line_count: lines.length },
  );
}

export async function updateIncomeDocumentLine(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const line_id = String(body.line_id ?? '').trim();
  if (!line_id) throw badRequest('line_id is required');
  const row = await loadWizardDraftRow(scope, draft_id);
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  let lines = applyLineFieldUpdate(normalizeDraftLines(row.draft_lines_json), line_id, body);
  lines = lines.map((l) => ({
    ...l,
    vat_rate_code: settings.vat_mode === 'exempt' ? 'exempt' : 'standard',
  }));
  const docType = await resolveDocType(scope, row.document_type!);
  const serialized = serializeDraftLines(lines);
  return wizardDraftMutationOverlay(
    scope,
    draft_id,
    row,
    { ...row, draft_lines_json: serialized },
    docType,
    { draft_lines_json: serialized },
    { action: 'update_line', line_id },
  );
}

export async function deleteIncomeDocumentLine(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const line_id = String(body.line_id ?? '').trim();
  if (!line_id) throw badRequest('line_id is required');
  const row = await loadWizardDraftRow(scope, draft_id);
  const lines = deleteDraftLine(normalizeDraftLines(row.draft_lines_json), line_id);
  const docType = await resolveDocType(scope, row.document_type!);
  const serialized = serializeDraftLines(lines);
  return wizardDraftMutationOverlay(
    scope,
    draft_id,
    row,
    { ...row, draft_lines_json: serialized },
    docType,
    { draft_lines_json: serialized },
    { action: 'delete_line', line_id },
  );
}

export async function reorderIncomeDocumentLines(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const ordered = body.ordered_line_ids;
  if (!Array.isArray(ordered)) throw badRequest('ordered_line_ids must be an array');
  const ordered_line_ids = ordered.map((id) => String(id));
  const row = await loadWizardDraftRow(scope, draft_id);
  const lines = reorderDraftLines(normalizeDraftLines(row.draft_lines_json), ordered_line_ids);
  const docType = await resolveDocType(scope, row.document_type!);
  const serialized = serializeDraftLines(lines);
  return wizardDraftMutationOverlay(
    scope,
    draft_id,
    row,
    { ...row, draft_lines_json: serialized },
    docType,
    { draft_lines_json: serialized },
    { action: 'reorder_lines' },
  );
}

export async function updateIncomeDocumentDraftSettings(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const row = await loadWizardDraftRow(scope, draft_id);
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const key = String(body.setting_key ?? '').trim();
  const value = body.setting_value;

  const patch: Record<string, unknown> = {};

  if (key === 'document_date') {
    const s = optionalString(value);
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('document_date must be YYYY-MM-DD');
    patch.document_date = s;
  } else if (key === 'currency') {
    const c = optionalString(value) ?? 'ILS';
    patch.currency = c;
  } else if (key === 'language') {
    const lang = optionalString(value) ?? 'he';
    if (lang !== 'he' && lang !== 'en') throw badRequest('language must be he or en');
    patch.language = lang;
  } else if (key === 'due_date') {
    const s = optionalString(value);
    patch.due_date = s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  } else if (key === 'payment_received_note') {
    const note = optionalString(value);
    patch.payment_received_json = note ? { note } : null;
  } else if (key === 'vat_mode') {
    if (value !== 'standard' && value !== 'exempt') {
      throw badRequest('invalid vat_mode');
    }
    patch.document_settings_json = { ...settings, vat_mode: value };
  } else if (key === 'amount_rounding') {
    if (value !== 'none' && value !== 'nearest_agora') throw badRequest('invalid amount_rounding');
    patch.document_settings_json = { ...settings, amount_rounding: value };
  } else {
    throw badRequest(`Unknown setting_key: ${key}`);
  }

  const merged = { ...row, ...patch } as IncomeWizardDraftRow;
  const docType = await resolveDocType(scope, row.document_type!);
  return wizardDraftMutationOverlay(scope, draft_id, row, merged, docType, patch, {
    action: 'update_settings',
    setting_key: key,
  });
}

export async function updateIncomeDocumentNotes(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const notes = optionalString(body.notes);
  const row = await loadWizardDraftRow(scope, draft_id);
  const docType = await resolveDocType(scope, row.document_type!);
  const merged = { ...row, notes: notes ?? null };
  return wizardDraftMutationOverlay(scope, draft_id, row, merged, docType, { notes: notes ?? null }, {
    action: 'update_notes',
  });
}

export async function updateIncomeDocumentDeliveryContact(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const email = optionalString(body.email);
  const delivery_contact_json = email
    ? { email, snapshot_only: true, updated_at: new Date().toISOString() }
    : null;
  const row = await loadWizardDraftRow(scope, draft_id);
  const docType =
    row.document_type != null ? await resolveDocType(scope, row.document_type) : null;
  const saved = await persistWizardDraft(
    scope,
    draft_id,
    { delivery_contact_json },
    { action: 'update_delivery_contact', snapshot_only: true },
  );
  return buildOverlayForDraft(scope, draft_id, true, saved, docType);
}

export async function saveIncomeDocumentDraft(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const row = await loadWizardDraftRow(scope, draft_id);
  const docType = await resolveDocType(scope, row.document_type!);
  // Re-run validation + totals + BOI FX resolution and persist refreshed preview JSON.
  return wizardDraftMutationOverlay(
    scope,
    draft_id,
    row,
    row,
    docType,
    {},
    { action: 'save_draft' },
  );
}

function startingStepKeyForDraftRow(row: IncomeWizardDraftRow): string {
  if (!row.document_type) return 'document_type';
  if (!row.income_customer_id && !row.one_time_customer_snapshot_json) return 'recipient';
  return 'document_details';
}

async function recipientOverlayForDraftRow(
  scope: ActiveIncomeIssuerScope,
  row: IncomeWizardDraftRow,
): Promise<RecipientSearchOverlay> {
  if (row.income_customer_id) {
    const saved = await loadIncomeRecipientById(scope, row.income_customer_id);
    return saved ? { selected: selectedFromSavedRow(saved) } : {};
  }
  if (row.one_time_customer_snapshot_json) {
    const snap = row.one_time_customer_snapshot_json;
    return {
      selected: {
        kind: 'snapshot',
        income_customer_id: null,
        display_line: String(snap.display_name ?? 'מקבל'),
        snapshot: snap,
      } satisfies IncomeRecipientSelected,
    };
  }
  return {};
}

export async function resumeIncomeDocumentDraft(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftResumeResult> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const row = await loadWizardDraftRow(scope, draft_id);
  const starting_step_key = startingStepKeyForDraftRow(row);
  const recipientOverlay = await recipientOverlayForDraftRow(scope, row);

  const wizardOverlay: WizardDraftOverlay =
    starting_step_key === 'document_details'
      ? await buildOverlayForDraft(
          scope,
          draft_id,
          true,
          row,
          row.document_type ? await resolveDocType(scope, row.document_type) : null,
        )
      : { active_wizard_draft_id: draft_id, document_details_step: null };

  // Audit: resume is user action (not workflow event).
  void writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draft_id,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_RESUMED,
    payload: { wizard: true, starting_step_key },
  }).catch(() => {
    /* audit must not block wizard UX */
  });

  return { wizardOverlay: { ...wizardOverlay, active_wizard_draft_id: draft_id }, recipientOverlay, starting_step_key };
}

export async function wizardDraftOverlayForActiveDraft(
  scope: ActiveIncomeIssuerScope,
  draftId: string | undefined,
  canEdit: boolean,
): Promise<WizardDraftOverlay> {
  if (!draftId) return {};
  try {
    return await buildOverlayForDraft(scope, draftId, canEdit);
  } catch {
    return {};
  }
}

/** Rebuild wizard overlay after issuer branding changed (refreshes preview HTML when already generated). */
export async function refreshWizardDraftOverlayAfterBranding(
  scope: ActiveIncomeIssuerScope,
  draftId: string,
): Promise<WizardDraftOverlay> {
  const row = await loadWizardDraftRow(scope, draftId);
  const priorCache =
    row.draft_totals_preview_json &&
    typeof row.draft_totals_preview_json === 'object' &&
    !Array.isArray(row.draft_totals_preview_json)
      ? (row.draft_totals_preview_json as Record<string, unknown>)
      : {};
  const mergedRow =
    typeof priorCache.preview_generated_at === 'string'
      ? {
          ...row,
          draft_totals_preview_json: {
            ...priorCache,
            preview_generated_at: new Date().toISOString(),
          },
        }
      : row;
  const docType =
    mergedRow.document_type != null ? await resolveDocType(scope, mergedRow.document_type) : null;
  return buildOverlayForDraft(scope, draftId, true, mergedRow, docType);
}
