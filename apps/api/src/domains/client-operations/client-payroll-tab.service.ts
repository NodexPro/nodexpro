import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { syncNiDeductionsReportingFromPayrollProfile } from './client-obligations-tasks-core.service.js';

type PayrollCommandType =
  | 'update_payroll_status'
  | 'update_payroll_employer_details'
  | 'update_payroll_bank_details'
  | 'update_payroll_reporting'
  | 'update_payroll_process'
  | 'update_payroll_complexity'
  | 'update_payroll_employees';

export type PayrollTabCommandBody = {
  type: PayrollCommandType;
  /** Aggregate `read_model_version` at save time; stale value → 409 CONFLICT. */
  expected_version: number;
  payload?: Record<string, unknown>;
};

type PayrollFieldType = 'text' | 'number' | 'select' | 'radio' | 'textarea';

type PayrollFieldDto = {
  key: string;
  label_he: string;
  type: PayrollFieldType;
  value: unknown;
  options?: Array<{ value: string; label_he: string }>;
};

type PayrollSectionDto = {
  section_key: string;
  section_title_he: string;
  edit_action_key: PayrollCommandType | null;
  lines: Array<{ label_he: string; value_he: string }>;
  edit_fields: PayrollFieldDto[];
};

export type PayrollTabResponse = {
  tab_key: 'payroll';
  tab_title_he: string;
  /** Incremented on each successful payroll command write; client sends as `expected_version` on the next command. */
  read_model_version: number;
  permissions: { can_view: boolean; can_edit: boolean };
  status: { has_employees: boolean; has_employees_source: 'base' | 'override' };
  sections: PayrollSectionDto[];
};

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

function hasPerm(ctx: RequestContext, code: string): boolean {
  return (ctx.membership?.permissions ?? []).includes(code);
}

function canViewPayrollTab(ctx: RequestContext): boolean {
  return hasPerm(ctx, 'payroll_tab.view') || hasPerm(ctx, 'client_operations.view');
}

function canEditPayrollTab(ctx: RequestContext): boolean {
  return hasPerm(ctx, 'payroll_tab.edit') || hasPerm(ctx, 'client_operations.edit');
}

async function ensureClientInOrg(orgId: string, clientId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (!data) throw forbidden('Client not found');
}

/** Ensures a profile row exists so read model and commands always have a stable version (same idea as annual `ensureProfile`). */
async function ensurePayrollProfile(orgId: string, clientId: string): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from('client_payroll_profiles')
    .select('id')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (existing) return;
  const { error } = await supabaseAdmin.from('client_payroll_profiles').insert({
    organization_id: orgId,
    client_id: clientId,
  });
  if (error) throw new AppError(500, error.message ?? 'payroll profile insert failed', 'SUPABASE_ERROR');
}

function boolHe(v: boolean | null | undefined): string {
  if (v == null) return '—';
  return v ? 'כן' : 'לא';
}

function textHe(v: unknown): string {
  const s = v == null ? '' : String(v).trim();
  return s || '—';
}

function toNumberOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatNiWith00(baseIncomeDeductionsFile: string | null): string | null {
  const s = (baseIncomeDeductionsFile ?? '').trim();
  if (!s) return null;
  return s.endsWith('00') ? s : `${s}00`;
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const REPORTING_OPTIONS = [
  { value: 'monthly', label_he: 'חד חודשי' },
  { value: 'bi_monthly', label_he: 'דו חודשי' },
  { value: 'semi_annual', label_he: 'חצי שנתי' },
];

const PROCESS_TIMELINESS_OPTIONS = [
  { value: 'always', label_he: 'תמיד' },
  { value: 'usually', label_he: 'בדרך כלל' },
  { value: 'fixed_delay', label_he: 'באיחור קבוע' },
];

const COMPLEXITY_OPTIONS = [
  { value: 'low', label_he: 'נמוכה' },
  { value: 'medium', label_he: 'בינונית' },
  { value: 'high', label_he: 'גבוהה' },
];

const SPECIAL_ARRANGEMENTS_OPTIONS = [
  { value: 'foreign_workers', label_he: 'foreign workers' },
  { value: 'pension_edge_cases', label_he: 'pension edge cases' },
  { value: 'youth', label_he: 'youth' },
  { value: 'hourly_mix', label_he: 'hourly mix' },
  { value: 'commissions', label_he: 'commissions' },
];

function pickOverride(overrideValue: unknown, baseValue: unknown): string | null {
  const o = overrideValue == null ? '' : String(overrideValue).trim();
  if (o) return o;
  const b = baseValue == null ? '' : String(baseValue).trim();
  return b || null;
}

export async function getPayrollTabReadModel(ctx: RequestContext, clientId: string): Promise<PayrollTabResponse | null> {
  const orgId = assertOrg(ctx);
  if (!canViewPayrollTab(ctx)) return null;
  await ensureClientInOrg(orgId, clientId);
  await ensurePayrollProfile(orgId, clientId);

  const [{ data: client }, { data: tax }, { data: accountingSettings }, { data: payroll }] = await Promise.all([
    supabaseAdmin
      .from('clients')
      .select('display_name, created_at, city, address, postal_code, phone, email')
      .eq('organization_id', orgId)
      .eq('id', clientId)
      .maybeSingle(),
    supabaseAdmin
      .from('client_tax_settings')
      .select('income_tax_deductions_file_number')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .maybeSingle(),
    supabaseAdmin
      .from('client_accounting_settings')
      .select('occupation_field')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .maybeSingle(),
    supabaseAdmin
      .from('client_payroll_profiles')
      .select('*')
      .eq('organization_id', orgId)
      .eq('client_id', clientId)
      .maybeSingle(),
  ]);

  const c = asObj(client);
  const t = asObj(tax);
  const a = asObj(accountingSettings);
  const r = asObj(payroll);

  const baseIncomeTaxDeductions = pickOverride(t.income_tax_deductions_file_number, null);
  const baseNiDeductions = formatNiWith00(baseIncomeTaxDeductions);
  const baseHasEmployees = Boolean(baseIncomeTaxDeductions);
  const hasEmployeesOverride = r.has_employees;
  const hasEmployees = typeof hasEmployeesOverride === 'boolean' ? hasEmployeesOverride : baseHasEmployees;

  const foundedYear =
    c.created_at != null && String(c.created_at)
      ? new Date(String(c.created_at)).getUTCFullYear()
      : null;

  const employer = {
    company_name: pickOverride(r.employer_company_name_override, c.display_name),
    company_founded_year: toNumberOrNull(r.employer_company_founded_year_override) ?? foundedYear,
    city: pickOverride(r.employer_city_override, c.city),
    street: pickOverride(r.employer_street_override, c.address),
    postal_code: pickOverride(r.employer_postal_code_override, c.postal_code),
    phone: pickOverride(r.employer_phone_override, c.phone),
    email: pickOverride(r.employer_email_override, c.email),
    business_domain: pickOverride(a.occupation_field, null),
  };

  const canEdit = canEditPayrollTab(ctx);
  const readModelVersion = Number(r.read_model_version ?? 1);

  return {
    tab_key: 'payroll',
    tab_title_he: 'שכר',
    read_model_version: readModelVersion,
    permissions: { can_view: true, can_edit: canEdit },
    status: {
      has_employees: hasEmployees,
      has_employees_source: typeof hasEmployeesOverride === 'boolean' ? 'override' : 'base',
    },
    sections: [
      {
        section_key: 'status',
        section_title_he: 'סטטוס שכר',
        edit_action_key: 'update_payroll_status',
        lines: [{ label_he: 'יש עובדים', value_he: boolHe(hasEmployees) }],
        edit_fields: [
          {
            key: 'has_employees',
            label_he: 'יש עובדים',
            type: 'radio',
            value: hasEmployees ? 'yes' : 'no',
            options: [
              { value: 'yes', label_he: 'כן' },
              { value: 'no', label_he: 'לא' },
            ],
          },
        ],
      },
      {
        section_key: 'employer_details',
        section_title_he: 'פרטי מעסיק',
        edit_action_key: 'update_payroll_employer_details',
        lines: [
          { label_he: 'שם חברה', value_he: textHe(employer.company_name) },
          { label_he: 'שנת הקמת חברה', value_he: textHe(employer.company_founded_year) },
          { label_he: 'ישוב', value_he: textHe(employer.city) },
          { label_he: 'רחוב', value_he: textHe(employer.street) },
          { label_he: 'מיקוד', value_he: textHe(employer.postal_code) },
          { label_he: 'מס טלפון', value_he: textHe(employer.phone) },
          { label_he: 'דואר אלקטרוני', value_he: textHe(employer.email) },
        ],
        edit_fields: [
          { key: 'employer_company_name_override', label_he: 'שם חברה', type: 'text', value: r.employer_company_name_override ?? '' },
          { key: 'employer_company_founded_year_override', label_he: 'שנת הקמת חברה', type: 'number', value: r.employer_company_founded_year_override ?? '' },
          { key: 'employer_city_override', label_he: 'ישוב', type: 'text', value: r.employer_city_override ?? '' },
          { key: 'employer_street_override', label_he: 'רחוב', type: 'text', value: r.employer_street_override ?? '' },
          { key: 'employer_postal_code_override', label_he: 'מיקוד', type: 'text', value: r.employer_postal_code_override ?? '' },
          { key: 'employer_phone_override', label_he: 'מס טלפון', type: 'text', value: r.employer_phone_override ?? '' },
          { key: 'employer_email_override', label_he: 'דואר אלקטרוני', type: 'text', value: r.employer_email_override ?? '' },
        ],
      },
      {
        section_key: 'deductions',
        section_title_he: 'פרטי ניכויים',
        edit_action_key: 'update_payroll_employer_details',
        lines: [
          { label_he: 'מס הכנסה ניכויים', value_he: textHe(baseIncomeTaxDeductions) },
          { label_he: 'ביטוח לאומי ניכויים', value_he: textHe(baseNiDeductions) },
          { label_he: 'מזהה מעסיק ב.ל', value_he: textHe(r.employer_id_bl) },
        ],
        edit_fields: [{ key: 'employer_id_bl', label_he: 'מזהה מעסיק ב.ל', type: 'text', value: r.employer_id_bl ?? '' }],
      },
      {
        section_key: 'bank',
        section_title_he: 'פרטי בנק',
        edit_action_key: 'update_payroll_bank_details',
        lines: [
          { label_he: 'מס בנק', value_he: textHe(r.bank_number) },
          { label_he: 'מס סניף', value_he: textHe(r.bank_branch) },
          { label_he: 'מס חשבון', value_he: textHe(r.bank_account) },
        ],
        edit_fields: [
          { key: 'bank_number', label_he: 'מס בנק', type: 'text', value: r.bank_number ?? '' },
          { key: 'bank_branch', label_he: 'מס סניף', type: 'text', value: r.bank_branch ?? '' },
          { key: 'bank_account', label_he: 'מס חשבון', type: 'text', value: r.bank_account ?? '' },
        ],
      },
      {
        section_key: 'reporting',
        section_title_he: 'דיווחים',
        edit_action_key: 'update_payroll_reporting',
        lines: [
          {
            label_he: 'דיווח למס הכנסה',
            value_he: REPORTING_OPTIONS.find((o) => o.value === String(r.reporting_income_tax_frequency ?? ''))?.label_he ?? '—',
          },
          { label_he: 'דיווח טופס 102', value_he: boolHe(r.form_102_reported as boolean | null) },
          { label_he: 'דיווח טופס 100', value_he: boolHe(r.form_100_reported as boolean | null) },
          { label_he: 'דיווח טופס 126', value_he: '18 ביולי (ינואר–יוני), 18 בינואר (שנתי)' },
        ],
        edit_fields: [
          {
            key: 'reporting_income_tax_frequency',
            label_he: 'דיווח למס הכנסה',
            type: 'select',
            value: r.reporting_income_tax_frequency ?? null,
            options: REPORTING_OPTIONS,
          },
          {
            key: 'form_102_reported',
            label_he: 'טופס 102 דווח',
            type: 'radio',
            value: r.form_102_reported ? 'yes' : 'no',
            options: [
              { value: 'yes', label_he: 'כן' },
              { value: 'no', label_he: 'לא' },
            ],
          },
          {
            key: 'form_100_reported',
            label_he: 'טופס 100 דווח',
            type: 'radio',
            value: r.form_100_reported ? 'yes' : 'no',
            options: [
              { value: 'yes', label_he: 'כן' },
              { value: 'no', label_he: 'לא' },
            ],
          },
        ],
      },
      {
        section_key: 'process',
        section_title_he: 'תהליך שכר',
        edit_action_key: 'update_payroll_process',
        lines: [
          { label_he: 'תחום עיסוק', value_he: textHe(employer.business_domain) },
          { label_he: 'באיזו תוכנה מחשבים שכר', value_he: textHe(r.process_payroll_software) },
          { label_he: 'איך נשלחים נתונים', value_he: textHe(r.process_data_delivery_method) },
          { label_he: 'מי שולח נתונים', value_he: textHe(r.process_data_sender) },
          { label_he: 'מועד קבלת נתונים', value_he: textHe(r.process_data_received_day) },
          { label_he: 'מועד תשלום שכר', value_he: textHe(r.process_salary_payment_day) },
          {
            label_he: 'נתונים מתקבלים בזמן',
            value_he: PROCESS_TIMELINESS_OPTIONS.find((o) => o.value === String(r.process_data_received_timeliness ?? ''))?.label_he ?? '—',
          },
          { label_he: 'שם איש קשר לשכר', value_he: textHe(r.process_payroll_contact_name) },
          { label_he: 'טלפון איש קשר לשכר', value_he: textHe(r.process_payroll_contact_phone) },
          { label_he: 'דוא"ל לשכר', value_he: textHe(r.process_payroll_contact_email) },
        ],
        edit_fields: [
          { key: 'process_payroll_software', label_he: 'באיזו תוכנה מחשבים שכר', type: 'text', value: r.process_payroll_software ?? '' },
          { key: 'process_data_delivery_method', label_he: 'איך נשלחים נתונים', type: 'text', value: r.process_data_delivery_method ?? '' },
          { key: 'process_data_sender', label_he: 'מי שולח נתונים', type: 'text', value: r.process_data_sender ?? '' },
          { key: 'process_data_received_day', label_he: 'מועד קבלת נתונים', type: 'text', value: r.process_data_received_day ?? '' },
          { key: 'process_salary_payment_day', label_he: 'מועד תשלום שכר', type: 'text', value: r.process_salary_payment_day ?? '' },
          {
            key: 'process_data_received_timeliness',
            label_he: 'נתונים מתקבלים בזמן',
            type: 'select',
            value: r.process_data_received_timeliness ?? null,
            options: PROCESS_TIMELINESS_OPTIONS,
          },
          { key: 'process_payroll_contact_name', label_he: 'שם איש קשר לשכר', type: 'text', value: r.process_payroll_contact_name ?? '' },
          { key: 'process_payroll_contact_phone', label_he: 'טלפון איש קשר לשכר', type: 'text', value: r.process_payroll_contact_phone ?? '' },
          { key: 'process_payroll_contact_email', label_he: 'דוא"ל לשכר', type: 'text', value: r.process_payroll_contact_email ?? '' },
        ],
      },
      {
        section_key: 'complexity',
        section_title_he: 'מורכבות',
        edit_action_key: 'update_payroll_complexity',
        lines: [
          {
            label_he: 'רמת מורכבות',
            value_he: COMPLEXITY_OPTIONS.find((o) => o.value === String(r.complexity_level ?? ''))?.label_he ?? '—',
          },
          { label_he: 'דורש תיקונים', value_he: boolHe(r.complexity_requires_fixes as boolean | null) },
          {
            label_he: 'יש עובדים עם הסדרים מיוחדים',
            value_he:
              SPECIAL_ARRANGEMENTS_OPTIONS.find((o) => o.value === String(r.complexity_special_arrangements ?? ''))?.label_he ?? '—',
          },
          { label_he: 'הערות', value_he: textHe(r.complexity_notes) },
        ],
        edit_fields: [
          { key: 'complexity_level', label_he: 'רמת מורכבות', type: 'select', value: r.complexity_level ?? null, options: COMPLEXITY_OPTIONS },
          { key: 'complexity_requires_fixes', label_he: 'דורש תיקונים', type: 'radio', value: r.complexity_requires_fixes ? 'yes' : 'no', options: [{ value: 'yes', label_he: 'כן' }, { value: 'no', label_he: 'לא' }] },
          {
            key: 'complexity_special_arrangements',
            label_he: 'יש עובדים עם הסדרים מיוחדים',
            type: 'select',
            value: r.complexity_special_arrangements ?? null,
            options: SPECIAL_ARRANGEMENTS_OPTIONS,
          },
          { key: 'complexity_notes', label_he: 'הערות', type: 'textarea', value: r.complexity_notes ?? '' },
        ],
      },
      {
        section_key: 'employees',
        section_title_he: 'עובדים',
        edit_action_key: 'update_payroll_employees',
        lines: [
          { label_he: 'מספר עובדים', value_he: textHe(r.employees_count ?? null) },
          { label_he: 'גרף שינוי עובדים', value_he: textHe(r.employees_graph_json ?? null) },
        ],
        edit_fields: [
          { key: 'employees_count', label_he: 'מספר עובדים', type: 'number', value: r.employees_count ?? null },
          { key: 'employees_trend', label_he: 'גרף שינוי עובדים', type: 'textarea', value: r.employees_graph_json ?? '' },
        ],
      },
    ],
  };
}

const COMMAND_ALLOWED_KEYS: Record<PayrollCommandType, string[]> = {
  update_payroll_status: ['has_employees'],
  update_payroll_employer_details: [
    'employer_company_name_override',
    'employer_company_founded_year_override',
    'employer_city_override',
    'employer_street_override',
    'employer_postal_code_override',
    'employer_phone_override',
    'employer_email_override',
    'employer_business_domain_override',
    'employer_id_bl',
  ],
  update_payroll_bank_details: ['bank_number', 'bank_branch', 'bank_account'],
  update_payroll_reporting: ['reporting_income_tax_frequency', 'form_102_reported', 'form_100_reported'],
  update_payroll_process: [
    'process_payroll_software',
    'process_data_delivery_method',
    'process_data_sender',
    'process_data_received_day',
    'process_salary_payment_day',
    'process_data_received_timeliness',
    'process_payroll_contact_name',
    'process_payroll_contact_phone',
    'process_payroll_contact_email',
  ],
  update_payroll_complexity: [
    'complexity_level',
    'complexity_requires_fixes',
    'complexity_special_arrangements',
    'complexity_notes',
  ],
  update_payroll_employees: ['employees_count', 'employees_trend'],
};

export async function executePayrollTabCommand(ctx: RequestContext, clientId: string, body: PayrollTabCommandBody): Promise<void> {
  const orgId = assertOrg(ctx);
  if (!canEditPayrollTab(ctx)) throw forbidden('Insufficient permission');
  await ensureClientInOrg(orgId, clientId);
  await ensurePayrollProfile(orgId, clientId);

  if (!body || typeof body.type !== 'string' || !(body.type in COMMAND_ALLOWED_KEYS)) {
    throw badRequest('סוג פקודה לא מוכר');
  }
  const expected = Number(body.expected_version);
  if (!Number.isFinite(expected)) {
    throw badRequest('גרסת מודל קריאה נדרשת');
  }

  const cmd = body.type as PayrollCommandType;
  const payload = asObj(body.payload);
  const fieldPatch: Record<string, unknown> = {};

  for (const k of COMMAND_ALLOWED_KEYS[cmd]) {
    if (payload[k] === undefined) continue;
    if (
      k === 'has_employees' ||
      k === 'complexity_requires_fixes' ||
      k === 'form_102_reported' ||
      k === 'form_100_reported'
    ) {
      fieldPatch[k] = payload[k] === true || payload[k] === 'yes' || payload[k] === 'כן';
      continue;
    }
    if (k === 'employer_company_founded_year_override') {
      fieldPatch[k] = toNumberOrNull(payload[k]);
      continue;
    }
    if (k === 'employees_count') {
      fieldPatch.employees_count = toNumberOrNull(payload[k]);
      continue;
    }
    if (k === 'employees_trend') {
      fieldPatch.employees_graph_json =
        payload[k] == null || payload[k] === '' ? null : String(payload[k]).trim();
      continue;
    }
    fieldPatch[k] = payload[k] == null || payload[k] === '' ? null : String(payload[k]).trim();
  }

  const updatePayload = {
    ...fieldPatch,
    updated_by: ctx.user.id,
    updated_at: new Date().toISOString(),
    read_model_version: expected + 1,
  };

  const { data: updated, error } = await supabaseAdmin
    .from('client_payroll_profiles')
    .update(updatePayload)
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('read_model_version', expected)
    .select('id');
  if (error) throw new AppError(500, error.message ?? 'payroll command failed', 'SUPABASE_ERROR');
  if (!updated?.length) throw conflict('הנתונים עודכנו; רענן ונסה שוב');

  if (cmd === 'update_payroll_reporting') {
    await syncNiDeductionsReportingFromPayrollProfile(orgId, clientId);
  }

  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_payroll_profiles',
    entityId: clientId,
    action: AUDIT_ACTIONS.CLIENT_PAYROLL_UPDATED,
    payload: {
      client_id: clientId,
      command: cmd,
      expected_version: expected,
      changed_keys: Object.keys(fieldPatch),
    },
  });
}
