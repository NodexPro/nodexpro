import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import { syncNiDeductionsReportingFromPayrollProfile } from './client-obligations-tasks-core.service.js';
import {
  CO_UI,
  PAYROLL_SECTION_TITLE_KEY,
  payrollFieldLabelKey,
  payrollLineLabelKey,
  payrollOptionLabelKey,
} from './client-operations-ui-labels.pure.js';

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

type PayrollOptionDto = { value: string; label_he: string; label_key?: string };

type PayrollFieldDto = {
  key: string;
  label_he: string;
  label_key?: string;
  type: PayrollFieldType;
  value: unknown;
  options?: PayrollOptionDto[];
};

type PayrollLineDto = {
  line_key: string;
  label_he: string;
  label_key?: string;
  value_he: string;
  value_key?: string;
};

type PayrollSectionDto = {
  section_key: string;
  section_title_he: string;
  section_title_key?: string;
  edit_action_key: PayrollCommandType | null;
  lines: PayrollLineDto[];
  edit_fields: PayrollFieldDto[];
};

export type PayrollTabResponse = {
  tab_key: 'payroll';
  tab_title_he: string;
  tab_title_key?: string;
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
  if (error && String((error as { code?: string }).code ?? '') === '23505') return;
  if (error && /duplicate key/i.test(String(error.message ?? ''))) return;
  if (error) throw new AppError(500, 'לא ניתן להשלים את הפעולה כרגע. נסו שוב.', 'SUPABASE_ERROR');
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

function withOptionKeys(options: Array<{ value: string; label_he: string }>): PayrollOptionDto[] {
  return options.map((o) => {
    const label_key = payrollOptionLabelKey(o.value);
    return label_key ? { ...o, label_key } : o;
  });
}

const YES_NO_OPTIONS = withOptionKeys([
  { value: 'yes', label_he: 'כן' },
  { value: 'no', label_he: 'לא' },
]);

const REPORTING_OPTIONS = withOptionKeys([
  { value: 'monthly', label_he: 'חד חודשי' },
  { value: 'bi_monthly', label_he: 'דו חודשי' },
  { value: 'semi_annual', label_he: 'חצי שנתי' },
]);

const PROCESS_TIMELINESS_OPTIONS = withOptionKeys([
  { value: 'always', label_he: 'תמיד' },
  { value: 'usually', label_he: 'בדרך כלל' },
  { value: 'fixed_delay', label_he: 'באיחור קבוע' },
]);

const COMPLEXITY_OPTIONS = withOptionKeys([
  { value: 'low', label_he: 'נמוכה' },
  { value: 'medium', label_he: 'בינונית' },
  { value: 'high', label_he: 'גבוהה' },
]);

const SPECIAL_ARRANGEMENTS_OPTIONS: PayrollOptionDto[] = [
  { value: 'foreign_workers', label_he: 'foreign workers' },
  { value: 'pension_edge_cases', label_he: 'pension edge cases' },
  { value: 'youth', label_he: 'youth' },
  { value: 'hourly_mix', label_he: 'hourly mix' },
  { value: 'commissions', label_he: 'commissions' },
];

function payrollLine(
  lineKey: string,
  labelHe: string,
  valueHe: string,
  valueKey?: string,
): PayrollLineDto {
  return {
    line_key: lineKey,
    label_he: labelHe,
    label_key: payrollLineLabelKey(lineKey),
    value_he: valueHe,
    ...(valueKey ? { value_key: valueKey } : {}),
  };
}

function boolLine(lineKey: string, labelHe: string, v: boolean | null | undefined): PayrollLineDto {
  const valueKey = v == null ? undefined : v ? CO_UI.yes : CO_UI.no;
  return payrollLine(lineKey, labelHe, boolHe(v), valueKey);
}

function optionValueLine(
  lineKey: string,
  labelHe: string,
  raw: unknown,
  options: PayrollOptionDto[],
): PayrollLineDto {
  const found = options.find((o) => o.value === String(raw ?? ''));
  return payrollLine(lineKey, labelHe, found?.label_he ?? '—', found?.label_key);
}

function payrollField(
  key: string,
  labelHe: string,
  type: PayrollFieldType,
  value: unknown,
  options?: PayrollOptionDto[],
): PayrollFieldDto {
  return {
    key,
    label_he: labelHe,
    label_key: payrollFieldLabelKey(key),
    type,
    value,
    ...(options ? { options } : {}),
  };
}

function pickOverride(overrideValue: unknown, baseValue: unknown): string | null {
  const o = overrideValue == null ? '' : String(overrideValue).trim();
  if (o) return o;
  const b = baseValue == null ? '' : String(baseValue).trim();
  return b || null;
}

export async function getPayrollTabReadModel(
  ctx: RequestContext,
  clientId: string,
  options?: { readOnly?: boolean },
): Promise<PayrollTabResponse | null> {
  const orgId = assertOrg(ctx);
  if (!canViewPayrollTab(ctx)) return null;
  await ensureClientInOrg(orgId, clientId);
  if (!options?.readOnly) {
    await ensurePayrollProfile(orgId, clientId);
  }

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
    tab_title_key: CO_UI.payroll.title,
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
        section_title_key: PAYROLL_SECTION_TITLE_KEY.status,
        edit_action_key: 'update_payroll_status',
        lines: [boolLine('has_employees', 'יש עובדים', hasEmployees)],
        edit_fields: [
          payrollField('has_employees', 'יש עובדים', 'radio', hasEmployees ? 'yes' : 'no', YES_NO_OPTIONS),
        ],
      },
      {
        section_key: 'employer_details',
        section_title_he: 'פרטי מעסיק',
        section_title_key: PAYROLL_SECTION_TITLE_KEY.employer_details,
        edit_action_key: 'update_payroll_employer_details',
        lines: [
          payrollLine('company_name', 'שם חברה', textHe(employer.company_name)),
          payrollLine('founded_year', 'שנת הקמת חברה', textHe(employer.company_founded_year)),
          payrollLine('city', 'ישוב', textHe(employer.city)),
          payrollLine('street', 'רחוב', textHe(employer.street)),
          payrollLine('postal_code', 'מיקוד', textHe(employer.postal_code)),
          payrollLine('phone', 'מס טלפון', textHe(employer.phone)),
          payrollLine('email', 'דואר אלקטרוני', textHe(employer.email)),
        ],
        edit_fields: [
          payrollField('employer_company_name_override', 'שם חברה', 'text', r.employer_company_name_override ?? ''),
          payrollField('employer_company_founded_year_override', 'שנת הקמת חברה', 'number', r.employer_company_founded_year_override ?? ''),
          payrollField('employer_city_override', 'ישוב', 'text', r.employer_city_override ?? ''),
          payrollField('employer_street_override', 'רחוב', 'text', r.employer_street_override ?? ''),
          payrollField('employer_postal_code_override', 'מיקוד', 'text', r.employer_postal_code_override ?? ''),
          payrollField('employer_phone_override', 'מס טלפון', 'text', r.employer_phone_override ?? ''),
          payrollField('employer_email_override', 'דואר אלקטרוני', 'text', r.employer_email_override ?? ''),
        ],
      },
      {
        section_key: 'deductions',
        section_title_he: 'פרטי ניכויים',
        section_title_key: PAYROLL_SECTION_TITLE_KEY.deductions,
        edit_action_key: 'update_payroll_employer_details',
        lines: [
          payrollLine('income_tax_deductions', 'מס הכנסה ניכויים', textHe(baseIncomeTaxDeductions)),
          payrollLine('ni_deductions', 'ביטוח לאומי ניכויים', textHe(baseNiDeductions)),
          payrollLine('employer_id_bl', 'מזהה מעסיק ב.ל', textHe(r.employer_id_bl)),
        ],
        edit_fields: [payrollField('employer_id_bl', 'מזהה מעסיק ב.ל', 'text', r.employer_id_bl ?? '')],
      },
      {
        section_key: 'bank',
        section_title_he: 'פרטי בנק',
        section_title_key: PAYROLL_SECTION_TITLE_KEY.bank,
        edit_action_key: 'update_payroll_bank_details',
        lines: [
          payrollLine('bank_number', 'מס בנק', textHe(r.bank_number)),
          payrollLine('bank_branch', 'מס סניף', textHe(r.bank_branch)),
          payrollLine('bank_account', 'מס חשבון', textHe(r.bank_account)),
        ],
        edit_fields: [
          payrollField('bank_number', 'מס בנק', 'text', r.bank_number ?? ''),
          payrollField('bank_branch', 'מס סניף', 'text', r.bank_branch ?? ''),
          payrollField('bank_account', 'מס חשבון', 'text', r.bank_account ?? ''),
        ],
      },
      {
        section_key: 'reporting',
        section_title_he: 'דיווחים',
        section_title_key: PAYROLL_SECTION_TITLE_KEY.reporting,
        edit_action_key: 'update_payroll_reporting',
        lines: [
          optionValueLine('reporting_income_tax', 'דיווח למס הכנסה', r.reporting_income_tax_frequency, REPORTING_OPTIONS),
          boolLine('form_102', 'דיווח טופס 102', r.form_102_reported as boolean | null),
          boolLine('form_100', 'דיווח טופס 100', r.form_100_reported as boolean | null),
          payrollLine(
            'form_126',
            'דיווח טופס 126',
            '18 ביולי (ינואר–יוני), 18 בינואר (שנתי)',
            CO_UI.payroll.form126Schedule,
          ),
        ],
        edit_fields: [
          payrollField(
            'reporting_income_tax_frequency',
            'דיווח למס הכנסה',
            'select',
            r.reporting_income_tax_frequency ?? null,
            REPORTING_OPTIONS,
          ),
          payrollField('form_102_reported', 'טופס 102 דווח', 'radio', r.form_102_reported ? 'yes' : 'no', YES_NO_OPTIONS),
          payrollField('form_100_reported', 'טופס 100 דווח', 'radio', r.form_100_reported ? 'yes' : 'no', YES_NO_OPTIONS),
        ],
      },
      {
        section_key: 'process',
        section_title_he: 'תהליך שכר',
        section_title_key: PAYROLL_SECTION_TITLE_KEY.process,
        edit_action_key: 'update_payroll_process',
        lines: [
          payrollLine('domain', 'תחום עיסוק', textHe(employer.business_domain)),
          payrollLine('payroll_software', 'באיזו תוכנה מחשבים שכר', textHe(r.process_payroll_software)),
          payrollLine('data_delivery', 'איך נשלחים נתונים', textHe(r.process_data_delivery_method)),
          payrollLine('data_sender', 'מי שולח נתונים', textHe(r.process_data_sender)),
          payrollLine('data_received_day', 'מועד קבלת נתונים', textHe(r.process_data_received_day)),
          payrollLine('salary_payment_day', 'מועד תשלום שכר', textHe(r.process_salary_payment_day)),
          optionValueLine(
            'data_on_time',
            'נתונים מתקבלים בזמן',
            r.process_data_received_timeliness,
            PROCESS_TIMELINESS_OPTIONS,
          ),
          payrollLine('contact_name', 'שם איש קשר לשכר', textHe(r.process_payroll_contact_name)),
          payrollLine('contact_phone', 'טלפון איש קשר לשכר', textHe(r.process_payroll_contact_phone)),
          payrollLine('contact_email', 'דוא"ל לשכר', textHe(r.process_payroll_contact_email)),
        ],
        edit_fields: [
          payrollField('process_payroll_software', 'באיזו תוכנה מחשבים שכר', 'text', r.process_payroll_software ?? ''),
          payrollField('process_data_delivery_method', 'איך נשלחים נתונים', 'text', r.process_data_delivery_method ?? ''),
          payrollField('process_data_sender', 'מי שולח נתונים', 'text', r.process_data_sender ?? ''),
          payrollField('process_data_received_day', 'מועד קבלת נתונים', 'text', r.process_data_received_day ?? ''),
          payrollField('process_salary_payment_day', 'מועד תשלום שכר', 'text', r.process_salary_payment_day ?? ''),
          payrollField(
            'process_data_received_timeliness',
            'נתונים מתקבלים בזמן',
            'select',
            r.process_data_received_timeliness ?? null,
            PROCESS_TIMELINESS_OPTIONS,
          ),
          payrollField('process_payroll_contact_name', 'שם איש קשר לשכר', 'text', r.process_payroll_contact_name ?? ''),
          payrollField('process_payroll_contact_phone', 'טלפון איש קשר לשכר', 'text', r.process_payroll_contact_phone ?? ''),
          payrollField('process_payroll_contact_email', 'דוא"ל לשכר', 'text', r.process_payroll_contact_email ?? ''),
        ],
      },
      {
        section_key: 'complexity',
        section_title_he: 'מורכבות',
        section_title_key: PAYROLL_SECTION_TITLE_KEY.complexity,
        edit_action_key: 'update_payroll_complexity',
        lines: [
          optionValueLine('complexity_level', 'רמת מורכבות', r.complexity_level, COMPLEXITY_OPTIONS),
          boolLine('requires_fixes', 'דורש תיקונים', r.complexity_requires_fixes as boolean | null),
          optionValueLine(
            'special_arrangements',
            'יש עובדים עם הסדרים מיוחדים',
            r.complexity_special_arrangements,
            SPECIAL_ARRANGEMENTS_OPTIONS,
          ),
          payrollLine('notes', 'הערות', textHe(r.complexity_notes)),
        ],
        edit_fields: [
          payrollField('complexity_level', 'רמת מורכבות', 'select', r.complexity_level ?? null, COMPLEXITY_OPTIONS),
          payrollField(
            'complexity_requires_fixes',
            'דורש תיקונים',
            'radio',
            r.complexity_requires_fixes ? 'yes' : 'no',
            YES_NO_OPTIONS,
          ),
          payrollField(
            'complexity_special_arrangements',
            'יש עובדים עם הסדרים מיוחדים',
            'select',
            r.complexity_special_arrangements ?? null,
            SPECIAL_ARRANGEMENTS_OPTIONS,
          ),
          payrollField('complexity_notes', 'הערות', 'textarea', r.complexity_notes ?? ''),
        ],
      },
      {
        section_key: 'employees',
        section_title_he: 'עובדים',
        section_title_key: PAYROLL_SECTION_TITLE_KEY.employees,
        edit_action_key: 'update_payroll_employees',
        lines: [
          payrollLine('employees_count', 'מספר עובדים', textHe(r.employees_count ?? null)),
          payrollLine('employees_chart', 'גרף שינוי עובדים', textHe(r.employees_graph_json ?? null)),
        ],
        edit_fields: [
          payrollField('employees_count', 'מספר עובדים', 'number', r.employees_count ?? null),
          payrollField('employees_trend', 'גרף שינוי עובדים', 'textarea', r.employees_graph_json ?? ''),
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
