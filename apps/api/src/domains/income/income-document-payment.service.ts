/**
 * INV-5B — record_income_document_payment
 *
 * Consistency strategy (explicit, not a fake multi-call DB transaction):
 * 1) Unique operation row (org + idempotency_key) tracks orchestration state.
 * 2) Accounting Base payment/allocation is atomic via INV-5A RPC (idempotent).
 * 3) On retry: if payment already allocated but receipt missing → resume receipt only.
 * 4) Completed operations replay without creating duplicates.
 * 5) AB financial rows are never deleted on receipt failure (no unauthorized reversal).
 * 6) Failure after AB success leaves status=payment_allocated + failure_reason for recovery.
 */

import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, conflict, forbidden } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { executeRecordAndAllocateIncomePayment } from '../accounting-base/accounting-base-income-payment.service.js';
import { sumPostedAllocationsForIncomeDocument } from '../accounting-base/accounting-base-income-payment-case.read.js';
import {
  parseIncomePaymentMethodKey,
  resolveIncomeInvoiceOriginalAmount,
  resolveIncomeInvoicePaymentState,
} from '../accounting-base/accounting-base-income-payment.pure.js';
import { validateDraftAgainstDocumentTypeRules } from './income-document-draft.helpers.js';
import { executeIssueIncomeDocument } from './income-document-issue.service.js';
import {
  findAvailableDocumentType,
  resolveAvailableDocumentTypes,
  assertDocumentTypeEnabled,
} from './income-document-types.resolver.js';
import { assertRowMatchesIssuerScope } from './income.guards.js';
import {
  assertIncomeIssuePermission,
  loadActiveIncomeIssuerScope,
} from './income-issuer-scope.service.js';
import { buildIncomeWorkspaceContextAggregate } from './income-issuer-context.service.js';
import { buildIncomeWorkspaceAggregate } from './income-workspace-aggregate.service.js';
import {
  buildIncomeDocumentPaymentCaseAggregate,
  type IncomeDocumentPaymentCaseAggregate,
} from './income-document-payment-case.read.js';
import {
  INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
  INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE,
  buildIncomePaymentReceiptDetailsText,
  optionalTrimmedString,
} from './income-document-payment.pure.js';
import type { IncomeCommandType, IncomeWorkspaceAggregate, IncomeWorkspaceContextAggregate } from './income.types.js';

export type RecordIncomeDocumentPaymentResponse = {
  ok: true;
  command: typeof INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT;
  income_workspace_aggregate: IncomeWorkspaceAggregate;
  income_workspace_context_aggregate: IncomeWorkspaceContextAggregate;
  income_document_payment_case: IncomeDocumentPaymentCaseAggregate;
  meta: {
    payment_id: string;
    allocation_id: string;
    receipt_document_id: string;
    idempotent_replay: boolean;
  };
};

type OperationRow = {
  id: string;
  organization_id: string;
  idempotency_key: string;
  invoice_document_id: string;
  payment_id: string | null;
  allocation_id: string | null;
  receipt_draft_id: string | null;
  receipt_document_id: string | null;
  status: string;
  amount: number;
  currency: string;
  payment_date: string;
  payment_method_key: string;
  reference_number: string | null;
  note: string | null;
};

type InvoiceDocRow = {
  id: string;
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
  document_type: string;
  document_number: string;
  document_status: string;
  currency: string;
  issue_date: string;
  income_customer_id: string | null;
  customer_snapshot_json: Record<string, unknown> | null;
  totals_snapshot_json: Record<string, unknown> | null;
  language: string | null;
};

function requirePaymentOrchestrationPerms(ctx: RequestContext): void {
  const perms = ctx.membership?.permissions ?? [];
  if (!perms.includes('income.issue')) throw forbidden('income.issue required');
  if (!perms.includes('accounting_base.payment.write')) {
    throw forbidden('accounting_base.payment.write required');
  }
}

async function loadInvoice(
  organizationId: string,
  incomeDocumentId: string,
): Promise<InvoiceDocRow> {
  const { data, error } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, organization_id, issuer_business_id, represented_client_id, document_type, document_number, document_status, currency, issue_date, income_customer_id, customer_snapshot_json, totals_snapshot_json, language',
    )
    .eq('organization_id', organizationId)
    .eq('id', incomeDocumentId)
    .maybeSingle();
  throwIfSupabaseError(error, 'Failed to load income document');
  if (!data) throw badRequest('Income document not found');
  return data as InvoiceDocRow;
}

