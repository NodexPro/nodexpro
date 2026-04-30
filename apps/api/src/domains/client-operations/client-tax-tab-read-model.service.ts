/**
 * Tax tab workspace aggregate — display + per-section form `edit_model` + command baseline.
 * UI reads only `tax_tab` (including `baseline.settings` mirror for drafts); case may still ship `tax_settings` for other consumers.
 */
import type { TaxTabCommandType } from './client-tax-commands.service.js';
import type {
  ClientTaxSettingsPublic,
  ClientTaxSettingsResponse,
  ClientTaxUiHints,
} from './client-tax-settings.service.js';

export const TAX_TAB_READ_MODEL_VERSION = 4;

export type TaxTabDisplayTone = 'default' | 'muted' | 'warning' | 'not_relevant';

export type TaxTabDisplayRow = {
  row_key: string;
  label_he: string;
  value_he: string;
  tone?: TaxTabDisplayTone;
};

/** Edit button + command routing (affordance only). */
export type TaxTabSectionEditAffordance = {
  command: TaxTabCommandType;
  /** Whether the workspace should show an edit affordance for this section. */
  enabled: boolean;
  button_label_he: string;
};

export type TaxTabEditFieldKind =
  | 'enum'
  | 'tri_state'
  | 'text'
  | 'textarea'
  | 'number'
  | 'payment_method_select';

export type TaxTabEditFieldOption = { value: string; label_he: string };

export type TaxTabEditFieldDef = {
  field_key: string;
  label_he: string;
  kind: TaxTabEditFieldKind;
  disabled: boolean;
  readonly: boolean;
  /** When true, control is omitted in favour of `extras` / static copy. */
  hidden: boolean;
  hint_he: string | null;
  validation_hint_he: string | null;
  options?: TaxTabEditFieldOption[];
};

/** Server-driven modal form: metadata + current values for the section. */
export type TaxTabSectionFormEditModel = {
  fields: TaxTabEditFieldDef[];
  values: Record<string, string | number | boolean | null>;
  /** Optional display strings (e.g. עוסק פטור substitute line). */
  extras?: Record<string, string | null>;
};

export type TaxTabCommandBaseline = {
  /** Same shape as `tax_settings.settings` on the case — for modal drafts / cancel without reading `tax_settings` in UI. */
  settings: ClientTaxSettingsPublic;
};

export type TaxTabSectionKey =
  | 'vat_registration'
  | 'income_tax_advances'
  | 'income_tax_deductions'
  | 'national_insurance'
  | 'vat_payment'
  | 'income_tax_payment'
  | 'notes';

/** Main tax tab payment summary — copy/reveal affordances are server-driven (no raw `tax_settings` reads on the main UI). */
export type TaxTabPaymentInteractionKind = 'plain_clipboard' | 'secure_reveal_clipboard';

export type TaxTabPaymentSecureRef = {
  payment_channel: 'vat' | 'income_tax';
  secret_kind: 'card_number' | 'expiry';
};

export type TaxTabPaymentRowSecureState = {
  /** Aggregate cannot observe in-flight client requests — always false until a future session bridge exists. */
  in_flight: boolean;
  disabled: boolean;
  disabled_reason_he: string | null;
};

export type TaxTabPaymentPanelCopyControl = {
  show: boolean;
  aria_label_he: string;
  /** Plain rows only — secure rows use `secure_state`. */
  disabled?: boolean;
  disabled_reason_he?: string | null;
};

export type TaxTabPaymentPanelRow = {
  row_key: string;
  label_he: string;
  value_display_he: string;
  card_brand: string | null;
  value_cell_layout: 'default' | 'card_with_brand';
  interaction: TaxTabPaymentInteractionKind;
  clipboard_plain_text: string | null;
  secure: TaxTabPaymentSecureRef | null;
  copy_control: TaxTabPaymentPanelCopyControl;
  /** Present for `secure_reveal_clipboard` rows; `null` for plain copy. */
  secure_state: TaxTabPaymentRowSecureState | null;
};

