import { supabaseAdmin } from '../../db/client.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import {
  assertClientDataEncryptionConfigured,
  cardLast4,
  decryptJson,
  encryptJson,
  normalizeCardPaymentPayload,
  type CardPaymentPayload,
} from '../../shared/field-encryption.js';
import { inferCardBrand } from '../../shared/card-brand.js';
import {
  assertPaymentCardSecureSessionActive,
  getPaymentSecureSessionsForUser,
  type PaymentSecureSessionInfo,
} from './payment-card-access.service.js';
import {
  computeOsekPaturDeclarationUi,
  type OsekPaturDeclarationUi,
} from './osek-patur-declaration.js';
import { formatNationalInsuranceRegistryDisplayHe } from './national-insurance-registry.js';
import {
  computeNextVatDivuachDueDate,
  computeVatDueRegistryDisplayHe,
  computeVatRegistryColumnDisplayHe,
  formatVatDivuachDisplayHe,
  toIsoDateOnly,
} from './vat-divuach.js';

export type ClientTaxSettingsRow = {
  id: string;
  organization_id: string;
  client_id: string;
  vat_type: string | null;
  vat_frequency: string | null;
  vat_due_type: string | null;
  income_tax_advance_enabled: boolean;
  income_tax_advance_percent: number | null;
  income_tax_advance_frequency: string | null;
  income_tax_deductions_enabled: boolean;
  income_tax_deductions_file_number: string | null;
  /** May be absent on rows before migration 036 */
  income_tax_deductions_frequency?: string | null;
  national_insurance_type: string | null;
  national_insurance_monthly_amount: number | null;
  national_insurance_deductions_file_number: string | null;
  vat_payment_method: string | null;
  vat_payment_details_encrypted: string | null;
  vat_other_payment_text: string | null;
  vat_card_last4: string | null;
  vat_card_expiry_masked: string | null;
  /** visa | mastercard | amex | diners | isracard | unknown — from PAN at save */
  vat_card_brand?: string | null;
  vat_card_holder_name?: string | null;
  income_tax_payment_method: string | null;
  income_tax_payment_details_encrypted: string | null;
  income_tax_other_payment_text: string | null;
  income_tax_card_last4: string | null;
  income_tax_card_expiry_masked: string | null;
  income_tax_card_brand?: string | null;
  income_tax_card_holder_name?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ClientTaxSettingsPublic = {
  vat_type: string | null;
  vat_frequency: string | null;
  vat_due_type: string | null;
  income_tax_advance_enabled: boolean;
  income_tax_advance_percent: number | null;
  income_tax_advance_frequency: string | null;
  income_tax_deductions_enabled: boolean;
  income_tax_deductions_file_number: string | null;
  income_tax_deductions_frequency: string | null;
  national_insurance_type: string | null;
  national_insurance_monthly_amount: number | null;
  national_insurance_deductions_file_number: string | null;
  vat_payment_method: string | null;
  vat_payment_masked: {
    last4: string | null;
    expiry: string | null;
    card_number_masked: string | null;
    brand: string | null;
  };
  income_tax_payment_method: string | null;
  income_tax_payment_masked: {
    last4: string | null;
    expiry: string | null;
    card_number_masked: string | null;
    brand: string | null;
  };
  vat_other_payment_text: string | null;
  income_tax_other_payment_text: string | null;
  notes: string | null;
  /** בחר / כן / לא — נגזר מהשרת (טבלה + פרופיל) לתצוגה בלבד */
  income_tax_advance_ui_selection: 'choose' | 'yes' | 'no';
  /** בחר / כן / לא — נגזר מהשרת (טבלה + פרופיל) לתצוגה בלבד */
  income_tax_deductions_ui_selection: 'choose' | 'yes' | 'no';
  /** יעד דיווח מע״מ הבא (ISO YYYY-MM-DD) — לתזכורות; מחושב מ-PCN/רגיל + תדירות */
  vat_divuach_next_due_at: string | null;
  vat_divuach_next_due_display_he: string | null;
  /** רשימת לקוחות: PCN או תאריך (רגיל) */
  vat_due_registry_display_he: string | null;
  vat_card_holder_name: string | null;
  income_tax_card_holder_name: string | null;
  client_tax_id: string | null;
  client_display_name: string | null;
  payment_secure_sessions: {
    vat: PaymentSecureSessionInfo;
    income_tax: PaymentSecureSessionInfo;
  };
};

/** Backend-driven UI: which detail modals should be surfaced (frontend only opens when true). */
export type ClientTaxUiHints = {
  income_tax_advance_modal: boolean;
  income_tax_deductions_modal: boolean;
  national_insurance_modal: boolean;
  vat_credit_modal: boolean;
  income_tax_credit_modal: boolean;
  vat_other_modal: boolean;
  income_tax_other_modal: boolean;
  /** true when סוג עסק is עוסק פטור — תדירות מע״מ is not editable (server-driven). */
  vat_frequency_disabled: boolean;
  /** When non-null, replace יום יעד למע״מ with הצהרת עסק פטור + תאריך + tooltip (server-driven). */
  osek_patur_vat_due: OsekPaturDeclarationUi | null;
  /** כשמס הכנסה ניכויים = לא — שורה זו לא פעילה ומציגה טקסט קבוע מהשרת. */
  national_insurance_deductions_disabled: boolean;
  /** תווית שדה (ללא סוגריים) */
  national_insurance_deductions_label_he: string;
  /** טקסט תצוגה כשלא פעיל (למשל לא רלוונטי) */
  national_insurance_deductions_inactive_display_he: string;
};

export type ClientTaxSettingsResponse = {
  settings: ClientTaxSettingsPublic;
  ui: ClientTaxUiHints;
};

/** When סוג עסק is עוסק פטור, מע״מ must be פטור (server-enforced; frontend only displays API). */
export const OSEK_PATUR_BUSINESS_TYPE = 'עוסק פטור';

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

async function getClientOperationalProfileSlice(
  orgId: string,
  clientId: string
): Promise<{
  business_type: string | null;
  income_tax_advance_status: string | null;
  income_tax_deductions_status: string | null;
}> {
  const { data: prof } = await supabaseAdmin
    .from('client_operational_profiles')
    .select('business_type, income_tax_advance_status, income_tax_deductions_status')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();
  const p = prof as {
    business_type?: string | null;
    income_tax_advance_status?: string | null;
    income_tax_deductions_status?: string | null;
  } | null;
  const bt = p?.business_type?.trim() ? p.business_type : null;
  const st = p?.income_tax_advance_status ?? null;
  const ded = p?.income_tax_deductions_status ?? null;
  return { business_type: bt, income_tax_advance_status: st, income_tax_deductions_status: ded };
}

function deriveIncomeTaxAdvanceUiSelection(
  r: ClientTaxSettingsRow,
  profileAdvanceStatus: string | null
): 'choose' | 'yes' | 'no' {
  if (r.income_tax_advance_enabled) return 'yes';
  if ((profileAdvanceStatus ?? '').trim() === 'לא') return 'no';
  return 'choose';
}

function deriveIncomeTaxDeductionsUiSelection(
  r: ClientTaxSettingsRow,
  profileDeductionsStatus: string | null
): 'choose' | 'yes' | 'no' {
  if (r.income_tax_deductions_enabled) return 'yes';
  if ((profileDeductionsStatus ?? '').trim() === 'לא') return 'no';
  return 'choose';
}

/** מסנכרן client_operational_profiles.income_tax_advance_status לרשימה הראשית (מקדמות / לא / בחר). */
async function syncIncomeTaxAdvanceStatusToProfile(
  orgId: string,
  clientId: string,
  next: ClientTaxSettingsRow,
  selectionInBody: 'choose' | 'yes' | 'no' | undefined
): Promise<void> {
  let status: string | null | undefined = undefined;
  if (next.income_tax_advance_enabled) {
    if (next.income_tax_advance_percent != null && next.income_tax_advance_frequency) {
      status = 'כן';
    }
  } else {
    if (selectionInBody === 'no') status = 'לא';
    else if (selectionInBody === 'choose') status = null;
  }
  if (status === undefined) return;

  await supabaseAdmin
    .from('client_operational_profiles')
    .update({
      income_tax_advance_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
}

/** מסנכרן client_operational_profiles.income_tax_deductions_status לרשימה הראשית. */
async function syncIncomeTaxDeductionsStatusToProfile(
  orgId: string,
  clientId: string,
  next: ClientTaxSettingsRow,
  selectionInBody: 'choose' | 'yes' | 'no' | undefined
): Promise<void> {
  let status: string | null | undefined = undefined;
  if (next.income_tax_deductions_enabled) {
    if (
      (next.income_tax_deductions_file_number ?? '').trim() &&
      next.income_tax_deductions_frequency
    ) {
      status = 'כן';
    }
  } else {
    if (selectionInBody === 'no') status = 'לא';
    else if (selectionInBody === 'choose') status = null;
  }
  if (status === undefined) return;

  await supabaseAdmin
    .from('client_operational_profiles')
    .update({
      income_tax_deductions_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
}

/** מסנכרן national_insurance_deductions_status לרשימה (כן / לא רלוונטי כשמס הכנסה ניכויים = לא). */
async function syncNationalInsuranceDeductionsStatusToProfile(
  orgId: string,
  clientId: string,
  next: ClientTaxSettingsRow,
  selectionInBody: 'choose' | 'yes' | 'no' | undefined
): Promise<void> {
  let status: string | null | undefined = undefined;
  if (next.income_tax_deductions_enabled) {
    if (
      (next.income_tax_deductions_file_number ?? '').trim() &&
      next.income_tax_deductions_frequency
    ) {
      const niFile = computeNiDeductionsAuto(true, next.income_tax_deductions_file_number);
      if (niFile) status = 'כן';
    }
  } else {
    if (selectionInBody === 'no') status = 'לא רלוונטי';
    else if (selectionInBody === 'choose') status = null;
  }
  if (status === undefined) return;

  await supabaseAdmin
    .from('client_operational_profiles')
    .update({
      national_insurance_deductions_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
}

/** מסנכרן client_operational_profiles.vat_status לרשימה (תדירות מע״מ / פטור לעוסק פטור). */
async function syncVatStatusToProfile(
  orgId: string,
  clientId: string,
  next: ClientTaxSettingsRow,
  businessType: string | null
): Promise<void> {
  const status = computeVatRegistryColumnDisplayHe(businessType, next.vat_type, next.vat_frequency);
  await supabaseAdmin
    .from('client_operational_profiles')
    .update({
      vat_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
}

/** מסנכרן national_insurance_status לרשימה (סכום חודשי / לא עונה להגדרות). */
async function syncNationalInsuranceStatusToProfile(
  orgId: string,
  clientId: string,
  next: ClientTaxSettingsRow
): Promise<void> {
  const status = formatNationalInsuranceRegistryDisplayHe(next.national_insurance_type, next.national_insurance_monthly_amount);
  await supabaseAdmin
    .from('client_operational_profiles')
    .update({
      national_insurance_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
}

/** If client is עוסק פטור, מע״מ is patur and תדירות מע״מ is לא רלוונטי (server-enforced). */
function applyOsekPaturVatRule(r: ClientTaxSettingsRow, businessType: string | null): ClientTaxSettingsRow {
  if (businessType !== OSEK_PATUR_BUSINESS_TYPE) return r;
  return { ...r, vat_type: 'patur', vat_frequency: 'not_relevant', vat_due_type: 'not_relevant' };
}

/**
 * After profile save: persist vat_type = patur when סוג עסק is עוסק פטור (single source of truth in DB).
 */
export async function syncVatPaturForOsekPaturBusinessType(
  ctx: RequestContext,
  clientId: string,
  businessType: string
): Promise<void> {
  if (businessType !== OSEK_PATUR_BUSINESS_TYPE) return;

  const orgId = assertOrg(ctx);
  const userId = ctx.user.id;

  const { data: row } = await supabaseAdmin
    .from('client_tax_settings')
    .select('vat_type, vat_frequency, vat_due_type')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();

  const r = row as {
    vat_type: string | null;
    vat_frequency: string | null;
    vat_due_type: string | null;
  } | null;
  if (r && r.vat_type === 'patur' && r.vat_frequency === 'not_relevant' && r.vat_due_type === 'not_relevant') {
    return;
  }

  const { error } = await supabaseAdmin.from('client_tax_settings').upsert(
    {
      organization_id: orgId,
      client_id: clientId,
      vat_type: 'patur',
      vat_frequency: 'not_relevant',
      vat_due_type: 'not_relevant',
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,client_id' }
  );

  if (error) {
    throw new AppError(500, error.message ?? 'Failed to sync VAT for עוסק פטור', 'OSEK_PATUR_VAT_SYNC');
  }

  await supabaseAdmin
    .from('client_operational_profiles')
    .update({
      vat_status: computeVatRegistryColumnDisplayHe(OSEK_PATUR_BUSINESS_TYPE, 'patur', 'not_relevant'),
      updated_at: new Date().toISOString(),
    })
    .eq('organization_id', orgId)
    .eq('client_id', clientId);

  if (!r || r.vat_type !== 'patur') {
    await insertEventLog({
      organizationId: orgId,
      clientId,
      userId,
      field: 'vat_type',
      oldValue: r ? String(r.vat_type ?? '') : null,
      newValue: 'patur',
    });
  }
  if (!r || r.vat_frequency !== 'not_relevant') {
    await insertEventLog({
      organizationId: orgId,
      clientId,
      userId,
      field: 'vat_frequency',
      oldValue: r ? String(r.vat_frequency ?? '') : null,
      newValue: 'not_relevant',
    });
  }
  if (!r || r.vat_due_type !== 'not_relevant') {
    await insertEventLog({
      organizationId: orgId,
      clientId,
      userId,
      field: 'vat_due_type',
      oldValue: r ? String(r.vat_due_type ?? '') : null,
      newValue: 'not_relevant',
    });
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: userId,
    moduleCode: 'client-operations',
    entityType: 'client_tax_settings',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_TAX_SETTINGS_UPDATED,
    payload: { client_id: clientId, rule: 'osek_patur_vat_patur' },
  });
}

function vatDivuachFieldsFromRow(r: ClientTaxSettingsRow): {
  vat_divuach_next_due_at: string | null;
  vat_divuach_next_due_display_he: string | null;
  vat_due_registry_display_he: string | null;
} {
  const next = computeNextVatDivuachDueDate({
    vat_due_type: r.vat_due_type,
    vat_frequency: r.vat_frequency,
  });
  return {
    vat_divuach_next_due_at: next ? toIsoDateOnly(next) : null,
    vat_divuach_next_due_display_he: next ? formatVatDivuachDisplayHe(next) : null,
    vat_due_registry_display_he: computeVatDueRegistryDisplayHe(r.vat_due_type, r.vat_frequency),
  };
}

function mergeTaxSettingsWithClientAndSessions(
  s: ClientTaxSettingsPublic,
  clientTaxId: string | null,
  clientDisplayName: string | null,
  sessions: { vat: PaymentSecureSessionInfo; income_tax: PaymentSecureSessionInfo }
): ClientTaxSettingsPublic {
  return {
    ...s,
    client_tax_id: clientTaxId,
    client_display_name: clientDisplayName,
    payment_secure_sessions: sessions,
  };
}

/** Safe display only — never full PAN; last4 comes from server-side derivation at save. */
function cardNumberMaskedFromLast4(last4: string | null): string | null {
  const d = (last4 ?? '').replace(/\D/g, '');
  if (d.length < 4) return null;
  return `**** **** **** ${d.slice(-4)}`;
}

function rowToPublic(
  r: ClientTaxSettingsRow,
  profileAdvanceStatus: string | null,
  profileDeductionsStatus: string | null
): ClientTaxSettingsPublic {
  return {
    vat_type: r.vat_type,
    vat_frequency: r.vat_frequency,
    vat_due_type: r.vat_due_type,
    income_tax_advance_enabled: r.income_tax_advance_enabled,
    income_tax_advance_percent: r.income_tax_advance_percent,
    income_tax_advance_frequency: r.income_tax_advance_frequency,
    income_tax_advance_ui_selection: deriveIncomeTaxAdvanceUiSelection(r, profileAdvanceStatus),
    income_tax_deductions_enabled: r.income_tax_deductions_enabled,
    income_tax_deductions_file_number: r.income_tax_deductions_file_number,
    income_tax_deductions_frequency: r.income_tax_deductions_frequency ?? null,
    income_tax_deductions_ui_selection: deriveIncomeTaxDeductionsUiSelection(r, profileDeductionsStatus),
    national_insurance_type: r.national_insurance_type,
    national_insurance_monthly_amount: r.national_insurance_monthly_amount,
    national_insurance_deductions_file_number: r.national_insurance_deductions_file_number,
    vat_payment_method: r.vat_payment_method,
    vat_payment_masked: {
      last4: r.vat_card_last4,
      expiry: r.vat_card_expiry_masked,
      card_number_masked: cardNumberMaskedFromLast4(r.vat_card_last4),
      brand: r.vat_card_brand ?? null,
    },
    income_tax_payment_method: r.income_tax_payment_method,
    income_tax_payment_masked: {
      last4: r.income_tax_card_last4,
      expiry: r.income_tax_card_expiry_masked,
      card_number_masked: cardNumberMaskedFromLast4(r.income_tax_card_last4),
      brand: r.income_tax_card_brand ?? null,
    },
    vat_other_payment_text: r.vat_other_payment_text,
    income_tax_other_payment_text: r.income_tax_other_payment_text,
    notes: r.notes,
    ...vatDivuachFieldsFromRow(r),
    vat_card_holder_name: r.vat_card_holder_name ?? null,
    income_tax_card_holder_name: r.income_tax_card_holder_name ?? null,
    client_tax_id: null,
    client_display_name: null,
    payment_secure_sessions: {
      vat: { active: false, expires_at: null },
      income_tax: { active: false, expires_at: null },
    },
  };
}

function computeUi(
  r: ClientTaxSettingsRow
): Omit<
  ClientTaxUiHints,
  | 'vat_frequency_disabled'
  | 'osek_patur_vat_due'
  | 'national_insurance_deductions_disabled'
  | 'national_insurance_deductions_label_he'
  | 'national_insurance_deductions_inactive_display_he'
> {
  const adv = r.income_tax_advance_enabled;
  const advIncomplete =
    adv &&
    (r.income_tax_advance_percent == null ||
      r.income_tax_advance_frequency == null ||
      Number.isNaN(Number(r.income_tax_advance_percent)));

  const ded = r.income_tax_deductions_enabled;
  const dedIncomplete =
    ded &&
    (!(r.income_tax_deductions_file_number ?? '').trim() || !r.income_tax_deductions_frequency);

  const ni = r.national_insurance_type === 'yes';
  const niIncomplete = ni && (r.national_insurance_monthly_amount == null || Number.isNaN(Number(r.national_insurance_monthly_amount)));

  const vatCredit = r.vat_payment_method === 'credit';
  const vatCreditIncomplete = vatCredit && !r.vat_payment_details_encrypted;

  const itCredit = r.income_tax_payment_method === 'credit';
  const itCreditIncomplete = itCredit && !r.income_tax_payment_details_encrypted;

  const vatOther = r.vat_payment_method === 'other';
  const vatOtherIncomplete = vatOther && !(r.vat_other_payment_text ?? '').trim();

  const itOther = r.income_tax_payment_method === 'other';
  const itOtherIncomplete = itOther && !(r.income_tax_other_payment_text ?? '').trim();

  return {
    income_tax_advance_modal: Boolean(advIncomplete),
    income_tax_deductions_modal: Boolean(dedIncomplete),
    national_insurance_modal: Boolean(niIncomplete),
    vat_credit_modal: Boolean(vatCreditIncomplete),
    income_tax_credit_modal: Boolean(itCreditIncomplete),
    vat_other_modal: Boolean(vatOtherIncomplete),
    income_tax_other_modal: Boolean(itOtherIncomplete),
  };
}

function buildTaxUi(
  effective: ClientTaxSettingsRow,
  businessType: string | null,
  profileDeductionsStatus: string | null
): ClientTaxUiHints {
  const isOsekPatur = businessType === OSEK_PATUR_BUSINESS_TYPE;
  const incomeTaxDeductionsIsNo = deriveIncomeTaxDeductionsUiSelection(effective, profileDeductionsStatus) === 'no';
  return {
    ...computeUi(effective),
    vat_frequency_disabled: isOsekPatur,
    osek_patur_vat_due: isOsekPatur ? computeOsekPaturDeclarationUi(new Date()) : null,
    national_insurance_deductions_disabled: incomeTaxDeductionsIsNo,
    national_insurance_deductions_label_he: 'ביטוח לאומי ניכויים',
    national_insurance_deductions_inactive_display_he: 'לא רלוונטי',
  };
}

function computeNiDeductionsAuto(incomeTaxDeductionsEnabled: boolean, fileNo: string | null): string | null {
  if (!incomeTaxDeductionsEnabled) return null;
  const b = (fileNo ?? '').trim();
  if (!b) return null;
  return `${b}00`;
}

/**
 * עמודת ביטוח לאומי ניכויים ברשימה — מסונכרן עם המסך (מס הכנסה ניכויים = לא → לא רלוונטי).
 */
export function computeNationalInsuranceDeductionsRegistryDisplayHe(
  tax: {
    income_tax_deductions_enabled: boolean;
    income_tax_deductions_file_number: string | null;
    income_tax_deductions_frequency: string | null;
  } | null,
  incomeTaxDeductionsProfileStatus: string | null
): string | null {
  if (!tax) {
    if ((incomeTaxDeductionsProfileStatus ?? '').trim() === 'לא') return 'לא רלוונטי';
    return null;
  }
  if (tax.income_tax_deductions_enabled) {
    const complete =
      (tax.income_tax_deductions_file_number ?? '').trim() && tax.income_tax_deductions_frequency;
    if (!complete) return null;
    const niFile = computeNiDeductionsAuto(true, tax.income_tax_deductions_file_number);
    return niFile ? 'כן' : null;
  }
  if ((incomeTaxDeductionsProfileStatus ?? '').trim() === 'לא') {
    return 'לא רלוונטי';
  }
  return null;
}

async function insertEventLog(params: {
  organizationId: string;
  clientId: string;
  userId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
}): Promise<void> {
  await supabaseAdmin.from('client_tax_settings_event_log').insert({
    organization_id: params.organizationId,
    client_id: params.clientId,
    user_id: params.userId,
    action_type: 'update_tax_settings',
    field_changed: params.field,
    old_value: params.oldValue,
    new_value: params.newValue,
  });
}

/** Sensitive copy — logs fact only, never PAN/expiry text */
async function insertRevealPaymentSecretEventLog(params: {
  organizationId: string;
  clientId: string;
  userId: string;
  paymentType: 'vat' | 'income_tax';
  secretKind: 'card_number' | 'expiry';
}): Promise<void> {
  const actionType =
    params.secretKind === 'card_number' ? 'payment_card_number_copied' : 'payment_card_expiry_copied';
  await supabaseAdmin.from('client_tax_settings_event_log').insert({
    organization_id: params.organizationId,
    client_id: params.clientId,
    user_id: params.userId,
    action_type: actionType,
    field_changed: `${params.paymentType}:${params.secretKind}`,
    old_value: null,
    new_value: '[copy]',
  });
}

/** Only PAN or expiry; CVV is never stored or returned */
export type PaymentSecretKind = 'card_number' | 'expiry';

/**
 * Decrypt a single requested field after secure SMS session; audit + event_log.
 */
export async function revealClientPaymentSecret(
  ctx: RequestContext,
  clientId: string,
  paymentType: 'vat' | 'income_tax',
  secretKind: PaymentSecretKind
): Promise<{ value: string }> {
  const orgId = assertOrg(ctx);
  const userId = ctx.user.id;

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('id', clientId).maybeSingle();
  if (!client) throw forbidden('Client not found');

  assertClientDataEncryptionConfigured();
  await assertPaymentCardSecureSessionActive(ctx, clientId, paymentType);

  const { data: row, error } = await supabaseAdmin
    .from('client_tax_settings')
    .select('vat_payment_details_encrypted, income_tax_payment_details_encrypted')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (error) {
    throw new AppError(500, error.message ?? 'client_tax_settings read failed', 'SUPABASE_ERROR');
  }
  if (!row) throw forbidden('Tax settings not found');

  const enc =
    paymentType === 'vat' ? row.vat_payment_details_encrypted : row.income_tax_payment_details_encrypted;
  if (!enc) throw badRequest('No card on file');

  const raw = decryptJson<Record<string, unknown>>(enc);
  const payload = normalizeCardPaymentPayload(raw);

  const value = secretKind === 'card_number' ? payload.card_number : payload.expiry;

  await writeAudit({
    organizationId: orgId,
    actorUserId: userId,
    moduleCode: 'client-operations',
    entityType: 'client_tax_settings',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_TAX_PAYMENT_SECRET_REVEALED,
    payload: { client_id: clientId, payment_type: paymentType, secret_kind: secretKind },
  });

  await insertRevealPaymentSecretEventLog({
    organizationId: orgId,
    clientId,
    userId,
    paymentType,
    secretKind,
  });

  return { value };
}

async function loadClientTaxIdAndName(
  orgId: string,
  clientId: string
): Promise<{ tax_id: string | null; display_name: string | null }> {
  const { data: clientRow } = await supabaseAdmin
    .from('clients')
    .select('tax_id, display_name')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  const c = clientRow as { tax_id: string; display_name: string } | null;
  return { tax_id: c?.tax_id ?? null, display_name: c?.display_name ?? null };
}

export async function getClientTaxSettings(ctx: RequestContext, clientId: string): Promise<ClientTaxSettingsResponse> {
  const orgId = assertOrg(ctx);
  const {
    business_type: businessType,
    income_tax_advance_status: profileAdvanceStatus,
    income_tax_deductions_status: profileDeductionsStatus,
  } = await getClientOperationalProfileSlice(orgId, clientId);

  const { data: row, error: taxReadErr } = await supabaseAdmin
    .from('client_tax_settings')
    .select('*')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();

  if (taxReadErr) {
    throw new AppError(500, taxReadErr.message ?? 'client_tax_settings read failed', 'SUPABASE_ERROR');
  }

  const clientSnap = await loadClientTaxIdAndName(orgId, clientId);
  const sessions = await getPaymentSecureSessionsForUser(orgId, ctx.user.id, clientId);

  if (!row) {
    const empty: ClientTaxSettingsRow = {
      id: '',
      organization_id: orgId,
      client_id: clientId,
      vat_type: null,
      vat_frequency: null,
      vat_due_type: null,
      income_tax_advance_enabled: false,
      income_tax_advance_percent: null,
      income_tax_advance_frequency: null,
      income_tax_deductions_enabled: false,
      income_tax_deductions_file_number: null,
      income_tax_deductions_frequency: null,
      national_insurance_type: null,
      national_insurance_monthly_amount: null,
      national_insurance_deductions_file_number: null,
      vat_payment_method: null,
      vat_payment_details_encrypted: null,
      vat_other_payment_text: null,
      vat_card_last4: null,
      vat_card_expiry_masked: null,
      vat_card_brand: null,
      vat_card_holder_name: null,
      income_tax_payment_method: null,
      income_tax_payment_details_encrypted: null,
      income_tax_other_payment_text: null,
      income_tax_card_last4: null,
      income_tax_card_expiry_masked: null,
      income_tax_card_brand: null,
      income_tax_card_holder_name: null,
      notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const effective = applyOsekPaturVatRule(empty, businessType);
    return {
      settings: mergeTaxSettingsWithClientAndSessions(
        rowToPublic(effective, profileAdvanceStatus, profileDeductionsStatus),
        clientSnap.tax_id,
        clientSnap.display_name,
        sessions
      ),
      ui: buildTaxUi(effective, businessType, profileDeductionsStatus),
    };
  }

  const r = applyOsekPaturVatRule(row as ClientTaxSettingsRow, businessType);
  return {
    settings: mergeTaxSettingsWithClientAndSessions(
      rowToPublic(r, profileAdvanceStatus, profileDeductionsStatus),
      clientSnap.tax_id,
      clientSnap.display_name,
      sessions
    ),
    ui: buildTaxUi(r, businessType, profileDeductionsStatus),
  };
}

export type UpdateClientTaxSettingsBody = Partial<{
  vat_type: string | null;
  vat_frequency: string | null;
  vat_due_type: string | null;
  income_tax_advance_enabled: boolean;
  income_tax_advance_percent: number | null;
  income_tax_advance_frequency: string | null;
  income_tax_deductions_enabled: boolean;
  income_tax_deductions_file_number: string | null;
  income_tax_deductions_frequency: string | null;
  national_insurance_type: string | null;
  national_insurance_monthly_amount: number | null;
  national_insurance_deductions_file_number: string | null;
  vat_payment_method: string | null;
  income_tax_payment_method: string | null;
  vat_other_payment_text: string | null;
  income_tax_other_payment_text: string | null;
  notes: string | null;
  vat_credit_card: ({ card_number: string; expiry: string; card_holder_name?: string | null }) | null;
  income_tax_credit_card: ({ card_number: string; expiry: string; card_holder_name?: string | null }) | null;
  vat_card_holder_name?: string | null;
  income_tax_card_holder_name?: string | null;
  income_tax_advance_ui_selection?: 'choose' | 'yes' | 'no';
  income_tax_deductions_ui_selection?: 'choose' | 'yes' | 'no';
}>;

const ALLOW = {
  vat_type: new Set(['yes', 'no', 'patur']),
  vat_frequency: new Set(['monthly', 'bi_monthly', 'not_relevant']),
  vat_due_type: new Set(['pcn', 'regular', 'not_relevant']),
  freq: new Set(['monthly', 'bi_monthly', 'semi_annual']),
  ni: new Set(['yes', 'not_applicable']),
  pay: new Set(['credit', 'bank_order', 'voucher', 'other']),
};

export async function updateClientTaxSettings(
  ctx: RequestContext,
  clientId: string,
  body: UpdateClientTaxSettingsBody
): Promise<ClientTaxSettingsResponse> {
  const orgId = assertOrg(ctx);
  const userId = ctx.user.id;

  const { data: client } = await supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('id', clientId).maybeSingle();
  if (!client) throw forbidden('Client not found');

  const prev = await supabaseAdmin
    .from('client_tax_settings')
    .select('*')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();

  const base: ClientTaxSettingsRow = prev.data
    ? (prev.data as ClientTaxSettingsRow)
    : ({
        id: '',
        organization_id: orgId,
        client_id: clientId,
        vat_type: null,
        vat_frequency: null,
        vat_due_type: null,
        income_tax_advance_enabled: false,
        income_tax_advance_percent: null,
        income_tax_advance_frequency: null,
        income_tax_deductions_enabled: false,
        income_tax_deductions_file_number: null,
        income_tax_deductions_frequency: null,
        national_insurance_type: null,
        national_insurance_monthly_amount: null,
        national_insurance_deductions_file_number: null,
        vat_payment_method: null,
        vat_payment_details_encrypted: null,
        vat_other_payment_text: null,
        vat_card_last4: null,
        vat_card_expiry_masked: null,
        vat_card_brand: null,
        income_tax_payment_method: null,
        income_tax_payment_details_encrypted: null,
        income_tax_other_payment_text: null,
        income_tax_card_last4: null,
        income_tax_card_expiry_masked: null,
        income_tax_card_brand: null,
        vat_card_holder_name: null,
        income_tax_card_holder_name: null,
        notes: null,
        created_at: '',
        updated_at: '',
      } as ClientTaxSettingsRow);

  const next: ClientTaxSettingsRow = { ...base };

  const pick = <K extends keyof ClientTaxSettingsRow>(k: K, v: ClientTaxSettingsRow[K]) => {
    next[k] = v;
  };

  if (body.vat_type !== undefined) {
    if (body.vat_type != null && !ALLOW.vat_type.has(body.vat_type)) throw badRequest('Invalid vat_type');
    pick('vat_type', body.vat_type ?? null);
  }
  if (body.vat_frequency !== undefined) {
    if (body.vat_frequency != null && !ALLOW.vat_frequency.has(body.vat_frequency)) throw badRequest('Invalid vat_frequency');
    pick('vat_frequency', body.vat_frequency ?? null);
  }
  if (body.vat_due_type !== undefined) {
    if (body.vat_due_type != null && !ALLOW.vat_due_type.has(body.vat_due_type)) throw badRequest('Invalid vat_due_type');
    pick('vat_due_type', body.vat_due_type ?? null);
  }
  if (body.income_tax_advance_ui_selection !== undefined) {
    const s = body.income_tax_advance_ui_selection;
    if (s === 'choose' || s === 'no') {
      next.income_tax_advance_enabled = false;
      next.income_tax_advance_percent = null;
      next.income_tax_advance_frequency = null;
    } else if (s === 'yes') {
      next.income_tax_advance_enabled = true;
    }
  }
  if (body.income_tax_advance_enabled !== undefined && body.income_tax_advance_ui_selection === undefined) {
    pick('income_tax_advance_enabled', Boolean(body.income_tax_advance_enabled));
  }
  if (body.income_tax_advance_percent !== undefined) {
    if (body.income_tax_advance_percent != null && typeof body.income_tax_advance_percent !== 'number') throw badRequest('Invalid percent');
    pick('income_tax_advance_percent', body.income_tax_advance_percent);
  }
  if (body.income_tax_advance_frequency !== undefined) {
    if (body.income_tax_advance_frequency != null && !ALLOW.freq.has(body.income_tax_advance_frequency)) {
      throw badRequest('Invalid income_tax_advance_frequency');
    }
    pick('income_tax_advance_frequency', body.income_tax_advance_frequency ?? null);
  }
  if (body.income_tax_deductions_ui_selection !== undefined) {
    const s = body.income_tax_deductions_ui_selection;
    if (s === 'choose' || s === 'no') {
      next.income_tax_deductions_enabled = false;
      next.income_tax_deductions_file_number = null;
      next.income_tax_deductions_frequency = null;
    } else if (s === 'yes') {
      next.income_tax_deductions_enabled = true;
    }
  }
  if (body.income_tax_deductions_enabled !== undefined && body.income_tax_deductions_ui_selection === undefined) {
    pick('income_tax_deductions_enabled', Boolean(body.income_tax_deductions_enabled));
  }
  if (body.income_tax_deductions_file_number !== undefined) {
    pick('income_tax_deductions_file_number', body.income_tax_deductions_file_number?.trim() ?? null);
  }
  if (body.income_tax_deductions_frequency !== undefined) {
    if (body.income_tax_deductions_frequency != null && !ALLOW.freq.has(body.income_tax_deductions_frequency)) {
      throw badRequest('Invalid income_tax_deductions_frequency');
    }
    pick('income_tax_deductions_frequency', body.income_tax_deductions_frequency ?? null);
  }
  if (body.national_insurance_type !== undefined) {
    if (body.national_insurance_type != null && !ALLOW.ni.has(body.national_insurance_type)) throw badRequest('Invalid national_insurance_type');
    pick('national_insurance_type', body.national_insurance_type ?? null);
  }
  if (body.national_insurance_monthly_amount !== undefined) {
    pick('national_insurance_monthly_amount', body.national_insurance_monthly_amount);
  }
  if (body.vat_payment_method !== undefined) {
    if (body.vat_payment_method != null && !ALLOW.pay.has(body.vat_payment_method)) throw badRequest('Invalid vat_payment_method');
    pick('vat_payment_method', body.vat_payment_method ?? null);
    if (next.vat_payment_method === 'credit') {
      next.vat_other_payment_text = null;
    } else if (next.vat_payment_method) {
      next.vat_payment_details_encrypted = null;
      next.vat_card_last4 = null;
      next.vat_card_expiry_masked = null;
      next.vat_card_brand = null;
      next.vat_card_holder_name = null;
      next.vat_other_payment_text = next.vat_payment_method === 'other' ? next.vat_other_payment_text : null;
    }
  }
  if (body.income_tax_payment_method !== undefined) {
    if (body.income_tax_payment_method != null && !ALLOW.pay.has(body.income_tax_payment_method)) {
      throw badRequest('Invalid income_tax_payment_method');
    }
    pick('income_tax_payment_method', body.income_tax_payment_method ?? null);
    if (next.income_tax_payment_method === 'credit') {
      next.income_tax_other_payment_text = null;
    } else if (next.income_tax_payment_method) {
      next.income_tax_payment_details_encrypted = null;
      next.income_tax_card_last4 = null;
      next.income_tax_card_expiry_masked = null;
      next.income_tax_card_brand = null;
      next.income_tax_card_holder_name = null;
      next.income_tax_other_payment_text =
        next.income_tax_payment_method === 'other' ? next.income_tax_other_payment_text : null;
    }
  }
  if (body.vat_other_payment_text !== undefined) pick('vat_other_payment_text', body.vat_other_payment_text?.trim() ?? null);
  if (body.income_tax_other_payment_text !== undefined) {
    pick('income_tax_other_payment_text', body.income_tax_other_payment_text?.trim() ?? null);
  }
  if (body.notes !== undefined) pick('notes', body.notes?.trim() ?? null);

  const { business_type: businessType } = await getClientOperationalProfileSlice(orgId, clientId);
  if (businessType === OSEK_PATUR_BUSINESS_TYPE) {
    next.vat_type = 'patur';
    next.vat_frequency = 'not_relevant';
    next.vat_due_type = 'not_relevant';
  }

  // Auto: NI deductions file = income tax deductions file + "00" (backend only)
  next.national_insurance_deductions_file_number = computeNiDeductionsAuto(
    next.income_tax_deductions_enabled,
    next.income_tax_deductions_file_number
  );

  if (body.vat_credit_card || body.income_tax_credit_card) {
    assertClientDataEncryptionConfigured();
  }

  if (body.vat_card_holder_name !== undefined) {
    pick('vat_card_holder_name', body.vat_card_holder_name?.trim() ?? null);
  }
  if (body.income_tax_card_holder_name !== undefined) {
    pick('income_tax_card_holder_name', body.income_tax_card_holder_name?.trim() ?? null);
  }

  // VAT credit card (CVV never persisted)
  const vatMethod = next.vat_payment_method;
  if (vatMethod === 'credit' && body.vat_credit_card) {
    const c = body.vat_credit_card;
    if (!c.card_number?.trim() || !c.expiry?.trim()) {
      throw badRequest('נדרשים מספר כרטיס ותוקף');
    }
    const payload: CardPaymentPayload = {
      card_number: c.card_number.trim(),
      expiry: c.expiry.trim(),
    };
    next.vat_payment_details_encrypted = encryptJson(payload as unknown as Record<string, unknown>);
    next.vat_card_last4 = cardLast4(payload.card_number);
    next.vat_card_expiry_masked = payload.expiry;
    next.vat_card_brand = inferCardBrand(payload.card_number);
    if (c.card_holder_name !== undefined) {
      next.vat_card_holder_name = c.card_holder_name?.trim() ?? null;
    }
  } else if (vatMethod && vatMethod !== 'credit') {
    if (body.vat_credit_card) throw badRequest('vat_credit_card only when vat_payment_method is credit');
  }

  // Income tax credit card
  const itMethod = next.income_tax_payment_method;
  if (itMethod === 'credit' && body.income_tax_credit_card) {
    const c = body.income_tax_credit_card;
    if (!c.card_number?.trim() || !c.expiry?.trim()) {
      throw badRequest('נדרשים מספר כרטיס ותוקף');
    }
    const payload: CardPaymentPayload = {
      card_number: c.card_number.trim(),
      expiry: c.expiry.trim(),
    };
    next.income_tax_payment_details_encrypted = encryptJson(payload as unknown as Record<string, unknown>);
    next.income_tax_card_last4 = cardLast4(payload.card_number);
    next.income_tax_card_expiry_masked = payload.expiry;
    next.income_tax_card_brand = inferCardBrand(payload.card_number);
    if (c.card_holder_name !== undefined) {
      next.income_tax_card_holder_name = c.card_holder_name?.trim() ?? null;
    }
  } else if (itMethod && itMethod !== 'credit') {
    if (body.income_tax_credit_card) throw badRequest('income_tax_credit_card only when income_tax_payment_method is credit');
  }

  // Validation rules
  if (next.income_tax_advance_enabled) {
    if (next.income_tax_advance_percent == null || Number.isNaN(Number(next.income_tax_advance_percent))) {
      throw badRequest('מקדמות מס הכנסה: percent required');
    }
    if (!next.income_tax_advance_frequency) throw badRequest('מקדמות מס הכנסה: frequency required');
  }
  if (next.income_tax_deductions_enabled) {
    if (!(next.income_tax_deductions_file_number ?? '').trim()) throw badRequest('תיק ניכויים required');
    if (!next.income_tax_deductions_frequency) throw badRequest('מס הכנסה ניכויים: frequency required');
  }
  if (next.national_insurance_type === 'yes') {
    if (next.national_insurance_monthly_amount == null || Number.isNaN(Number(next.national_insurance_monthly_amount))) {
      throw badRequest('ביטוח לאומי: monthly amount required');
    }
  }
  if (next.vat_payment_method === 'credit' && !next.vat_payment_details_encrypted && !body.vat_credit_card) {
    throw badRequest('פרטי אשראי למע״מ required');
  }
  if (next.income_tax_payment_method === 'credit' && !next.income_tax_payment_details_encrypted && !body.income_tax_credit_card) {
    throw badRequest('פרטי אשראי למס הכנסה required');
  }
  if (next.vat_payment_method === 'other' && !(next.vat_other_payment_text ?? '').trim()) {
    throw badRequest('תיאור תשלום מע״מ required');
  }
  if (next.income_tax_payment_method === 'other' && !(next.income_tax_other_payment_text ?? '').trim()) {
    throw badRequest('תיאור תשלום מס הכנסה required');
  }

  const upsertPayload = {
    organization_id: orgId,
    client_id: clientId,
    vat_type: next.vat_type,
    vat_frequency: next.vat_frequency,
    vat_due_type: next.vat_due_type,
    income_tax_advance_enabled: next.income_tax_advance_enabled,
    income_tax_advance_percent: next.income_tax_advance_percent,
    income_tax_advance_frequency: next.income_tax_advance_frequency,
    income_tax_deductions_enabled: next.income_tax_deductions_enabled,
    income_tax_deductions_file_number: next.income_tax_deductions_file_number,
    income_tax_deductions_frequency: next.income_tax_deductions_frequency,
    national_insurance_type: next.national_insurance_type,
    national_insurance_monthly_amount: next.national_insurance_monthly_amount,
    national_insurance_deductions_file_number: next.national_insurance_deductions_file_number,
    vat_payment_method: next.vat_payment_method,
    vat_payment_details_encrypted: next.vat_payment_details_encrypted,
    vat_other_payment_text: next.vat_other_payment_text,
    vat_card_last4: next.vat_card_last4,
    vat_card_expiry_masked: next.vat_card_expiry_masked,
    vat_card_brand: next.vat_card_brand ?? null,
    vat_card_holder_name: next.vat_card_holder_name,
    income_tax_payment_method: next.income_tax_payment_method,
    income_tax_payment_details_encrypted: next.income_tax_payment_details_encrypted,
    income_tax_other_payment_text: next.income_tax_other_payment_text,
    income_tax_card_last4: next.income_tax_card_last4,
    income_tax_card_expiry_masked: next.income_tax_card_expiry_masked,
    income_tax_card_brand: next.income_tax_card_brand ?? null,
    income_tax_card_holder_name: next.income_tax_card_holder_name,
    notes: next.notes,
    updated_at: new Date().toISOString(),
  };

  const { data: saved, error } = await supabaseAdmin
    .from('client_tax_settings')
    .upsert(upsertPayload, { onConflict: 'organization_id,client_id' })
    .select('*')
    .single();

  if (error || !saved) {
    const em = error?.message ?? '';
    if (
      em.includes('income_tax_deductions_frequency') ||
      em.includes('schema cache') ||
      /column .* does not exist/i.test(em)
    ) {
      throw badRequest(
        'חסרה עמודת income_tax_deductions_frequency בבסיס הנתונים. הרץ את המיגרציה 036_income_tax_deductions_frequency.sql (או supabase db push) ואז נסה שוב.'
      );
    }
    throw new AppError(500, em || 'Failed to save tax settings', 'TAX_SETTINGS_SAVE_FAILED');
  }

  const savedRow = saved as ClientTaxSettingsRow;

  await syncIncomeTaxAdvanceStatusToProfile(orgId, clientId, savedRow, body.income_tax_advance_ui_selection);
  await syncIncomeTaxDeductionsStatusToProfile(orgId, clientId, savedRow, body.income_tax_deductions_ui_selection);
  await syncNationalInsuranceDeductionsStatusToProfile(
    orgId,
    clientId,
    savedRow,
    body.income_tax_deductions_ui_selection
  );
  await syncVatStatusToProfile(orgId, clientId, savedRow, businessType);
  await syncNationalInsuranceStatusToProfile(orgId, clientId, savedRow);

  // Field-level event log (diff vs previous row if existed)
  if (prev.data) {
    const oldR = prev.data as ClientTaxSettingsRow;
    const fields: (keyof ClientTaxSettingsRow)[] = [
      'vat_type',
      'vat_frequency',
      'vat_due_type',
      'income_tax_advance_enabled',
      'income_tax_advance_percent',
      'income_tax_advance_frequency',
      'income_tax_deductions_enabled',
      'income_tax_deductions_file_number',
      'income_tax_deductions_frequency',
      'national_insurance_type',
      'national_insurance_monthly_amount',
      'national_insurance_deductions_file_number',
      'vat_payment_method',
      'income_tax_payment_method',
      'vat_other_payment_text',
      'income_tax_other_payment_text',
      'notes',
    ];
    for (const f of fields) {
      const o = oldR[f];
      const n = savedRow[f];
      const os = o == null ? '' : String(o);
      const ns = n == null ? '' : String(n);
      if (os !== ns) {
        await insertEventLog({
          organizationId: orgId,
          clientId,
          userId,
          field: String(f),
          oldValue: f.includes('encrypted') ? '***' : os,
          newValue: f.includes('encrypted') ? '***' : ns,
        });
      }
    }
    if (oldR.vat_payment_details_encrypted !== savedRow.vat_payment_details_encrypted) {
      await insertEventLog({
        organizationId: orgId,
        clientId,
        userId,
        field: 'vat_payment_details_encrypted',
        oldValue: '***',
        newValue: '***',
      });
    }
    if (oldR.income_tax_payment_details_encrypted !== savedRow.income_tax_payment_details_encrypted) {
      await insertEventLog({
        organizationId: orgId,
        clientId,
        userId,
        field: 'income_tax_payment_details_encrypted',
        oldValue: '***',
        newValue: '***',
      });
    }
  } else {
    await insertEventLog({
      organizationId: orgId,
      clientId,
      userId,
      field: '_created',
      oldValue: null,
      newValue: 'client_tax_settings',
    });
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: userId,
    moduleCode: 'client-operations',
    entityType: 'client_tax_settings',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_TAX_SETTINGS_UPDATED,
    payload: { client_id: clientId },
  });

  return getClientTaxSettings(ctx, clientId);
}