async function findOperation(
  organizationId: string,
  idempotencyKey: string,
): Promise<OperationRow | null> {
  const { data, error } = await supabaseAdmin
    .from('income_document_payment_operations')
    .select(
      'id, organization_id, idempotency_key, invoice_document_id, payment_id, allocation_id, receipt_draft_id, receipt_document_id, status, amount, currency, payment_date, payment_method_key, reference_number, note',
    )
    .eq('organization_id', organizationId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  throwIfSupabaseError(error, 'Failed to load payment operation');
  return (data as OperationRow | null) ?? null;
}

async function updateOperation(
  organizationId: string,
  operationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('income_document_payment_operations')
    .update(patch)
    .eq('organization_id', organizationId)
    .eq('id', operationId);
  throwIfSupabaseError(error, 'Failed to update payment operation');
}

async function insertLink(args: {
  organizationId: string;
  invoiceId: string;
  receiptId: string;
  paymentId: string;
  allocationId: string;
  amount: number;
  currency: string;
  label: string;
  createdBy: string;
}): Promise<void> {
  const { error } = await supabaseAdmin.from('income_document_links').insert({
    organization_id: args.organizationId,
    relationship_key: INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE,
    relationship_label: args.label,
    source_document_id: args.invoiceId,
    target_document_id: args.receiptId,
    payment_id: args.paymentId,
    allocation_id: args.allocationId,
    allocated_amount: args.amount,
    currency: args.currency,
    created_by: args.createdBy,
  });
  if (error && String((error as { code?: string }).code) !== '23505') {
    throwIfSupabaseError(error, 'Failed to create income document link');
  }
}

async function createReceiptDraft(args: {
  scope: Awaited<ReturnType<typeof loadActiveIncomeIssuerScope>>;
  invoice: InvoiceDocRow;
  amount: number;
  currency: string;
  paymentDate: string;
  paymentMethodKey: string;
  detailsText: string;
  referenceNumber: string | null;
  note: string | null;
  bankKey: string | null;
  bankBranch: string | null;
  bankAccount: string | null;
  paymentId: string;
  allocationId: string;
}): Promise<string> {
  const { available_document_types } = await resolveAvailableDocumentTypes(
    args.scope.org_id,
    args.scope,
  );
  assertDocumentTypeEnabled(available_document_types, 'receipt');
  const docType = findAvailableDocumentType(available_document_types, 'receipt');
  if (!docType) throw badRequest('receipt document type is not available');

  const lineId = randomUUID();
  const draft_lines_json = [
    {
      line_id: lineId,
      sort_index: 0,
      description: args.detailsText,
      quantity: 1,
      unit_price_reference: args.amount,
      currency: args.currency,
      exchange_rate_to_ils_override: null,
      price_includes_vat: true,
      vat_rate_code: 'standard',
      amount_reference: args.amount,
    },
  ];

  const payment_received_json: Record<string, unknown> = {
    note: args.detailsText,
    payment_method_key: args.paymentMethodKey,
    payment_date: args.paymentDate,
    reference_number: args.referenceNumber,
    user_note: args.note,
    bank_key: args.bankKey,
    bank_branch: args.bankBranch,
    bank_account: args.bankAccount,
    accounting_payment_id: args.paymentId,
    accounting_allocation_id: args.allocationId,
    source_invoice_id: args.invoice.id,
    source_invoice_number: args.invoice.document_number,
  };

  const payload = {
    document_type: 'receipt' as const,
    income_customer_id: args.invoice.income_customer_id,
    one_time_customer_snapshot_json:
      args.invoice.income_customer_id == null
        ? (args.invoice.customer_snapshot_json ?? { display_name: 'Customer' })
        : null,
    draft_lines_json,
    payment_terms_json: null,
    due_date: null,
    document_date: args.paymentDate,
    payment_received_json,
    notes: args.detailsText,
    currency: args.currency,
    language: args.invoice.language === 'en' ? 'en' : 'he',
    document_settings_json: {
      vat_mode: 'standard',
      discount: { enabled: false },
    },
  };

  const { validation_warnings_json, draft_totals_preview_json } =
    await validateDraftAgainstDocumentTypeRules(payload, docType);

  // Force receipt grand total to equal payment amount (document snapshot; AB remains truth for AR).
  const totals = {
    ...draft_totals_preview_json,
    grand_total_reference: args.amount,
    amount_reference: args.amount,
  };

  const { data, error } = await supabaseAdmin
    .from('income_document_drafts')
    .insert({
      organization_id: args.scope.org_id,
      represented_client_id: args.scope.represented_client_id,
      issuer_business_id: args.scope.issuer_business_id,
      actor_user_id: args.scope.actor_user_id,
      acting_mode: args.scope.acting_mode,
      document_type: 'receipt',
      income_customer_id: payload.income_customer_id,
      one_time_customer_snapshot_json: payload.one_time_customer_snapshot_json,
      draft_lines_json,
      payment_terms_json: null,
      due_date: null,
      document_date: args.paymentDate,
      payment_received_json,
      notes: args.detailsText,
      currency: args.currency,
      language: payload.language,
      document_settings_json: payload.document_settings_json,
      draft_totals_preview_json: totals,
      validation_warnings_json,
      status: 'draft',
    })
    .select('id')
    .single();
  throwIfSupabaseError(error, 'Failed to create receipt draft');
  return String((data as { id: string }).id);
}

async function buildFullResponse(
  ctx: RequestContext,
  command: IncomeCommandType,
  invoiceId: string,
  paymentId: string,
  allocationId: string,
  receiptId: string,
  replay: boolean,
  documentsListYear: number | null,
): Promise<RecordIncomeDocumentPaymentResponse> {
  const [workspace, context, paymentCase] = await Promise.all([
    buildIncomeWorkspaceAggregate(ctx),
    buildIncomeWorkspaceContextAggregate(ctx),
    buildIncomeDocumentPaymentCaseAggregate(ctx, ctx.organizationId!, invoiceId, {
      newlyIssuedReceiptId: receiptId,
      documentsListYear,
    }),
  ]);
  return {
    ok: true,
    command: command as typeof INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
    income_workspace_aggregate: workspace,
    income_workspace_context_aggregate: context,
    income_document_payment_case: paymentCase,
    meta: {
      payment_id: paymentId,
      allocation_id: allocationId,
      receipt_document_id: receiptId,
      idempotent_replay: replay,
    },
  };
}

export async function executeRecordIncomeDocumentPayment(
  ctx: RequestContext,
  body: Record<string, unknown>,
): Promise<RecordIncomeDocumentPaymentResponse> {
  requirePaymentOrchestrationPerms(ctx);
  const scope = await loadActiveIncomeIssuerScope(ctx);
  assertIncomeIssuePermission(scope);

  const incomeDocumentId = String(body.income_document_id ?? '').trim();
  if (!incomeDocumentId) throw badRequest('income_document_id required');
  const idempotencyKey = String(body.idempotency_key ?? '').trim();
  if (!idempotencyKey) throw badRequest('idempotency_key required');
  if (idempotencyKey.length > 256) throw badRequest('idempotency_key too long');

  const documentsListYearRaw = body.documents_list_year;
  const documentsListYear =
    documentsListYearRaw == null || documentsListYearRaw === ''
      ? null
      : Number(documentsListYearRaw);
  if (documentsListYear != null && (!Number.isFinite(documentsListYear) || documentsListYear < 1900)) {
    throw badRequest('documents_list_year must be a valid year');
  }

  const paymentDate = String(body.payment_date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
    throw badRequest('payment_date must be YYYY-MM-DD');
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('amount must be a positive number');
  const currency = String(body.currency ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('currency must be a 3-letter code');

  let methodKey: string;
  try {
    methodKey = parseIncomePaymentMethodKey(body.payment_method_key);
  } catch {
    throw badRequest(
      'payment_method_key is invalid (supported: bank_transfer, cash, check, credit_card, other)',
    );
  }

  const referenceNumber = optionalTrimmedString(body.reference_number, 120);
  const note = optionalTrimmedString(body.note, 500);
  const bankKey = optionalTrimmedString(body.bank_key, 80);
  const bankBranch = optionalTrimmedString(body.bank_branch, 40);
  const bankAccount = optionalTrimmedString(body.bank_account, 40);

  await writeAudit({
    organizationId: scope.org_id,
    actorUserId: ctx.user.id,
    moduleCode: 'income',
    entityType: 'income_document',
    entityId: incomeDocumentId,
    action: AUDIT_ACTIONS.INCOME_DOCUMENT_PAYMENT_ORCHESTRATION_STARTED,
    payload: {
      income_document_id: incomeDocumentId,
      amount,
      currency,
      payment_method_key: methodKey,
      payment_date: paymentDate,
      idempotency_key: idempotencyKey,
      issuer_business_id: scope.issuer_business_id,
      represented_client_id: scope.represented_client_id,
    },
  });

  try {
    let operation = await findOperation(scope.org_id, idempotencyKey);

    if (operation?.status === 'completed' && operation.receipt_document_id && operation.payment_id && operation.allocation_id) {
      return buildFullResponse(
        ctx,
        INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
        operation.invoice_document_id,
        operation.payment_id,
        operation.allocation_id,
        operation.receipt_document_id,
        true,
        documentsListYear,
      );
    }

    const invoice = await loadInvoice(scope.org_id, incomeDocumentId);
    assertRowMatchesIssuerScope(scope, {
      organization_id: invoice.organization_id,
      issuer_business_id: invoice.issuer_business_id,
      represented_client_id: invoice.represented_client_id,
    });

    if (invoice.document_status !== 'issued') {
      throw badRequest('Only issued income documents can receive payments');
    }
    if (invoice.document_type !== 'tax_invoice') {
      throw badRequest('Only tax_invoice documents are supported for payment orchestration');
    }
    if ((invoice.currency || 'ILS').toUpperCase() !== currency) {
      throw badRequest('currency must match the income document currency');
    }

    if (!operation) {
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('income_document_payment_operations')
        .insert({
          organization_id: scope.org_id,
          idempotency_key: idempotencyKey,
          command_type: INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
          invoice_document_id: invoice.id,
          status: 'started',
          amount,
          currency,
          payment_date: paymentDate,
          payment_method_key: methodKey,
          reference_number: referenceNumber,
          note,
          created_by: ctx.user.id,
        })
        .select(
          'id, organization_id, idempotency_key, invoice_document_id, payment_id, allocation_id, receipt_draft_id, receipt_document_id, status, amount, currency, payment_date, payment_method_key, reference_number, note',
        )
        .single();

      if (insErr && String((insErr as { code?: string }).code) === '23505') {
        operation = await findOperation(scope.org_id, idempotencyKey);
        if (!operation) throw insErr;
      } else {
        throwIfSupabaseError(insErr, 'Failed to start payment operation');
        operation = inserted as OperationRow;
      }
    }

    if (!operation) throw conflict('Payment operation could not be started');

    if (operation.invoice_document_id !== invoice.id) {
      throw conflict('Idempotency key already used for a different invoice');
    }

    // --- Step A: Accounting Base allocation (atomic RPC; emits paid/partial once) ---
    let paymentId = operation.payment_id;
    let allocationId = operation.allocation_id;

    if (!paymentId || !allocationId || operation.status === 'started' || operation.status === 'failed') {
      const ab = await executeRecordAndAllocateIncomePayment(ctx, scope.org_id, {
        income_document_id: invoice.id,
        payment_date: paymentDate,
        payment_method_key: methodKey,
        amount,
        currency,
        reference_number: referenceNumber,
        note,
        idempotency_key: idempotencyKey,
      });
      paymentId = ab.payment_id;
      allocationId = ab.allocation_id;
      await updateOperation(scope.org_id, operation.id, {
        payment_id: paymentId,
        allocation_id: allocationId,
        status: 'payment_allocated',
        failure_reason: null,
      });
      operation = { ...operation, payment_id: paymentId, allocation_id: allocationId, status: 'payment_allocated' };

      await writeAudit({
        organizationId: scope.org_id,
        actorUserId: ctx.user.id,
        moduleCode: 'income',
        entityType: 'accounting_payment',
        entityId: paymentId,
        action: AUDIT_ACTIONS.INCOME_DOCUMENT_PAYMENT_AB_LINKED,
        payload: {
          income_document_id: invoice.id,
          payment_id: paymentId,
          allocation_id: allocationId,
          amount,
          currency,
          idempotency_key: idempotencyKey,
          issuer_business_id: invoice.issuer_business_id,
          represented_client_id: invoice.represented_client_id,
        },
      });
    }

    // --- Step B: Automatic receipt ---
    const original = resolveIncomeInvoiceOriginalAmount(invoice.totals_snapshot_json);
    const allocatedAfter = await sumPostedAllocationsForIncomeDocument(scope.org_id, invoice.id);
    const stateAfter = resolveIncomeInvoicePaymentState(original, allocatedAfter);
    const detailsText = buildIncomePaymentReceiptDetailsText({
      invoiceNumber: invoice.document_number,
      isPartial: stateAfter.payment_state_key === 'partial',
    });

    let receiptDraftId = operation.receipt_draft_id;
    if (!receiptDraftId && !operation.receipt_document_id) {
      receiptDraftId = await createReceiptDraft({
        scope,
        invoice,
        amount,
        currency,
        paymentDate,
        paymentMethodKey: methodKey,
        detailsText,
        referenceNumber,
        note,
        bankKey,
        bankBranch,
        bankAccount,
        paymentId: paymentId!,
        allocationId: allocationId!,
      });
      await updateOperation(scope.org_id, operation.id, { receipt_draft_id: receiptDraftId });
      await writeAudit({
        organizationId: scope.org_id,
        actorUserId: ctx.user.id,
        moduleCode: 'income',
        entityType: 'income_document_draft',
        entityId: receiptDraftId,
        action: AUDIT_ACTIONS.INCOME_DOCUMENT_PAYMENT_RECEIPT_DRAFT_CREATED,
        payload: {
          income_document_id: invoice.id,
          receipt_draft_id: receiptDraftId,
          payment_id: paymentId,
          allocation_id: allocationId,
          amount,
          currency,
          idempotency_key: idempotencyKey,
        },
      });
    }

    let receiptDocumentId = operation.receipt_document_id;
    if (!receiptDocumentId) {
      if (!receiptDraftId) throw conflict('Receipt draft missing for payment operation');
      const issueResult = await executeIssueIncomeDocument(ctx, {
        draft_id: receiptDraftId,
        document_date: paymentDate,
        idempotency_key: `inv5b-receipt:${idempotencyKey}`,
      });
      receiptDocumentId = issueResult.issuedDocumentId;

      // Ensure notes land on issued document for PDF פרטים.
      await supabaseAdmin
        .from('income_documents')
        .update({ notes: detailsText })
        .eq('organization_id', scope.org_id)
        .eq('id', receiptDocumentId);

      await updateOperation(scope.org_id, operation.id, {
        receipt_document_id: receiptDocumentId,
        status: 'receipt_issued',
      });

      await writeAudit({
        organizationId: scope.org_id,
        actorUserId: ctx.user.id,
        moduleCode: 'income',
        entityType: 'income_document',
        entityId: receiptDocumentId,
        action: AUDIT_ACTIONS.INCOME_DOCUMENT_PAYMENT_RECEIPT_ISSUED,
        payload: {
          income_document_id: invoice.id,
          receipt_document_id: receiptDocumentId,
          payment_id: paymentId,
          allocation_id: allocationId,
          amount,
          currency,
          idempotency_key: idempotencyKey,
        },
      });
    }

    await insertLink({
      organizationId: scope.org_id,
      invoiceId: invoice.id,
      receiptId: receiptDocumentId!,
      paymentId: paymentId!,
      allocationId: allocationId!,
      amount,
      currency,
      label: detailsText,
      createdBy: ctx.user.id,
    });

    await writeAudit({
      organizationId: scope.org_id,
      actorUserId: ctx.user.id,
      moduleCode: 'income',
      entityType: 'income_document_link',
      entityId: receiptDocumentId,
      action: AUDIT_ACTIONS.INCOME_DOCUMENT_PAYMENT_RECEIPT_LINKED,
      payload: {
        income_document_id: invoice.id,
        receipt_document_id: receiptDocumentId,
        payment_id: paymentId,
        allocation_id: allocationId,
        amount,
        currency,
        relationship_key: INCOME_DOCUMENT_LINK_PAYMENT_RECEIPT_FOR_INVOICE,
        idempotency_key: idempotencyKey,
      },
    });

    await updateOperation(scope.org_id, operation.id, {
      status: 'completed',
      failure_reason: null,
      receipt_document_id: receiptDocumentId,
      payment_id: paymentId,
      allocation_id: allocationId,
    });

    return buildFullResponse(
      ctx,
      INCOME_COMMAND_RECORD_DOCUMENT_PAYMENT,
      invoice.id,
      paymentId!,
      allocationId!,
      receiptDocumentId!,
      false,
      documentsListYear,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const existing = await findOperation(scope.org_id, idempotencyKey);
    if (existing && existing.status !== 'completed') {
      await updateOperation(scope.org_id, existing.id, {
        status: existing.payment_id ? 'payment_allocated' : 'failed',
        failure_reason: message.slice(0, 500),
      }).catch(() => undefined);
    }
    await writeAudit({
      organizationId: scope.org_id,
      actorUserId: ctx.user.id,
      moduleCode: 'income',
      entityType: 'income_document',
      entityId: incomeDocumentId,
      action: AUDIT_ACTIONS.INCOME_DOCUMENT_PAYMENT_ORCHESTRATION_FAILED,
      payload: {
        income_document_id: incomeDocumentId,
        idempotency_key: idempotencyKey,
        amount,
        currency,
        error: message.slice(0, 500),
        payment_id: existing?.payment_id ?? null,
        allocation_id: existing?.allocation_id ?? null,
      },
    }).catch(() => undefined);
    throw err;
  }
}