export type TaxTabPaymentPanelModel = {
  visible: boolean;
  payment_channel: 'vat' | 'income_tax';
  secure_session: { active: boolean; expires_at: string | null };
  cvv_footer_he: string;
  card_expired_warning: boolean;
  rows: TaxTabPaymentPanelRow[];
};

export type TaxTabSectionReadModel = {
  section_key: TaxTabSectionKey;
  title_he: string;
  visible: boolean;
  display_rows: TaxTabDisplayRow[];
  edit: TaxTabSectionEditAffordance;
  edit_model: TaxTabSectionFormEditModel;
  payment_panel?: TaxTabPaymentPanelModel | null;
};

export type TaxTabHeaderReadModel = {
  title_he: string;
  client_tax_id: string | null;
  client_display_name: string | null;
  summary_rows: TaxTabDisplayRow[];
};

export type TaxTabWorkspaceResponse = {
  read_model_version: number;
  /** Server-driven modal flags (same as `tax_settings.ui` on the case). */
  ui: ClientTaxUiHints;
  /** Full settings snapshot for command payloads / modal drafts without reading `tax_settings` in the web UI. */
  baseline: TaxTabCommandBaseline;
  header: TaxTabHeaderReadModel;
  sections: TaxTabSectionReadModel[];
};

function dash(v: string | null | undefined): string {
  const t = (v ?? '').trim();
  return t ? t : '—';
}

function heVatType(v: string | null): string {
  switch (v) {
    case 'yes':
      return 'כן';
    case 'no':
      return 'לא';
    case 'patur':
      return 'פטור';
    default:
      return '—';
  }
}

function heVatFrequency(v: string | null, frequencyDisabled: boolean): string {
  if (frequencyDisabled && !v) return '—';
  switch (v) {
    case 'monthly':
      return 'חודשי';
    case 'bi_monthly':
      return 'דו-חודשי';
    case 'not_relevant':
      return 'לא רלוונטי';
    default:
      return '—';
  }
}

function heVatDueType(v: string | null): string {
  switch (v) {
    case 'pcn':
      return 'PCN';
    case 'regular':
      return 'רגיל';
    case 'not_relevant':
      return 'לא רלוונטי';
    default:
      return '—';
  }
}

function heTriState(v: 'choose' | 'yes' | 'no'): string {
  switch (v) {
    case 'yes':
      return 'כן';
    case 'no':
      return 'לא';
    case 'choose':
      return 'בחר';
    default:
      return '—';
  }
}

function heReportFreq(v: string | null): string {
  switch (v) {
    case 'monthly':
      return 'חד חודשי';
    case 'bi_monthly':
      return 'דו חודשי';
    case 'semi_annual':
      return 'חצי שנתי';
    default:
      return '—';
  }
}

function hePaymentMethod(v: string | null): string {
  switch (v) {
    case 'credit':
      return 'אשראי';
    case 'bank_order':
      return 'הוראת קבע';
    case 'voucher':
      return 'שובר';
    case 'other':
      return 'אחר';
    default:
      return '—';
  }
}

function heNiType(v: string | null): string {
  switch (v) {
    case 'yes':
      return 'כן';
    case 'not_applicable':
      return 'לא עונה להגדרות';
    default:
      return '—';
  }
}

function cardMaskedLine(m: ClientTaxSettingsPublic['vat_payment_masked']): string {
  const masked = m.card_number_masked?.trim();
  if (masked) return masked;
  const last = m.last4 ? String(m.last4).replace(/\D/g, '').slice(-4) : '';
  return last ? `**** **** **** ${last}` : '—';
}

/** Same rules as `apps/web/src/utils/card-expiry.ts` — expiry warning is part of the aggregate, not client business logic. */
function isMaskedExpiryDisplayInPast(expiryRaw: string | null | undefined): boolean {
  const s = String(expiryRaw ?? '').trim();
  if (!s) return false;
  const m = s.match(/^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/);
  if (!m) return false;
  let mm = parseInt(m[1], 10);
  let yy = parseInt(m[2], 10);
  if (!Number.isFinite(mm) || !Number.isFinite(yy)) return false;
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12) return false;
  const lastDay = new Date(yy, mm, 0, 23, 59, 59, 999);
  return Date.now() > lastDay.getTime();
}

