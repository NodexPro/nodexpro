/**
 * begin_income_tax_invoice_credit + issue-time remaining-creditable guards.
 * Creates a credit_tax_invoice draft from an issued tax_invoice. Does not mutate the invoice.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { roundMoney2, resolveIncomeInvoiceOriginalAmount } from '../accounting-base/accounting-base-income-payment.pure.js';
import { calendarDateIso } from './income-document-semantic-dates.pure.js';
import {
  assertDocumentTypeEnabled,
  findAvailableDocumentType,
  resolveAvailableDocumentTypes,
} from './income-document-types.resolver.js';
import {
  applyOfficialIncomeIssuerContext,
  buildIncomeWorkspaceContextAggregate,
} from './income-issuer-context.service.js';
import { assertIncomeEditPermission, loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';
import { buildIncomeWorkspaceAggregate } from './income-workspace-aggregate.service.js';
import { resumeIncomeDocumentDraftFromContext } from './income-document-draft-editor.service.js';
import { validateDraftAgainstDocumentTypeRules } from './income-document-draft.helpers.js';
import { buildWorkEngineInvoicesTabAggregate } from '../work-engine/work-engine-invoices-tab.read-model.service.js';
import { buildWorkEngineInvoicesClientDocumentsByTypeAggregate } from '../work-engine/work-engine-invoices-client-documents-by-type.read-model.service.js';
import { reconcileCollectionAfterTaxInvoiceCredit } from '../work-engine/work-engine-collection-credit-fact.service.js';
import {
  callConsumeIncomeTaxInvoiceCreditRpc,
  callReverseIncomeTaxInvoiceCreditConsumeRpc,
} from '../accounting-base/accounting-base-customer-credit.service.js';
import {
  draftLinesFromIssuedSnapshot,
  resolveDocumentSettingsForConversion,
  serializeConversionDocumentSettings,
  serializeConvertedDraftLines,
} from './income-document-conversion.pure.js';
import {
  CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE,
  CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE,
  INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT,
  INCOME_CREDIT_DOCUMENT_TYPE,
  creditConsumeLinesFromDraft,
  isIncomeTaxInvoiceCreditMode,
  parseIncomeTaxInvoiceCreditReasonKey,
  readCreditDraftSettings,
  resolveCreditState,
  sourceLineIdentityFromSnapshot,
  writeCreditDraftSettings,
  type IncomeCreditDraftSettings,
  type IncomeCreditSourceLineMapEntry,
} from './income-document-tax-invoice-credit.pure.js';
import type { IncomeCommandResponse, IncomeDocumentType } from './income.types.js';
import { loadIssuedCreditAmountsByInvoice } from './income-document-tax-invoice-credit.read.js';
export {
  buildTaxInvoiceCreditAction,
  loadCreditSourceReferenceForDocument,
  loadIssuedCreditAmountsByInvoice,
  loadIssuedCreditRowsForInvoices,
} from './income-document-tax-invoice-credit.read.js';

type SourceInvoice = {
  id: string;
  organization_id: string;
  represented_client_id: string | null;
  issuer_business_id: string;
  document_type: string;
  document_status: string;
  document_number: string;
  income_customer_id: string | null;
  customer_snapshot_json: Record<string, unknown> | null;
  currency: string;
  language: string;
  notes: string | null;
  lines_snapshot_json: unknown;
  totals_snapshot_json: Record<string, unknown> | null;
  customer_po_reference: string | null;
  source_draft_id: string | null;
  legal_snapshot_json: Record<string, unknown> | null;
};

type CreditLinkRow = {
  id: string;
  source_invoice_id: string;
  credit_draft_id: string;
  credit_document_id: string | null;
  status: string;
  credited_amount_reference: number | null;
  source_invoice_number: string | null;
  lines_json: unknown;
};

async function loadSourceInvoice(orgId: string, documentId: string): Promise<SourceInvoice> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, represented_client_id, issuer_business_id, document_type, document_status, document_number, income_customer_id, customer_snapshot_json, currency, language, notes, lines_snapshot_json, totals_snapshot_json, customer_po_reference, source_draft_id, legal_snapshot_json',
    )
    .eq('organization_id', orgId)
    .eq('id', documentId)
    .maybeSingle();
  throwIfSupabaseError(error, 'loadCreditSourceInvoice');
  if (!data) throw notFound('Income document not found');
  return data as SourceInvoice;
}

async function findCreditLinkByDraft(orgId: string, draftId: string): Promise<CreditLinkRow | null> {
  const { data, error } = await supabaseAdmin
    .from('income_document_credit_links')
    .select(
      'id, source_invoice_id, credit_draft_id, credit_document_id, status, credited_amount_reference, source_invoice_number, lines_json',
    )
    .eq('organization_id', orgId)
    .eq('credit_draft_id', draftId)
    .maybeSingle();
  throwIfSupabaseError(error, 'findCreditLinkByDraft', {
    migrationHint: '161_income_tax_invoice_credit_lineage.sql',
  });
  return (data as CreditLinkRow | null) ?? null;
}

async function findCreditLinkByIdempotency(orgId: string, key: string): Promise<CreditLinkRow | null> {
  const { data, error } = await supabaseAdmin
    .from('income_document_credit_links')
    .select(
      'id, source_invoice_id, credit_draft_id, credit_document_id, status, credited_amount_reference, source_invoice_number, lines_json',
    )
    .eq('organization_id', orgId)
    .eq('idempotency_key', key)
    .maybeSingle();
  throwIfSupabaseError(error, 'findCreditLinkByIdempotency');
  return (data as CreditLinkRow | null) ?? null;
}

async function ensureCreditControl(params: {
  orgId: string;
  invoice: SourceInvoice;
  originalAmount: number;
  sourceLines: Array<{ source_line_identity: string; original_quantity: number; original_amount: number }>;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('income_invoice_credit_control').upsert(
    {
      source_invoice_id: params.invoice.id,
      organization_id: params.orgId,
      original_amount_reference: params.originalAmount,
      credited_amount_reference: 0,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'source_invoice_id', ignoreDuplicates: true },
  );
  throwIfSupabaseError(error, 'ensureIncomeInvoiceCreditControl', {
    migrationHint: '161_income_tax_invoice_credit_lineage.sql',
  });

  if (params.sourceLines.length === 0) return;
  const { error: lineErr } = await supabaseAdmin.from('income_invoice_credit_line_control').upsert(
    params.sourceLines.map((line) => ({
      source_invoice_id: params.invoice.id,
      organization_id: params.orgId,
      source_line_identity: line.source_line_identity,
      original_quantity: line.original_quantity,
      original_amount_reference: line.original_amount,
      credited_quantity: 0,
      credited_amount_reference: 0,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'source_invoice_id,source_line_identity', ignoreDuplicates: true },
  );
  throwIfSupabaseError(lineErr, 'ensureIncomeInvoiceCreditLineControl');
}

function sourceLinesFromInvoice(invoice: SourceInvoice): Array<{
  source_line_identity: string;
  original_quantity: number;
  original_amount: number;
  raw: Record<string, unknown>;
}> {
  const arr = Array.isArray(invoice.lines_snapshot_json) ? invoice.lines_snapshot_json : [];
  return arr
    .map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const o = raw as Record<string, unknown>;
      const qty = Number(o.quantity);
      const amount = Number(o.amount_reference ?? o.amount);
      return {
        source_line_identity: sourceLineIdentityFromSnapshot(o, index),
        original_quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        original_amount: Number.isFinite(amount) ? roundMoney2(amount) : 0,
        raw: o,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
}

export function assertCreditDraftIdentityLocked(params: {
  documentSettingsJson: unknown;
  documentType?: string | null;
  incomeCustomerId?: string | null;
  currency?: string | null;
}): IncomeCreditDraftSettings | null {
  const settings = readCreditDraftSettings(params.documentSettingsJson);
  if (!settings) return null;
  if (params.documentType && params.documentType !== INCOME_CREDIT_DOCUMENT_TYPE) {
    throw badRequest('לא ניתן לשנות את סוג מסמך הזיכוי');
  }
  if (
    params.incomeCustomerId != null &&
    settings.locked_income_customer_id &&
    params.incomeCustomerId !== settings.locked_income_customer_id
  ) {
    throw badRequest('לא ניתן לשנות את הלקוח בזיכוי מקושר');
  }
  if (params.currency && params.currency !== settings.locked_currency) {
    throw badRequest('לא ניתן לשנות את המטבע בזיכוי מקושר');
  }
  return settings;
}

export async function assertNoNewCreditLines(params: {
  orgId: string;
  draftId: string;
  documentSettingsJson: unknown;
}): Promise<void> {
  const settings = readCreditDraftSettings(params.documentSettingsJson);
  if (!settings) return;
  throw badRequest('לא ניתן להוסיף שורות חדשות לזיכוי מקושר. ניתן להסיר או להקטין שורות שהועתקו.');
}

export async function executeBeginIncomeTaxInvoiceCredit(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<IncomeCommandResponse> {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');

  const sourceDocumentId = String(body.income_document_id ?? body.source_document_id ?? '').trim();
  if (!sourceDocumentId) throw badRequest('income_document_id required');
  if (!isIncomeTaxInvoiceCreditMode(body.credit_mode)) {
    throw badRequest('credit_mode must be full or partial');
  }
  const creditMode = body.credit_mode;
  const reasonKey = parseIncomeTaxInvoiceCreditReasonKey(body.reason_key);
  const reasonNote =
    body.reason_note != null && String(body.reason_note).trim() ? String(body.reason_note).trim() : null;
  const idempotencyKey = String(body.idempotency_key ?? '').trim() || null;
  const documentsListYearRaw = body.documents_list_year;
  const documentsListYear =
    documentsListYearRaw == null || documentsListYearRaw === ''
      ? null
      : Number(documentsListYearRaw);

  if (idempotencyKey) {
    const existing = await findCreditLinkByIdempotency(orgId, idempotencyKey);
    if (existing) {
      const source = await loadSourceInvoice(orgId, existing.source_invoice_id);
      return buildCreditCommandResponse({
        ctx,
        source,
        draftId: existing.credit_draft_id,
        replay: true,
        documentsListYear,
      });
    }
  }

  const source = await loadSourceInvoice(orgId, sourceDocumentId);
  if (source.document_type !== 'tax_invoice') {
    throw badRequest('Only issued tax invoices can start a credit note');
  }
  if (source.document_status !== 'issued') {
    throw badRequest('Only issued tax invoices can start a credit note');
  }
  if (!source.represented_client_id) {
    throw badRequest('Credit requires office represented client');
  }

  await applyOfficialIncomeIssuerContext(
    ctx,
    {
      acting_mode: 'office_representative',
      issuer_business_id: source.represented_client_id,
      represented_client_id: source.represented_client_id,
    },
    { source: INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT },
  );
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeEditPermission(scope);

  const { available_document_types } = await resolveAvailableDocumentTypes(scope.org_id, scope);
  assertDocumentTypeEnabled(available_document_types, INCOME_CREDIT_DOCUMENT_TYPE);
  const docType = findAvailableDocumentType(available_document_types, INCOME_CREDIT_DOCUMENT_TYPE);
  if (!docType) throw badRequest('credit_tax_invoice is not available');

  const originalAmount = resolveIncomeInvoiceOriginalAmount(source.totals_snapshot_json);
  const creditedByInvoice = await loadIssuedCreditAmountsByInvoice(orgId, [source.id]);
  const alreadyCredited = creditedByInvoice.get(source.id) ?? 0;
  const creditState = resolveCreditState({ originalAmount, creditedAmount: alreadyCredited });
  if (creditState.remaining_creditable_amount <= 0.005) {
    throw conflict('החשבונית כבר זוכתה במלואה', CREDIT_AMOUNT_EXCEEDS_REMAINING_CREDITABLE);
  }

  const sourceLines = sourceLinesFromInvoice(source);
  await ensureCreditControl({
    orgId,
    invoice: source,
    originalAmount,
    sourceLines: sourceLines.map((line) => ({
      source_line_identity: line.source_line_identity,
      original_quantity: line.original_quantity,
      original_amount: line.original_amount,
    })),
  });

  const draftLines = draftLinesFromIssuedSnapshot(source.lines_snapshot_json, source.currency);
  const line_map: Record<string, IncomeCreditSourceLineMapEntry> = {};
  draftLines.forEach((line, index) => {
    const sourceLine = sourceLines[index];
    if (!sourceLine) return;
    line_map[line.line_id] = {
      source_line_identity: sourceLine.source_line_identity,
      original_quantity: sourceLine.original_quantity,
      original_amount: sourceLine.original_amount,
    };
  });

  const documentSettings = resolveDocumentSettingsForConversion({
    sourceDraftSettingsJson: null,
    sourceTotalsSnapshotJson: source.totals_snapshot_json,
  });
  const creditSettings: IncomeCreditDraftSettings = {
    source_invoice_id: source.id,
    source_invoice_number: source.document_number,
    credit_mode: creditMode,
    reason_key: reasonKey,
    reason_note: reasonNote,
    locked_income_customer_id: source.income_customer_id,
    locked_currency: source.currency || 'ILS',
    line_map,
  };
  const documentSettingsJson = writeCreditDraftSettings(
    serializeConversionDocumentSettings(documentSettings),
    creditSettings,
  );
  const oneTimeSnapshot =
    !source.income_customer_id && source.customer_snapshot_json ? source.customer_snapshot_json : null;
  const today = calendarDateIso(new Date().toISOString()) ?? new Date().toISOString().slice(0, 10);
  const payload = {
    document_type: INCOME_CREDIT_DOCUMENT_TYPE as IncomeDocumentType,
    income_customer_id: source.income_customer_id,
    one_time_customer_snapshot_json: oneTimeSnapshot,
    draft_lines_json: serializeConvertedDraftLines(draftLines),
    payment_terms_json: null as Record<string, unknown> | null,
    due_date: null as string | null,
    document_date: today,
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
      document_type: INCOME_CREDIT_DOCUMENT_TYPE,
      income_customer_id: source.income_customer_id,
      one_time_customer_snapshot_json: oneTimeSnapshot,
      draft_lines_json: serializeConvertedDraftLines(draftLines),
      payment_terms_json: null,
      due_date: null,
      document_date: today,
      notes: source.notes,
      currency: source.currency || 'ILS',
      language: source.language || 'he',
      customer_po_reference: source.customer_po_reference,
      document_settings_json: documentSettingsJson,
      draft_totals_preview_json,
      validation_warnings_json,
      status: 'draft',
      user_saved_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  throwIfSupabaseError(insertErr, 'insertTaxInvoiceCreditDraft');
  const draftId = String((inserted as { id: string }).id);

  const { error: linkErr } = await supabaseAdmin.from('income_document_credit_links').insert({
    organization_id: orgId,
    issuer_business_id: source.issuer_business_id,
    represented_client_id: source.represented_client_id,
    source_invoice_id: source.id,
    credit_draft_id: draftId,
    credit_document_id: null,
    credit_mode: creditMode,
    reason_key: reasonKey,
    reason_note: reasonNote,
    status: 'draft',
    source_invoice_number: source.document_number,
    lines_json: Object.entries(line_map).map(([draft_line_id, entry]) => ({
      draft_line_id,
      ...entry,
    })),
    credited_amount_reference: null,
    idempotency_key: idempotencyKey,
    created_by_user_id: ctx.user.id,
  });
  throwIfSupabaseError(linkErr, 'insertTaxInvoiceCreditLink', {
    migrationHint: '161_income_tax_invoice_credit_lineage.sql',
  });

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'income',
    entityType: 'income_document_draft',
    entityId: draftId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_DRAFT_CREATED,
    payload: {
      command: INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT,
      source_invoice_id: source.id,
      credit_mode: creditMode,
      reason_key: reasonKey,
      reason_note: reasonNote,
    },
  });

  return buildCreditCommandResponse({
    ctx,
    source,
    draftId,
    replay: false,
    documentsListYear,
  });
}

async function buildCreditCommandResponse(params: {
  ctx: RequestContext;
  source: SourceInvoice;
  draftId: string;
  replay: boolean;
  documentsListYear: number | null;
}): Promise<IncomeCommandResponse> {
  const year =
    params.documentsListYear != null && Number.isFinite(params.documentsListYear)
      ? Number(params.documentsListYear)
      : new Date().getFullYear();
  const resumed = await resumeIncomeDocumentDraftFromContext(params.ctx, {
    draft_id: params.draftId,
  });
  const workspace = await buildIncomeWorkspaceAggregate(
    params.ctx,
    resumed.scope,
    resumed.result.recipientOverlay,
    resumed.result.wizardOverlay,
  );
  const [context, invoicesTab, documentsByType] = await Promise.all([
    buildIncomeWorkspaceContextAggregate(params.ctx),
    buildWorkEngineInvoicesTabAggregate({ ctx: params.ctx }),
    params.source.represented_client_id
      ? buildWorkEngineInvoicesClientDocumentsByTypeAggregate({
          ctx: params.ctx,
          representedClientId: params.source.represented_client_id,
          documentTypeKey: 'tax_invoice',
          year,
        })
      : Promise.resolve(null),
  ]);
  return {
    ok: true,
    command: INCOME_COMMAND_BEGIN_TAX_INVOICE_CREDIT,
    income_workspace_aggregate: workspace,
    income_workspace_context_aggregate: context,
    work_engine_invoices_tab_aggregate: invoicesTab,
    work_engine_invoices_client_documents_by_type_aggregate: documentsByType ?? undefined,
    meta: {
      idempotent_replay: params.replay,
      income_document_id: params.source.id,
      converted_draft_id: params.draftId,
    },
  };
}

export async function assertAndConsumeCreditOnIssue(params: {
  ctx: RequestContext;
  orgId: string;
  draftId: string;
  issuedDocumentId: string;
  documentSettingsJson: unknown;
  draftLinesJson: unknown;
  totalsSnapshotJson: Record<string, unknown> | null;
  actorUserId: string;
}): Promise<{
  sourceInvoiceId: string;
  remainingReceivable: number;
  customerCreditAmount: number;
  customerCreditId: string | null;
} | null> {
  const settings = readCreditDraftSettings(params.documentSettingsJson);
  const link = await findCreditLinkByDraft(params.orgId, params.draftId);
  if (!settings && !link) return null;
  if (!settings || !link) {
    throw badRequest('Credit draft lineage is incomplete');
  }
  if (link.status === 'issued' && link.credit_document_id === params.issuedDocumentId) {
    return {
      sourceInvoiceId: settings.source_invoice_id,
      remainingReceivable: 0,
      customerCreditAmount: 0,
      customerCreditId: null,
    };
  }

  const requestedAmount = resolveIncomeInvoiceOriginalAmount(params.totalsSnapshotJson);
  let lines;
  try {
    lines = creditConsumeLinesFromDraft({
      draftLinesJson: params.draftLinesJson,
      lineMap: settings.line_map,
    });
  } catch (e) {
    throw conflict(
      e instanceof Error ? e.message : 'הזיכוי חורג מהכמות/סכום הנותרים בשורת המקור',
      CREDIT_LINE_EXCEEDS_REMAINING_CREDITABLE,
    );
  }

  const consumed = await callConsumeIncomeTaxInvoiceCreditRpc({
    organizationId: params.orgId,
    draftId: params.draftId,
    issuedDocumentId: params.issuedDocumentId,
    requestedAmount,
    lines,
    createdBy: params.actorUserId,
  });

  await writeAudit({
    organizationId: params.orgId,
    actorUserId: params.actorUserId,
    moduleCode: 'income',
    entityType: 'income_document',
    entityId: params.issuedDocumentId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_ISSUED,
    payload: {
      credit_of_invoice_id: settings.source_invoice_id,
      credit_mode: settings.credit_mode,
      reason_key: settings.reason_key,
      reason_note: settings.reason_note,
      credited_amount_reference: requestedAmount,
      remaining_receivable: consumed.remaining_receivable,
      customer_credit: consumed.customer_credit_amount,
      customer_credit_id: consumed.customer_credit_id,
      atomic_consume: true,
      idempotent_replay: consumed.replay,
    },
  });

  if (consumed.customer_credit_id) {
    await writeAudit({
      organizationId: params.orgId,
      actorUserId: params.actorUserId,
      moduleCode: 'accounting_base',
      entityType: 'accounting_customer_credit',
      entityId: consumed.customer_credit_id,
      action: AUDIT_ACTIONS.ACCOUNTING_BASE_CUSTOMER_CREDIT_OPENED,
      payload: {
        source_invoice_id: consumed.source_invoice_id,
        source_credit_document_id: params.issuedDocumentId,
        amount: consumed.customer_credit_amount,
        remaining_receivable: consumed.remaining_receivable,
      },
    });
  }

  return {
    sourceInvoiceId: settings.source_invoice_id,
    remainingReceivable: consumed.remaining_receivable ?? 0,
    customerCreditAmount: consumed.customer_credit_amount,
    customerCreditId: consumed.customer_credit_id,
  };
}

export async function finalizeIssuedTaxInvoiceCreditSideEffects(params: {
  orgId: string;
  sourceInvoiceId: string;
  creditDocumentId: string;
  remainingReceivable: number;
  actorUserId: string;
}): Promise<void> {
  try {
    await reconcileCollectionAfterTaxInvoiceCredit({
      orgId: params.orgId,
      sourceInvoiceId: params.sourceInvoiceId,
      creditDocumentId: params.creditDocumentId,
      remainingReceivable: params.remainingReceivable,
      actorUserId: params.actorUserId,
    });
  } catch {
    /* Work Engine reconcile must not fail Income issue */
  }
}

export async function reverseCreditConsumeOnIssueFailure(params: {
  orgId: string;
  draftId: string;
  sourceInvoiceId: string;
  issuedDocumentId?: string;
  requestedAmount: number;
  documentSettingsJson: unknown;
  draftLinesJson: unknown;
}): Promise<void> {
  const settings = readCreditDraftSettings(params.documentSettingsJson);
  let lines: Array<{ source_line_identity: string; quantity: number; amount: number }> = [];
  try {
    if (settings) {
      lines = creditConsumeLinesFromDraft({
        draftLinesJson: params.draftLinesJson,
        lineMap: settings.line_map,
      });
    }
  } catch {
    lines = [];
  }
  await callReverseIncomeTaxInvoiceCreditConsumeRpc({
    organizationId: params.orgId,
    draftId: params.draftId,
    issuedDocumentId: params.issuedDocumentId ?? '',
    requestedAmount: params.requestedAmount,
    lines,
  });
}
