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
import {
  computeDraftTotalsPreview,
  DEFAULT_DOCUMENT_SETTINGS,
  parseDocumentSettingsJson,
} from './income-document-draft-totals.pure.js';
import { resolveIncomeDraftVatForOrg } from './income-draft-vat-resolver.js';
import { findAvailableDocumentType, resolveAvailableDocumentTypes } from './income-document-types.resolver.js';
import type { IncomeAvailableDocumentType, IncomeDocumentType } from './income.types.js';
import { optionalJsonObject, optionalString, optionalUuid, parseIncomeDocumentType, reqUuid } from './income.guards.js';
import type { RecipientSearchOverlay } from './income-recipient.service.js';
import {
  loadIncomeRecipientById,
  selectedFromSavedRow,
  type IncomeRecipientSelected,
} from './income-recipient.service.js';

export type WizardDraftOverlay = {
  active_wizard_draft_id?: string;
  document_details_step?: IncomeDocumentDetailsStep | null;
};

const DRAFT_SELECT =
  'id, organization_id, issuer_business_id, represented_client_id, document_type, document_date, due_date, notes, currency, language, draft_lines_json, payment_received_json, delivery_contact_json, document_settings_json, validation_warnings_json, income_customer_id, one_time_customer_snapshot_json, status';

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
): Promise<IncomeWizardDraftRow & { status: string }> {
  const existing = await loadWizardDraftRow(scope, draftId);
  if (existing.status !== 'draft') throw badRequest('Draft is not editable');

  const { error } = await supabaseAdmin
    .from('income_document_drafts')
    .update(patch)
    .eq('id', draftId)
    .eq('organization_id', scope.org_id);
  if (error) throw error;

  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draftId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_UPDATED,
    payload: auditPayload,
  });

  return loadWizardDraftRow(scope, draftId);
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
): Promise<WizardDraftOverlay> {
  const row = await loadWizardDraftRow(scope, draftId);
  const docType =
    row.document_type != null
      ? await resolveDocType(scope, row.document_type)
      : null;
  const step = await buildIncomeDocumentDetailsStep(scope, row, docType, canEdit);
  return { active_wizard_draft_id: draftId, document_details_step: step };
}

async function validationForRow(
  scope: ActiveIncomeIssuerScope,
  row: IncomeWizardDraftRow,
  docType: IncomeAvailableDocumentType,
): Promise<{ validation_warnings_json: Record<string, unknown>[]; draft_totals_preview_json: Record<string, unknown> }> {
  const lines = normalizeDraftLines(row.draft_lines_json);
  const settings = parseDocumentSettingsJson(row.document_settings_json);
  const vatResolution = await resolveIncomeDraftVatForOrg(
    scope.org_id,
    'IL',
    row.document_date ?? new Date().toISOString().slice(0, 10),
  );
  const totals = computeDraftTotalsPreview(lines, row.currency, settings, vatResolution);
  const { validation_warnings_json } = validateDraftAgainstDocumentTypeRules(
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
  return { validation_warnings_json, draft_totals_preview_json: totals };
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

export async function addIncomeDocumentLine(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const row = await loadWizardDraftRow(scope, draft_id);
  const lines = normalizeDraftLines(row.draft_lines_json);
  lines.push(createEmptyDraftLine(lines.length));
  const docType = await resolveDocType(scope, row.document_type!);
  const validation = await validationForRow(scope, { ...row, draft_lines_json: serializeDraftLines(lines) }, docType);
  await persistWizardDraft(scope, draft_id, {
    draft_lines_json: serializeDraftLines(lines),
    ...validation,
  }, { action: 'add_line', line_count: lines.length });
  return buildOverlayForDraft(scope, draft_id, true);
}

export async function updateIncomeDocumentLine(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const line_id = String(body.line_id ?? '').trim();
  if (!line_id) throw badRequest('line_id is required');
  const row = await loadWizardDraftRow(scope, draft_id);
  const lines = applyLineFieldUpdate(normalizeDraftLines(row.draft_lines_json), line_id, body);
  const docType = await resolveDocType(scope, row.document_type!);
  const validation = await validationForRow(scope, { ...row, draft_lines_json: serializeDraftLines(lines) }, docType);
  await persistWizardDraft(scope, draft_id, {
    draft_lines_json: serializeDraftLines(lines),
    ...validation,
  }, { action: 'update_line', line_id });
  return buildOverlayForDraft(scope, draft_id, true);
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
  const validation = await validationForRow(scope, { ...row, draft_lines_json: serializeDraftLines(lines) }, docType);
  await persistWizardDraft(scope, draft_id, {
    draft_lines_json: serializeDraftLines(lines),
    ...validation,
  }, { action: 'delete_line', line_id });
  return buildOverlayForDraft(scope, draft_id, true);
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
  const validation = await validationForRow(scope, { ...row, draft_lines_json: serializeDraftLines(lines) }, docType);
  await persistWizardDraft(scope, draft_id, {
    draft_lines_json: serializeDraftLines(lines),
    ...validation,
  }, { action: 'reorder_lines' });
  return buildOverlayForDraft(scope, draft_id, true);
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
    if (value !== 'standard' && value !== 'exempt' && value !== 'zero') {
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
  const validation = await validationForRow(scope, merged, docType);
  await persistWizardDraft(scope, draft_id, { ...patch, ...validation }, { action: 'update_settings', setting_key: key });
  return buildOverlayForDraft(scope, draft_id, true);
}

export async function updateIncomeDocumentNotes(
  scope: ActiveIncomeIssuerScope,
  body: Record<string, unknown>,
): Promise<WizardDraftOverlay> {
  const draft_id = reqUuid(body.draft_id, 'draft_id');
  const notes = optionalString(body.notes);
  const row = await loadWizardDraftRow(scope, draft_id);
  const docType = await resolveDocType(scope, row.document_type!);
  const validation = await validationForRow(scope, { ...row, notes: notes ?? null }, docType);
  await persistWizardDraft(scope, draft_id, { notes: notes ?? null, ...validation }, { action: 'update_notes' });
  return buildOverlayForDraft(scope, draft_id, true);
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
  await persistWizardDraft(
    scope,
    draft_id,
    { delivery_contact_json },
    { action: 'update_delivery_contact', snapshot_only: true },
  );
  return buildOverlayForDraft(scope, draft_id, true);
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