const PAYMENT_METHOD_OPTIONS: TaxTabEditFieldOption[] = [
  { value: 'credit', label_he: 'אשראי' },
  { value: 'bank_order', label_he: 'הוראת קבע' },
  { value: 'voucher', label_he: 'שובר' },
  { value: 'other', label_he: 'אחר' },
];

function buildVatRegistrationEditModel(
  s: ClientTaxSettingsPublic,
  ui: ClientTaxUiHints
): TaxTabSectionFormEditModel {
  const osek = ui.osek_patur_vat_due;
  return {
    fields: [
      {
        field_key: 'vat_type',
        label_he: 'מע״מ',
        kind: 'enum',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
        options: [
          { value: 'yes', label_he: 'כן' },
          { value: 'no', label_he: 'לא' },
          { value: 'patur', label_he: 'פטור' },
        ],
      },
      {
        field_key: 'vat_frequency',
        label_he: 'תדירות מע״מ',
        kind: 'enum',
        disabled: Boolean(ui.vat_frequency_disabled),
        readonly: false,
        hidden: false,
        hint_he: ui.vat_frequency_disabled ? 'נקבע לפי הגדרות סוג העסק' : null,
        validation_hint_he: null,
        options: [
          { value: 'monthly', label_he: 'חודשי' },
          { value: 'bi_monthly', label_he: 'דו-חודשי' },
          { value: 'not_relevant', label_he: 'לא רלוונטי' },
        ],
      },
      {
        field_key: 'vat_due_type',
        label_he: 'יום יעד למע״מ',
        kind: 'enum',
        disabled: false,
        readonly: false,
        hidden: Boolean(osek),
        hint_he: null,
        validation_hint_he: null,
        options: [
          { value: 'pcn', label_he: 'PCN' },
          { value: 'regular', label_he: 'רגיל' },
          { value: 'not_relevant', label_he: 'לא רלוונטי' },
        ],
      },
    ],
    values: {
      vat_type: s.vat_type,
      vat_frequency: s.vat_frequency,
      vat_due_type: s.vat_due_type,
    },
    extras: {
      osek_patur_vat_line_he: osek?.date_display_he ?? null,
      osek_patur_vat_label_he: osek?.label_he ?? null,
    },
  };
}

function buildIncomeTaxAdvancesEditModel(s: ClientTaxSettingsPublic): TaxTabSectionFormEditModel {
  const uiSel =
    s.income_tax_advance_ui_selection ?? (s.income_tax_advance_enabled ? 'yes' : 'choose');
  return {
    fields: [
      {
        field_key: 'income_tax_advance_ui_selection',
        label_he: 'מקדמות',
        kind: 'tri_state',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
        options: [
          { value: 'choose', label_he: 'בחר' },
          { value: 'yes', label_he: 'כן' },
          { value: 'no', label_he: 'לא' },
        ],
      },
      {
        field_key: 'income_tax_advance_percent',
        label_he: 'אחוז',
        kind: 'number',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: 'יש להזין את האחוז שנקבע על ידי מס הכנסה',
        validation_hint_he: null,
      },
      {
        field_key: 'income_tax_advance_frequency',
        label_he: 'תדירות דיווח',
        kind: 'enum',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
        options: [
          { value: 'monthly', label_he: 'חד חודשי' },
          { value: 'bi_monthly', label_he: 'דו חודשי' },
        ],
      },
    ],
    values: {
      income_tax_advance_ui_selection: uiSel,
      income_tax_advance_enabled: s.income_tax_advance_enabled,
      income_tax_advance_percent: s.income_tax_advance_percent,
      income_tax_advance_frequency: s.income_tax_advance_frequency,
    },
  };
}

