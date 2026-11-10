/**
 * Accounting Base — persist user-attested tax-obligation payment facts.
 *
 * Does not post ledger entries, invent amounts, or mark bank_verified.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
import {
  ACCOUNTING_BASE_COMMAND_ATTEST_TAX_OBLIGATION_PAYMENT,
  ACCOUNTING_BASE_TAX_PAYMENT_ATTESTATION_WRITE_PERMISSION,
  ACCOUNTING_TAX_OBLIGATION_PAYMENT_FACT_AGGREGATE_KEY,
  TAX_OBLIGATION_PAYMENT_PROVENANCE_USER_ATTESTED,
  isTaxObligationPaymentClassification,
  type AccountingTaxObligationPaymentFact,
  type TaxObligationPaymentClassification,
} from './accounting-base-tax-obligation-payment.pure.js';

const TABLE = 'accounting_tax_obligation_payment_facts';

function assertQueryError(error: { message?: string; code?: string } | null, description: string): void {
  if (error) throw new AppError(500, error.message || description, 'SUPABASE_ERROR');
}

function isMissingRelationError(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = String(error.message ?? '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    (message.includes(TABLE) && (message.includes('does not exist') || message.includes('schema cache')))
  );
}

function requirePermission(ctx: RequestContext, code: string): void {
  const perms = ctx.membership?.permissions ?? [];
  if (!perms.includes(code)) {
    throw forbidden('Insufficient permission');
  }
}

function mapFact(row: Record<string, unknown>): AccountingTaxObligationPaymentFact {
  const classification = String(row.payment_classification ?? '');
  if (!isTaxObligationPaymentClassification(classification)) {
    throw new AppError(500, 'Invalid stored payment classification', 'ACCOUNTING_BASE_CORRUPT_FACT');
  }
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    client_id: String(row.client_id),
    obligation_canonical_id: String(row.obligation_canonical_id),
    obligation_kind: String(row.obligation_kind),
    operational_period_key: String(row.operational_period_key),
    obligation_period_key: row.obligation_period_key ? String(row.obligation_period_key) : null,
    source_obligation_id: row.source_obligation_id ? String(row.source_obligation_id) : null,
    payment_classification: classification,
    provenance: TAX_OBLIGATION_PAYMENT_PROVENANCE_USER_ATTESTED,
    bank_verified: false,
    amount_paid: row.amount_paid == null ? null : Number(row.amount_paid),
    amount_remaining: row.amount_remaining == null ? null : Number(row.amount_remaining),
    payment_due_date: row.payment_due_date ? String(row.payment_due_date).slice(0, 10) : null,
    attested_by: String(row.attested_by),
    attested_at: String(row.attested_at),
  };
}

export async function loadTaxObligationPaymentFactsForClients(input: {
  organizationId: string;
  clientIds: string[];
}): Promise<Map<string, AccountingTaxObligationPaymentFact[]>> {
  const out = new Map<string, AccountingTaxObligationPaymentFact[]>();
  if (!input.clientIds.length) return out;
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(
      'id, organization_id, client_id, obligation_canonical_id, obligation_kind, operational_period_key, obligation_period_key, source_obligation_id, payment_classification, provenance, bank_verified, amount_paid, amount_remaining, payment_due_date, attested_by, attested_at',
    )
    .eq('organization_id', input.organizationId)
    .in('client_id', input.clientIds);
  if (isMissingRelationError(error)) return out;
  assertQueryError(error, 'Failed to load tax-obligation payment facts');
  for (const raw of data ?? []) {
    const fact = mapFact(raw as Record<string, unknown>);
    const list = out.get(fact.client_id) ?? [];
    list.push(fact);
    out.set(fact.client_id, list);
  }
  return out;
}

export type AttestTaxObligationPaymentInput = {
  ctx: RequestContext;
  organizationId: string;
  clientId: string;
  obligationCanonicalId: string;
  obligationKind: string;
  operationalPeriodKey: string;
  obligationPeriodKey?: string | null;
  sourceObligationId?: string | null;
  paymentClassification: TaxObligationPaymentClassification;
  paymentDueDate?: string | null;
  requireAccountingPaymentWrite?: boolean;
};

export async function attestTaxObligationPaymentFact(
  input: AttestTaxObligationPaymentInput,
): Promise<AccountingTaxObligationPaymentFact> {
  assertOrgInContext(input.ctx, input.organizationId);
  if (input.requireAccountingPaymentWrite) {
    requirePermission(input.ctx, ACCOUNTING_BASE_TAX_PAYMENT_ATTESTATION_WRITE_PERMISSION);
  }
  const canonicalId = input.obligationCanonicalId.trim();
  if (!canonicalId) throw badRequest('obligation_canonical_id required');
  const kind = input.obligationKind.trim();
  if (!kind) throw badRequest('obligation_kind required');
  const operationalPeriodKey = input.operationalPeriodKey.trim();
  if (!operationalPeriodKey) throw badRequest('operational_period_key required');
  if (!isTaxObligationPaymentClassification(input.paymentClassification)) {
    throw badRequest('payment_classification required');
  }

  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('id', input.clientId)
    .eq('is_archived', false)
    .maybeSingle();
  assertQueryError(clientError, 'Failed to validate client for tax payment attestation');
  if (!client) throw forbidden('Client not found');

  const now = new Date().toISOString();
  const row = {
    organization_id: input.organizationId,
    client_id: input.clientId,
    obligation_canonical_id: canonicalId,
    obligation_kind: kind,
    operational_period_key: operationalPeriodKey,
    obligation_period_key: input.obligationPeriodKey?.trim() || null,
    source_obligation_id: input.sourceObligationId?.trim() || null,
    payment_classification: input.paymentClassification,
    provenance: TAX_OBLIGATION_PAYMENT_PROVENANCE_USER_ATTESTED,
    bank_verified: false,
    amount_paid: null,
    amount_remaining: null,
    payment_due_date: input.paymentDueDate?.slice(0, 10) || null,
    attested_by: input.ctx.user.id,
    attested_at: now,
    updated_at: now,
  };

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .upsert(row, { onConflict: 'organization_id,client_id,obligation_canonical_id' })
    .select(
      'id, organization_id, client_id, obligation_canonical_id, obligation_kind, operational_period_key, obligation_period_key, source_obligation_id, payment_classification, provenance, bank_verified, amount_paid, amount_remaining, payment_due_date, attested_by, attested_at',
    )
    .single();
  if (isMissingRelationError(error)) {
    throw new AppError(
      503,
      'Tax-obligation payment facts table is not migrated',
      'ACCOUNTING_BASE_TAX_PAYMENT_FACTS_PENDING_MIGRATION',
    );
  }
  assertQueryError(error, 'Failed to attest tax-obligation payment');
  const fact = mapFact((data ?? {}) as Record<string, unknown>);
  await writeAudit({
    organizationId: input.organizationId,
    actorUserId: input.ctx.user.id,
    moduleCode: 'accounting_base',
    entityType: 'accounting_tax_obligation_payment_fact',
    entityId: fact.id,
    action: AUDIT_ACTIONS.ACCOUNTING_BASE_TAX_OBLIGATION_PAYMENT_ATTESTED,
    payload: {
      command: ACCOUNTING_BASE_COMMAND_ATTEST_TAX_OBLIGATION_PAYMENT,
      client_id: fact.client_id,
      obligation_canonical_id: fact.obligation_canonical_id,
      payment_classification: fact.payment_classification,
      provenance: fact.provenance,
      bank_verified: false,
      amount_paid: null,
      amount_remaining: null,
    },
  });
  return fact;
}

export type AttestTaxObligationPaymentCommandResponse = {
  ok: true;
  command: typeof ACCOUNTING_BASE_COMMAND_ATTEST_TAX_OBLIGATION_PAYMENT;
  refreshed: {
    aggregate_key: typeof ACCOUNTING_TAX_OBLIGATION_PAYMENT_FACT_AGGREGATE_KEY;
    aggregate: { fact: AccountingTaxObligationPaymentFact };
  };
};

export async function executeAttestTaxObligationPayment(
  ctx: RequestContext,
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<AttestTaxObligationPaymentCommandResponse> {
  const classification = String(payload.payment_classification ?? '').trim();
  if (!isTaxObligationPaymentClassification(classification)) {
    throw badRequest('payment_classification required');
  }
  const fact = await attestTaxObligationPaymentFact({
    ctx,
    organizationId,
    clientId: String(payload.client_id ?? '').trim(),
    obligationCanonicalId: String(payload.obligation_canonical_id ?? '').trim(),
    obligationKind: String(payload.obligation_kind ?? '').trim(),
    operationalPeriodKey: String(payload.operational_period_key ?? '').trim(),
    obligationPeriodKey: payload.obligation_period_key ? String(payload.obligation_period_key) : null,
    sourceObligationId: payload.source_obligation_id ? String(payload.source_obligation_id) : null,
    paymentClassification: classification,
    paymentDueDate: payload.payment_due_date ? String(payload.payment_due_date) : null,
    requireAccountingPaymentWrite: true,
  });
  return {
    ok: true,
    command: ACCOUNTING_BASE_COMMAND_ATTEST_TAX_OBLIGATION_PAYMENT,
    refreshed: {
      aggregate_key: ACCOUNTING_TAX_OBLIGATION_PAYMENT_FACT_AGGREGATE_KEY,
      aggregate: { fact },
    },
  };
}
