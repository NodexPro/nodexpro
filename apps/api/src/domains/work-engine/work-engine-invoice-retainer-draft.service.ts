/**
 * Retainer — reuse income document draft as template (backend-owned snapshot).
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { normalizeDraftLines, serializeDraftLines } from '../income/income-document-draft-lines.pure.js';
import {
  loadWizardDraftRow,
  recipientOverlayForDraftRow,
  updateIncomeDocumentDraftSettings,
  wizardDraftOverlayForActiveDraft,
  type WizardDraftOverlay,
} from '../income/income-document-draft-editor.service.js';
import { applySelectIncomeIssuerContext } from '../income/income-issuer-context.service.js';
import { loadActiveIncomeIssuerScope } from '../income/income-issuer-scope.service.js';
import type { ActiveIncomeIssuerScope } from '../income/income.guards.js';
import { INCOME_COMMAND_SELECT_ISSUER } from '../income/income.types.js';
import { buildIncomeWorkspaceWizardPatchAggregate } from '../income/income-workspace-aggregate.service.js';
import type { RecipientSearchOverlay } from '../income/income-recipient.service.js';
import type { IncomeDocumentType, IncomeWorkspaceAggregate } from '../income/income.types.js';
import { resolveAvailableDocumentTypes } from '../income/income-document-types.resolver.js';
import { findAvailableDocumentType } from '../income/income-document-types.fallback.js';
import { validateDraftAgainstDocumentTypeRules } from '../income/income-document-draft.helpers.js';
import { recomputeDraftLineAmounts } from '../income/income-draft-line-compute.pure.js';
import {
  computeDraftTotalsPreview,
  parseDocumentSettingsJson,
  serializeDocumentSettingsJson,
} from '../income/income-document-draft-totals.pure.js';
import {
  coerceRetainerTemplateDocumentDate,
  todayIsoDate,
} from '../income/income-retainer-template-document-date.pure.js';
import { vatResolutionCachePayload } from '../income/income-draft-vat-fallback.pure.js';
import { resolveIncomeDraftVatForOrg } from '../income/income-draft-vat-resolver.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { WORK_ENGINE_INVOICE_WIZARD_INCOME_COMMANDS } from './work-engine-invoices-document-creation.builders.js';

export type RecurringDocumentTemplateSnapshot = {
  snapshot_version: 1;
  snapshot_kind: 'document_template_snapshot';
  document_type: IncomeDocumentType;
  document_date: string;
  due_date: string | null;
  currency: string;
  language: string;
  notes: string | null;
  document_settings_json: Record<string, unknown>;
  delivery_contact_json: Record<string, unknown> | null;
  draft_lines_json: unknown[];
  discount_percent_reference: number | null;
  discount_amount_reference: number | null;
};

type DraftRow = {
  id: string;
  organization_id: string;
  represented_client_id: string | null;
  issuer_business_id: string;
  income_customer_id: string | null;
  document_type: IncomeDocumentType;
  document_date: string;
  due_date: string | null;
  currency: string;
  language: string;
  notes: string | null;
  document_settings_json: Record<string, unknown> | null;
  delivery_contact_json: Record<string, unknown> | null;
  draft_lines_json: unknown;
  draft_totals_preview_json: Record<string, unknown> | null;
  status: string;
};

const DRAFT_SELECT =
  'id, organization_id, represented_client_id, issuer_business_id, income_customer_id, document_type, document_date, due_date, currency, language, notes, document_settings_json, delivery_contact_json, draft_lines_json, draft_totals_preview_json, status';

async function loadDraftRow(orgId: string, draftId: string): Promise<DraftRow> {
  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .select(DRAFT_SELECT)
    .eq('organization_id', orgId)
    .eq('id', draftId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadRetainerDraftRow');
  const row = data as DraftRow | null;
  if (!row) throw badRequest('source_draft_template_id not found');
  if (row.status !== 'draft') throw badRequest('source_draft_template_id must reference an active draft');
  return row;
}

function assertDraftBelongsToRetainer(params: {
  row: DraftRow;
  representedClientId: string;
  endCustomerId: string;
}): void {
  if (params.row.represented_client_id !== params.representedClientId) {
    throw badRequest('source_draft_template_id does not belong to office client');
  }
  if (params.row.issuer_business_id !== params.representedClientId) {
    throw badRequest('source_draft_template_id issuer mismatch');
  }
  if (params.row.income_customer_id !== params.endCustomerId) {
    throw badRequest('source_draft_template_id end customer mismatch');
  }
}

export function buildDocumentTemplateSnapshotFromDraftRow(row: DraftRow): RecurringDocumentTemplateSnapshot {
  const preview =
    row.draft_totals_preview_json && typeof row.draft_totals_preview_json === 'object'
      ? row.draft_totals_preview_json
      : {};
  const discountPercent = preview.discount_percent_reference;
  const discountAmount = preview.discount_amount_reference;
  return {
    snapshot_version: 1,
    snapshot_kind: 'document_template_snapshot',
    document_type: row.document_type,
    document_date: row.document_date,
    due_date: row.due_date,
    currency: row.currency,
    language: row.language,
    notes: row.notes,
    document_settings_json: row.document_settings_json ?? {},
    delivery_contact_json: row.delivery_contact_json,
    draft_lines_json: normalizeDraftLines(row.draft_lines_json).map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit_price_reference: line.unit_price_reference,
      currency: line.currency,
      price_includes_vat: line.price_includes_vat,
      exchange_rate_to_ils_override: line.exchange_rate_to_ils_override,
    })),
    discount_percent_reference:
      typeof discountPercent === 'number' && Number.isFinite(discountPercent) ? discountPercent : null,
    discount_amount_reference:
      typeof discountAmount === 'number' && Number.isFinite(discountAmount) ? discountAmount : null,
  };
}

export function denormalizedProfileFieldsFromSnapshot(snapshot: RecurringDocumentTemplateSnapshot) {
  const firstLine = snapshot.draft_lines_json[0] as Record<string, unknown> | undefined;
  const description = String(firstLine?.description ?? '').trim() || '—';
  const quantityRaw = Number(firstLine?.quantity ?? 1);
  const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
  const unitRaw = Number(firstLine?.unit_price_reference ?? 0);
  const unit_price_before_vat_reference = Number.isFinite(unitRaw) && unitRaw >= 0 ? unitRaw : 0;
  return {
    document_type: snapshot.document_type,
    next_document_date: snapshot.document_date,
    line_description_template: description,
    quantity,
    unit_price_before_vat_reference,
    currency: snapshot.currency,
    discount_percent_reference: snapshot.discount_percent_reference,
    discount_amount_reference: snapshot.discount_amount_reference,
  };
}

export async function buildDocumentTemplateSnapshotForRetainer(params: {
  orgId: string;
  representedClientId: string;
  endCustomerId: string;
  sourceDraftTemplateId: string;
}): Promise<{
  snapshot: RecurringDocumentTemplateSnapshot;
  denormalized: ReturnType<typeof denormalizedProfileFieldsFromSnapshot>;
}> {
  const row = await loadDraftRow(params.orgId, params.sourceDraftTemplateId);
  assertDraftBelongsToRetainer({
    row,
    representedClientId: params.representedClientId,
    endCustomerId: params.endCustomerId,
  });
  const snapshot = buildDocumentTemplateSnapshotFromDraftRow(row);
  return { snapshot, denormalized: denormalizedProfileFieldsFromSnapshot(snapshot) };
}

async function ensureIssuerForOfficeClient(
  ctx: RequestContext,
  representedClientId: string,
): Promise<ActiveIncomeIssuerScope> {
  await applySelectIncomeIssuerContext(ctx, {
    command: INCOME_COMMAND_SELECT_ISSUER,
    acting_mode: 'office_representative',
    issuer_business_id: representedClientId,
    represented_client_id: representedClientId,
  });
  const scope = await loadActiveIncomeIssuerScope(ctx);
  if (scope.represented_client_id !== representedClientId) {
    throw forbidden('Office client issuer context required');
  }
  return scope;
}

export async function ensureRetainerDocumentDraftWorkspace(params: {
  ctx: RequestContext;
  representedClientId: string;
  endCustomerId: string;
  sourceDraftTemplateId?: string | null;
  fallbackDocumentType?: IncomeDocumentType | null;
  onTiming?: (label: string, elapsedMs: number) => void;
}): Promise<{
  income_workspace_aggregate: IncomeWorkspaceAggregate;
  income_commands: Record<string, string>;
}> {
  const logTiming = (label: string, startMs: number) => {
    const elapsedMs = Date.now() - startMs;
    params.onTiming?.(label, elapsedMs);
    return Date.now();
  };
  let stepStart = Date.now();

  const scope = await ensureIssuerForOfficeClient(params.ctx, params.representedClientId);
  stepStart = logTiming('ensure_issuer_scope', stepStart);

  const income_commands = { ...WORK_ENGINE_INVOICE_WIZARD_INCOME_COMMANDS };

  let recipientOverlay: RecipientSearchOverlay = {};
  let wizardOverlay: WizardDraftOverlay = {};
  let startingStepKey: string | null = null;

  if (params.sourceDraftTemplateId) {
    try {
      const row = await loadDraftRow(scope.org_id, params.sourceDraftTemplateId);
      assertDraftBelongsToRetainer({
        row,
        representedClientId: params.representedClientId,
        endCustomerId: params.endCustomerId,
      });
      stepStart = logTiming('load_template_draft_row', stepStart);
      const wizardRow = await loadWizardDraftRow(scope, params.sourceDraftTemplateId);
      recipientOverlay = await recipientOverlayForDraftRow(scope, wizardRow);
      stepStart = logTiming('recipient_overlay', stepStart);

      const today = todayIsoDate();
      const settings = parseDocumentSettingsJson(wizardRow.document_settings_json);
      const targetDocumentDate = coerceRetainerTemplateDocumentDate(wizardRow.document_date, today);
      if (wizardRow.document_date !== targetDocumentDate) {
        await updateIncomeDocumentDraftSettings(scope, {
          draft_id: params.sourceDraftTemplateId,
          setting_key: 'document_date',
          setting_value: targetDocumentDate,
        });
      }
      if (!settings.retainer_template) {
        const { error: markerError } = await supabaseAdmin
          .from('income_document_drafts')
          .update({
            document_settings_json: serializeDocumentSettingsJson({
              ...settings,
              retainer_template: true,
            }),
          })
          .eq('organization_id', scope.org_id)
          .eq('id', params.sourceDraftTemplateId);
        throwIfSupabaseError(markerError, 'markRetainerTemplateDraft');
      }

      wizardOverlay = await wizardDraftOverlayForActiveDraft(
        scope,
        params.sourceDraftTemplateId,
        scope.permissions.edit,
        { lean: true, retainer_template_document_date_min: today },
      );
      startingStepKey = 'document_details';
      stepStart = logTiming('lean_document_details_overlay', stepStart);
    } catch {
      // Stale template id — fall through to empty wizard overlay.
    }
  }

  const income_workspace_aggregate = await buildIncomeWorkspaceWizardPatchAggregate(
    scope,
    wizardOverlay,
    recipientOverlay,
    startingStepKey,
    { includeBrandingProfile: false },
  );
  logTiming('wizard_patch_aggregate', stepStart);

  return { income_workspace_aggregate, income_commands };
}

export type CreateRecurringCycleDraftParams = {
  scope: ActiveIncomeIssuerScope;
  representedClientId: string;
  endCustomerId: string;
  snapshot: RecurringDocumentTemplateSnapshot;
  scheduledDocumentDate: string;
  quantity: number;
  unitPriceBeforeVatReference: number;
  currency: string;
  discountPercentReference: number | null;
  discountAmountReference: number | null;
};

export async function createRecurringCycleDraftFromSnapshot(
  params: CreateRecurringCycleDraftParams,
): Promise<string> {
  const snapshot = params.snapshot;
  if (snapshot.snapshot_kind !== 'document_template_snapshot') {
    throw badRequest('document_template_snapshot is invalid');
  }

  const { available_document_types } = await resolveAvailableDocumentTypes(
    params.scope.org_id,
    params.scope,
  );
  const docType = findAvailableDocumentType(available_document_types, snapshot.document_type);
  if (!docType) throw badRequest('document_type is not available for issuer');

  const settings = parseDocumentSettingsJson(snapshot.document_settings_json);
  const documentDate = params.scheduledDocumentDate;
  const baseLines = normalizeDraftLines(snapshot.draft_lines_json);
  const lines = baseLines.length
    ? baseLines.map((line, index) => ({
        ...line,
        sort_index: index,
        quantity: index === 0 ? params.quantity : line.quantity,
        unit_price_reference:
          index === 0 ? params.unitPriceBeforeVatReference : line.unit_price_reference,
        currency: (index === 0 ? params.currency : line.currency) as typeof line.currency,
      }))
    : normalizeDraftLines([
        {
          description: '—',
          quantity: params.quantity,
          unit_price_reference: params.unitPriceBeforeVatReference,
          currency: params.currency,
        },
      ]);

  let vatResolution = await resolveIncomeDraftVatForOrg(params.scope.org_id, 'IL', documentDate);
  const recomputedLines = await recomputeDraftLineAmounts(
    lines,
    settings,
    vatResolution,
    documentDate,
  );
  const totalsPreview = await computeDraftTotalsPreview(
    recomputedLines,
    params.currency,
    settings,
    vatResolution,
    documentDate,
  );

  const draftPayload = {
    document_type: snapshot.document_type,
    income_customer_id: params.endCustomerId,
    one_time_customer_snapshot_json: null,
    draft_lines_json: serializeDraftLines(recomputedLines),
    payment_terms_json: null,
    due_date: snapshot.due_date,
    document_date: documentDate,
    payment_received_json: null,
    notes: snapshot.notes,
    currency: params.currency,
    language: snapshot.language,
    document_settings_json: snapshot.document_settings_json,
  };

  const { validation_warnings_json } = await validateDraftAgainstDocumentTypeRules(
    draftPayload,
    docType,
  );

  const draft_totals_preview_json = {
    ...totalsPreview,
    discount_percent_reference: params.discountPercentReference,
    discount_amount_reference: params.discountAmountReference,
    vat_resolution_cache: vatResolutionCachePayload(documentDate, vatResolution),
  };

  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .insert({
      organization_id: params.scope.org_id,
      represented_client_id: params.representedClientId,
      issuer_business_id: params.representedClientId,
      actor_user_id: params.scope.actor_user_id,
      acting_mode: 'office_representative',
      document_type: snapshot.document_type,
      income_customer_id: params.endCustomerId,
      one_time_customer_snapshot_json: null,
      draft_lines_json: serializeDraftLines(recomputedLines),
      document_date: documentDate,
      due_date: snapshot.due_date,
      currency: params.currency,
      language: snapshot.language,
      notes: snapshot.notes,
      payment_received_json: null,
      delivery_contact_json: snapshot.delivery_contact_json,
      document_settings_json: snapshot.document_settings_json,
      draft_totals_preview_json,
      validation_warnings_json,
      status: 'draft',
    })
    .select('id')
    .single();
  throwIfSupabaseError(error, 'createRecurringCycleDraftFromSnapshot');

  const draftId = String((data as { id: string }).id);
  await writeAudit({
    organizationId: params.scope.org_id,
    actorUserId: params.scope.actor_user_id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draftId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_CREATED,
    payload: {
      document_type: snapshot.document_type,
      recurring_scheduler: true,
      income_customer_id: params.endCustomerId,
      scheduled_document_date: documentDate,
    },
  });

  return draftId;
}