function buildIncomeTaxDeductionsEditModel(s: ClientTaxSettingsPublic): TaxTabSectionFormEditModel {
  const uiSel =
    s.income_tax_deductions_ui_selection ?? (s.income_tax_deductions_enabled ? 'yes' : 'choose');
  return {
    fields: [
      {
        field_key: 'income_tax_deductions_ui_selection',
        label_he: 'מס הכנסה ניכויים',
        kind: 'tri_state',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
        options: [
          { value: 'choose', label_he: 'בחר' },
          { value: 'yes', label_he: 'כן' },
          { value: 'no', label_he: 'לא' },
        ],
      },
      {
        field_key: 'income_tax_deductions_file_number',
        label_he: 'תיק ניכויים',
        kind: 'text',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
      },
      {
        field_key: 'income_tax_deductions_frequency',
        label_he: 'תדירות דיווח',
        kind: 'enum',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
        options: [
          { value: 'monthly', label_he: 'חד חודשי' },
          { value: 'bi_monthly', label_he: 'דו חודשי' },
          { value: 'semi_annual', label_he: 'חצי שנתי' },
        ],
      },
    ],
    values: {
      income_tax_deductions_ui_selection: uiSel,
      income_tax_deductions_enabled: s.income_tax_deductions_enabled,
      income_tax_deductions_file_number: s.income_tax_deductions_file_number,
      income_tax_deductions_frequency: s.income_tax_deductions_frequency,
    },
  };
}

function buildNationalInsuranceEditModel(s: ClientTaxSettingsPublic): TaxTabSectionFormEditModel {
  const showMonthly = s.national_insurance_type === 'yes';
  return {
    fields: [
      {
        field_key: 'national_insurance_type',
        label_he: 'ביטוח לאומי עצמאי',
        kind: 'enum',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
        options: [
          { value: 'yes', label_he: 'כן' },
          { value: 'not_applicable', label_he: 'לא עונה להגדרות' },
        ],
      },
      {
        field_key: 'national_insurance_monthly_amount',
        label_he: 'סכום חודשי',
        kind: 'number',
        disabled: false,
        readonly: false,
        hidden: !showMonthly,
        hint_he: 'יש להזין את הסכום החודשי',
        validation_hint_he: null,
      },
    ],
    values: {
      national_insurance_type: s.national_insurance_type,
      national_insurance_monthly_amount: s.national_insurance_monthly_amount,
    },
  };
}

function buildVatPaymentEditModel(s: ClientTaxSettingsPublic): TaxTabSectionFormEditModel {
  return {
    fields: [
      {
        field_key: 'vat_payment_method',
        label_he: 'שיטת תשלום',
        kind: 'payment_method_select',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: 'לאשראי: אחרי בחירה ייפתח חלון להזנת כרטיס (אם נדרש).',
        validation_hint_he: null,
        options: PAYMENT_METHOD_OPTIONS,
      },
      {
        field_key: 'vat_other_payment_text',
        label_he: 'תיאור תשלום',
        kind: 'textarea',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
      },
    ],
    values: {
      vat_payment_method: s.vat_payment_method,
      vat_other_payment_text: s.vat_other_payment_text,
    },
  };
}

function buildIncomeTaxPaymentEditModel(s: ClientTaxSettingsPublic): TaxTabSectionFormEditModel {
  return {
    fields: [
      {
        field_key: 'income_tax_payment_method',
        label_he: 'שיטת תשלום',
        kind: 'payment_method_select',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
        options: PAYMENT_METHOD_OPTIONS,
      },
      {
        field_key: 'income_tax_other_payment_text',
        label_he: 'תיאור תשלום',
        kind: 'textarea',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
      },
    ],
    values: {
      income_tax_payment_method: s.income_tax_payment_method,
      income_tax_other_payment_text: s.income_tax_other_payment_text,
    },
  };
}

function buildNotesEditModel(s: ClientTaxSettingsPublic): TaxTabSectionFormEditModel {
  return {
    fields: [
      {
        field_key: 'notes',
        label_he: 'הערות',
        kind: 'textarea',
        disabled: false,
        readonly: false,
        hidden: false,
        hint_he: null,
        validation_hint_he: null,
      },
    ],
    values: { notes: s.notes },
  };
}

function buildCreditPaymentPanel(
  s: ClientTaxSettingsPublic,
  channel: 'vat' | 'income_tax'
): TaxTabPaymentPanelModel | null {
  const method = channel === 'vat' ? s.vat_payment_method : s.income_tax_payment_method;
  const masked = channel === 'vat' ? s.vat_payment_masked : s.income_tax_payment_masked;
  const holderName = channel === 'vat' ? s.vat_card_holder_name : s.income_tax_card_holder_name;
  const sess =
    channel === 'vat' ? s.payment_secure_sessions.vat : s.payment_secure_sessions.income_tax;

  if (method !== 'credit' || !masked.last4) return null;

  const holderTrim = (holderName ?? '').trim();
  const taxIdTrim = (s.client_tax_id ?? '').trim();
  const dedTrim = (s.income_tax_deductions_file_number ?? '').trim();
  const expiryTrim = (masked.expiry ?? '').trim();

  const rows: TaxTabPaymentPanelRow[] = [
    {
      row_key: `${channel}_card_holder`,
      label_he: 'בעל הכרטיס',
      value_display_he: dash(holderName),
      card_brand: null,
      value_cell_layout: 'default',
      interaction: 'plain_clipboard',
      clipboard_plain_text: holderTrim ? holderName : null,
      secure: null,
      copy_control: {
        show: true,
        disabled: !holderTrim,
        disabled_reason_he: !holderTrim ? 'אין ערך להעתקה' : null,
        aria_label_he: 'העתקת שם בעל הכרטיס',
      },
      secure_state: null,
    },
    {
      row_key: `${channel}_client_tax_id`,
      label_he: 'ח.פ / ת.ז',
      value_display_he: dash(s.client_tax_id),
      card_brand: null,
      value_cell_layout: 'default',
      interaction: 'plain_clipboard',
      clipboard_plain_text: taxIdTrim ? s.client_tax_id : null,
      secure: null,
      copy_control: {
        show: true,
        disabled: !taxIdTrim,
        disabled_reason_he: !taxIdTrim ? 'אין ערך להעתקה' : null,
        aria_label_he: 'העתקת ח.פ / ת.ז',
      },
      secure_state: null,
    },
    {
      row_key: `${channel}_deductions_file`,
      label_he: 'תיק ניכויים',
      value_display_he: dash(s.income_tax_deductions_file_number),
      card_brand: null,
      value_cell_layout: 'default',
      interaction: 'plain_clipboard',
      clipboard_plain_text: dedTrim ? s.income_tax_deductions_file_number : null,
      secure: null,
      copy_control: {
        show: true,
        disabled: !dedTrim,
        disabled_reason_he: !dedTrim ? 'אין ערך להעתקה' : null,
        aria_label_he: 'העתקת מספר תיק ניכויים',
      },
      secure_state: null,
    },
    {
      row_key: `${channel}_card_pan`,
      label_he: 'כרטיס אשראי',
      value_display_he: cardMaskedLine(masked),
      card_brand: masked.brand ?? null,
      value_cell_layout: 'card_with_brand',
      interaction: 'secure_reveal_clipboard',
      clipboard_plain_text: null,
      secure: { payment_channel: channel, secret_kind: 'card_number' },
      copy_control: {
        show: true,
        aria_label_he: 'העתקת מספר כרטיס מאובטחת',
      },
      secure_state: {
        in_flight: false,
        disabled: false,
        disabled_reason_he: null,
      },
    },
    {
      row_key: `${channel}_card_expiry`,
      label_he: 'תוקף',
      value_display_he: dash(masked.expiry),
      card_brand: null,
      value_cell_layout: 'default',
      interaction: 'secure_reveal_clipboard',
      clipboard_plain_text: null,
      secure: { payment_channel: channel, secret_kind: 'expiry' },
      copy_control: {
        show: true,
        aria_label_he: 'העתקת תוקף מאובטחת',
      },
      secure_state: {
        in_flight: false,
        disabled: !expiryTrim,
        disabled_reason_he: !expiryTrim ? 'אין תוקף מוצג' : null,
      },
    },
  ];

  return {
    visible: true,
    payment_channel: channel,
    secure_session: { active: sess.active, expires_at: sess.expires_at },
    cvv_footer_he: 'קוד CVV אינו נשמר במערכת ויש לבקשו מהלקוח בעת התשלום',
    card_expired_warning: isMaskedExpiryDisplayInPast(masked.expiry),
    rows,
  };
}

export function buildTaxTabWorkspaceReadModel(bundle: ClientTaxSettingsResponse): TaxTabWorkspaceResponse {
  const s = bundle.settings;
  const ui = bundle.ui;

  const header: TaxTabHeaderReadModel = {
    title_he: 'מיסים',
    client_tax_id: s.client_tax_id,
    client_display_name: s.client_display_name,
    summary_rows: [
      {
        row_key: 'client_tax_id',
        label_he: 'ח.פ / ת.ז',
        value_he: dash(s.client_tax_id),
      },
      {
        row_key: 'client_display_name',
        label_he: 'שם לקוח',
        value_he: dash(s.client_display_name),
      },
      {
        row_key: 'vat_divuach_next',
        label_he: 'יעד דיווח מע״מ',
        value_he: dash(s.vat_divuach_next_due_display_he),
      },
      {
        row_key: 'vat_registry',
        label_he: 'רישום יעד מע״מ',
        value_he: dash(s.vat_due_registry_display_he),
      },
    ],
  };

  const vatRows: TaxTabDisplayRow[] = [
    { row_key: 'vat_type', label_he: 'מע״מ', value_he: heVatType(s.vat_type) },
    {
      row_key: 'vat_frequency',
      label_he: 'תדירות מע״מ',
      value_he: heVatFrequency(s.vat_frequency, ui.vat_frequency_disabled),
      tone: ui.vat_frequency_disabled ? 'muted' : undefined,
    },
  ];

  if (ui.osek_patur_vat_due) {
    vatRows.push({
      row_key: 'osek_patur_vat_due',
      label_he: ui.osek_patur_vat_due.label_he,
      value_he: ui.osek_patur_vat_due.date_display_he,
    });
  } else {
    vatRows.push({
      row_key: 'vat_due_type',
      label_he: 'יום יעד למע״מ',
      value_he: heVatDueType(s.vat_due_type),
      tone: s.vat_due_type === 'not_relevant' ? 'not_relevant' : undefined,
    });
  }

  const advanceRows: TaxTabDisplayRow[] = [
    {
      row_key: 'advance_selection',
      label_he: 'מקדמות מס הכנסה',
      value_he: heTriState(s.income_tax_advance_ui_selection),
    },
  ];
  if (s.income_tax_advance_enabled) {
    advanceRows.push(
      {
        row_key: 'advance_percent',
        label_he: 'אחוז',
        value_he: s.income_tax_advance_percent != null ? String(s.income_tax_advance_percent) : '—',
      },
      {
        row_key: 'advance_frequency',
        label_he: 'תדירות דיווח',
        value_he: heReportFreq(s.income_tax_advance_frequency),
      }
    );
  }

  const dedRows: TaxTabDisplayRow[] = [
    {
      row_key: 'ded_selection',
      label_he: 'מס הכנסה ניכויים',
      value_he: heTriState(s.income_tax_deductions_ui_selection),
    },
  ];
  if (s.income_tax_deductions_enabled) {
    dedRows.push(
      {
        row_key: 'ded_file',
        label_he: 'תיק ניכויים',
        value_he: dash(s.income_tax_deductions_file_number),
      },
      {
        row_key: 'ded_frequency',
        label_he: 'תדירות דיווח',
        value_he: heReportFreq(s.income_tax_deductions_frequency),
      }
    );
  }

  const niRows: TaxTabDisplayRow[] = [
    {
      row_key: 'ni_type',
      label_he: 'ביטוח לאומי עצמאי',
      value_he: heNiType(s.national_insurance_type),
    },
  ];
  if (s.national_insurance_type === 'yes') {
    niRows.push({
      row_key: 'ni_monthly',
      label_he: 'סכום חודשי',
      value_he: s.national_insurance_monthly_amount != null ? String(s.national_insurance_monthly_amount) : '—',
    });
  }
  niRows.push({
    row_key: 'ni_deductions_registry',
    label_he: ui.national_insurance_deductions_label_he,
    value_he: ui.national_insurance_deductions_disabled
      ? ui.national_insurance_deductions_inactive_display_he
      : dash(s.national_insurance_deductions_file_number),
    tone: ui.national_insurance_deductions_disabled ? 'not_relevant' : undefined,
  });

  const vatPayRows: TaxTabDisplayRow[] = [
    {
      row_key: 'vat_pay_method',
      label_he: 'איך משלם מע״מ',
      value_he: hePaymentMethod(s.vat_payment_method),
    },
  ];
  if (s.vat_payment_method === 'credit') {
    vatPayRows.push({
      row_key: 'vat_credit_hint',
      label_he: 'אשראי',
      value_he: 'מוגדר — פעולות העתקה מוצגות מתחת לכרטיס',
      tone: 'muted',
    });
  }
  if (s.vat_payment_method === 'other') {
    vatPayRows.push({
      row_key: 'vat_other_text',
      label_he: 'תיאור תשלום',
      value_he: dash(s.vat_other_payment_text),
    });
  }

  const itPayRows: TaxTabDisplayRow[] = [
    {
      row_key: 'it_pay_method',
      label_he: 'איך משלם מס הכנסה',
      value_he: hePaymentMethod(s.income_tax_payment_method),
    },
  ];
  if (s.income_tax_payment_method === 'credit') {
    itPayRows.push({
      row_key: 'it_credit_hint',
      label_he: 'אשראי',
      value_he: 'מוגדר — פעולות העתקה מוצגות מתחת לכרטיס',
      tone: 'muted',
    });
  }
  if (s.income_tax_payment_method === 'other') {
    itPayRows.push({
      row_key: 'it_other_text',
      label_he: 'תיאור תשלום',
      value_he: dash(s.income_tax_other_payment_text),
    });
  }

  const notesRows: TaxTabDisplayRow[] = [
    {
      row_key: 'notes',
      label_he: 'הערות',
      value_he: dash(s.notes),
      tone: (s.notes ?? '').trim() ? undefined : 'muted',
    },
  ];

  const editAlways: TaxTabSectionEditAffordance = {
    enabled: true,
    button_label_he: 'עריכה',
    command: 'update_tax_vat_registration',
  };

  const sections: TaxTabSectionReadModel[] = [
    {
      section_key: 'vat_registration',
      title_he: 'רישום מע״מ',
      visible: true,
      display_rows: vatRows,
      edit: { ...editAlways, command: 'update_tax_vat_registration' },
      edit_model: buildVatRegistrationEditModel(s, ui),
    },
    {
      section_key: 'income_tax_advances',
      title_he: 'מקדמות מס הכנסה',
      visible: true,
      display_rows: advanceRows,
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_income_advances' },
      edit_model: buildIncomeTaxAdvancesEditModel(s),
    },
    {
      section_key: 'income_tax_deductions',
      title_he: 'מס הכנסה ניכויים',
      visible: true,
      display_rows: dedRows,
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_income_deductions' },
      edit_model: buildIncomeTaxDeductionsEditModel(s),
    },
    {
      section_key: 'national_insurance',
      title_he: 'ביטוח לאומי',
      visible: true,
      display_rows: niRows,
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_national_insurance' },
      edit_model: buildNationalInsuranceEditModel(s),
    },
    {
      section_key: 'vat_payment',
      title_he: 'תשלום מע״מ',
      visible: true,
      display_rows: vatPayRows,
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_vat_payment' },
      edit_model: buildVatPaymentEditModel(s),
      payment_panel: buildCreditPaymentPanel(s, 'vat'),
    },
    {
      section_key: 'income_tax_payment',
      title_he: 'תשלום מס הכנסה',
      visible: true,
      display_rows: itPayRows,
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_income_tax_payment' },
      edit_model: buildIncomeTaxPaymentEditModel(s),
      payment_panel: buildCreditPaymentPanel(s, 'income_tax'),
    },
    {
      section_key: 'notes',
      title_he: 'הערות',
      visible: true,
      display_rows: notesRows,
      edit: { enabled: true, button_label_he: 'עריכה', command: 'update_tax_notes' },
      edit_model: buildNotesEditModel(s),
    },
  ];

  return {
    read_model_version: TAX_TAB_READ_MODEL_VERSION,
    ui,
    baseline: { settings: s },
    header,
    sections,
  };
}
