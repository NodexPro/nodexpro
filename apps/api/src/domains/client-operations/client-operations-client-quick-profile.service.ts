/**
 * Client Operations — Client Quick Profile aggregate (single read model).
 * READ-ONLY. No commands. Org-scoped. Ready-to-render rows for a dumb UI.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import {
  formatFilingDueDateDisplay,
  incomeTaxAdvancesObligationKey,
  incomeTaxDeductionsObligationKey,
  isFilingDueDateAfterReportingPeriodEnd,
  isVatReportingPeriodApplicable,
  resolveVatObligationKeyFromClientTaxSettings,
  unresolvedReportingDueDate,
  type ReportingDueDateResolution,
} from '../country-pack/reporting-calendar.pure.js';
import {
  resolveReportingDueDatesBatch,
  resolveNationalInsuranceDeductionsDueDate,
} from '../country-pack/reporting-calendar-resolver.service.js';
import { resolveOrganizationActiveRuleset } from '../country-pack/organization-country.service.js';
import { computeVatRegistryColumnDisplayHe } from './vat-divuach.js';
import {
  CLIENT_OPERATIONS_CLIENT_QUICK_PROFILE_AGGREGATE_KEY,
  QUICK_PROFILE_EMPTY_DISPLAY,
  buildQuickProfileIdentityRow,
  buildQuickProfileInfoRow,
  buildQuickProfileRecurringExpenseRows,
  buildQuickProfileVehicleExpenseRows,
  formatQuickProfileIncomeTaxAdvancesDisplayHe,
  formatQuickProfileIncomeTaxDeductionsDisplayHe,
  formatQuickProfilePayrollDisplayHe,
  resolveIncomeTaxDeductionsOperationalReportingPeriodKey,
  resolveOperationalReportingPeriodKey,
  resolveQuickProfilePhoneDisplay,
  resolveVatOperationalCalendarLookupPeriodKey,
  resolveVatOperationalReportingPeriodKey,
  type ClientOperationsClientQuickProfileAggregate,
  type ClientQuickProfileRow,
} from './client-operations-client-quick-profile.pure.js';

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

function displayFromResolution(resolution: {
  resolved: boolean;
  filing_due_date?: string | null;
}): string {
  if (!resolution.resolved || !resolution.filing_due_date) {
    return QUICK_PROFILE_EMPTY_DISPLAY;
  }
  return formatFilingDueDateDisplay(resolution.filing_due_date) ?? QUICK_PROFILE_EMPTY_DISPLAY;
}

function calendarLookupMapKey(obligationKey: string, periodKey: string): string {
  return `${obligationKey}::${periodKey}`;
}

async function resolveQuickProfileReportingDueDates(input: {
  country_code: string;
  country_pack_ruleset_id?: string | null;
  reporting_period_key: string | null;
  vat_reporting_period_key: string | null;
  deductions_reporting_period_key: string | null;
  vat_type: string | null;
  vat_due_type: string | null;
  vat_frequency: string | null;
  income_tax_advance_enabled: boolean;
  income_tax_deductions_enabled: boolean;
}): Promise<{
  vat: ReportingDueDateResolution | null;
  advances: ReportingDueDateResolution | null;
  deductions: ReportingDueDateResolution | null;
}> {
  const lookups: Array<{ obligation_key: string; reporting_period_key: string }> = [];
  let vat: ReportingDueDateResolution | null = null;
  let vatObligationKey: string | null = null;
  let vatLookupPeriodKey: string | null = null;

  if (input.vat_reporting_period_key) {
    vatObligationKey = resolveVatObligationKeyFromClientTaxSettings({
      vat_type: input.vat_type,
      vat_due_type: input.vat_due_type,
    });
    if (!vatObligationKey) {
      vat = unresolvedReportingDueDate(
        input.country_code,
        String(input.vat_due_type ?? 'vat'),
        input.vat_reporting_period_key,
        'vat_not_applicable'
      );
    } else if (
      !isVatReportingPeriodApplicable({
        vat_frequency: input.vat_frequency,
        reporting_period_key: input.vat_reporting_period_key,
      })
    ) {
      vat = unresolvedReportingDueDate(
        input.country_code,
        vatObligationKey,
        input.vat_reporting_period_key,
        'vat_period_not_applicable_for_frequency'
      );
    } else {
      vatLookupPeriodKey = resolveVatOperationalCalendarLookupPeriodKey({
        vat_frequency: input.vat_frequency,
        period_identity_key: input.vat_reporting_period_key,
      });
      if (!vatLookupPeriodKey) {
        vat = unresolvedReportingDueDate(
          input.country_code,
          vatObligationKey,
          input.vat_reporting_period_key,
          'invalid_reporting_period_key'
        );
      } else {
        lookups.push({ obligation_key: vatObligationKey, reporting_period_key: vatLookupPeriodKey });
      }
    }
  }

  const advancesApplicable = input.income_tax_advance_enabled && Boolean(input.reporting_period_key);
  if (advancesApplicable && input.reporting_period_key) {
    lookups.push({
      obligation_key: incomeTaxAdvancesObligationKey(),
      reporting_period_key: input.reporting_period_key,
    });
  }

  const deductionsApplicable =
    input.income_tax_deductions_enabled && Boolean(input.deductions_reporting_period_key);
  if (deductionsApplicable && input.deductions_reporting_period_key) {
    lookups.push({
      obligation_key: incomeTaxDeductionsObligationKey(),
      reporting_period_key: input.deductions_reporting_period_key,
    });
  }

  const resolved = await resolveReportingDueDatesBatch({
    country_code: input.country_code,
    country_pack_ruleset_id: input.country_pack_ruleset_id,
    lookups,
  });

  if (vat == null && vatObligationKey && vatLookupPeriodKey && input.vat_reporting_period_key) {
    const candidate = resolved.get(calendarLookupMapKey(vatObligationKey, vatLookupPeriodKey)) ?? null;
    if (
      candidate?.resolved &&
      !isFilingDueDateAfterReportingPeriodEnd(candidate.filing_due_date, vatLookupPeriodKey)
    ) {
      vat = unresolvedReportingDueDate(
        input.country_code,
        vatObligationKey,
        input.vat_reporting_period_key,
        'filing_due_before_reporting_period_end'
      );
    } else {
      vat = candidate;
    }
  }

  const advances =
    advancesApplicable && input.reporting_period_key
      ? resolved.get(calendarLookupMapKey(incomeTaxAdvancesObligationKey(), input.reporting_period_key)) ?? null
      : null;
  const deductions =
    deductionsApplicable && input.deductions_reporting_period_key
      ? resolved.get(calendarLookupMapKey(incomeTaxDeductionsObligationKey(), input.deductions_reporting_period_key)) ?? null
      : null;

  return { vat, advances, deductions };
}

/**
 * GET quick profile for one client — one aggregate, org-scoped.
 */
export async function getClientOperationsClientQuickProfile(
  ctx: RequestContext,
  clientId: string
): Promise<ClientOperationsClientQuickProfileAggregate> {
  const orgId = assertOrg(ctx);
  const id = String(clientId ?? '').trim();
  if (!id) throw forbidden('Client not found');

  const reportingPeriodKey = resolveOperationalReportingPeriodKey();
  const asOf = new Date().toISOString().slice(0, 10);

  const [
    { data: client, error: clientErr },
    { data: primaryContact },
    { data: profile },
    { data: accountingSettings },
    { data: expenseItems },
    { data: taxSettingsRow },
    { data: fleetRows },
    orgRuleset,
  ] =
    await Promise.all([
      supabaseAdmin
        .from('clients')
        .select('id, display_name, tax_id, phone')
        .eq('organization_id', orgId)
        .eq('id', id)
        .maybeSingle(),
      supabaseAdmin
        .from('client_contacts')
        .select('phone')
        .eq('organization_id', orgId)
        .eq('client_id', id)
        .eq('is_primary', true)
        .maybeSingle(),
      supabaseAdmin
        .from('client_operational_profiles')
        .select('business_type, payroll_flag')
        .eq('organization_id', orgId)
        .eq('client_id', id)
        .maybeSingle(),
      supabaseAdmin
        .from('client_accounting_settings')
        .select('income_management_system, has_vehicles')
        .eq('organization_id', orgId)
        .eq('client_id', id)
        .maybeSingle(),
      supabaseAdmin
        .from('client_accounting_expense_items')
        .select('expense_type_code, business_percent, monthly_amount_ils, sort_order')
        .eq('organization_id', orgId)
        .eq('client_id', id)
        .order('sort_order', { ascending: true }),
      supabaseAdmin
        .from('client_tax_settings')
        .select(
          'vat_type, vat_frequency, vat_due_type, income_tax_advance_enabled, income_tax_advance_percent, income_tax_deductions_enabled, income_tax_deductions_frequency, national_insurance_deductions_file_number'
        )
        .eq('organization_id', orgId)
        .eq('client_id', id)
        .maybeSingle(),
      supabaseAdmin
        .from('client_accounting_vehicle_fleet')
        .select('vehicle_status, business_use_percent, license_plate')
        .eq('organization_id', orgId)
        .eq('client_id', id)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      resolveOrganizationActiveRuleset(orgId, asOf),
    ]);

  if (clientErr) throw clientErr;
  if (!client) throw forbidden('Client not found');

  const settings = (taxSettingsRow ?? {
    vat_type: null,
    vat_frequency: null,
    vat_due_type: null,
    income_tax_advance_enabled: false,
    income_tax_advance_percent: null,
    income_tax_deductions_enabled: false,
    income_tax_deductions_frequency: null,
    national_insurance_deductions_file_number: null,
  }) as {
    vat_type: string | null;
    vat_frequency: string | null;
    vat_due_type: string | null;
    income_tax_advance_enabled: boolean;
    income_tax_advance_percent: number | null;
    income_tax_deductions_enabled: boolean;
    income_tax_deductions_frequency: string | null;
    national_insurance_deductions_file_number: string | null;
  };

  const hasVehicles = Boolean(
    (accountingSettings as { has_vehicles?: boolean | null } | null)?.has_vehicles
  );
  const fleet = (hasVehicles ? (fleetRows ?? []) : []) as Array<{
    vehicle_status: string | null;
    business_use_percent: number | null;
    license_plate: string | null;
  }>;

  const phone = resolveQuickProfilePhoneDisplay({
    client_phone: (client as { phone?: string | null }).phone,
    primary_contact_phone: (primaryContact as { phone?: string | null } | null)?.phone,
  });

  const displayName = String((client as { display_name?: string | null }).display_name ?? '').trim();
  const taxId = (client as { tax_id?: string | null }).tax_id ?? null;
  const businessType =
    (profile as { business_type?: string | null } | null)?.business_type ?? null;
  const payrollFlag = Boolean(
    (profile as { payroll_flag?: boolean | null } | null)?.payroll_flag
  );

  const incomeSoftware =
    String(
      (accountingSettings as { income_management_system?: string | null } | null)
        ?.income_management_system ?? ''
    ).trim() || null;

  const identity_rows: ClientQuickProfileRow[] = [
    buildQuickProfileIdentityRow({
      key: 'client_name',
      label_he: 'שם לקוח',
      raw: displayName || null,
      copyable: true,
    }),
    buildQuickProfileIdentityRow({
      key: 'tax_id',
      label_he: 'ת.ז / ח.פ',
      raw: taxId,
      copyable: true,
    }),
    buildQuickProfileIdentityRow({
      key: 'business_type',
      label_he: 'סוג עסק',
      raw: businessType,
      copyable: false,
    }),
    buildQuickProfileIdentityRow({
      key: 'phone',
      label_he: 'טלפון',
      raw: phone,
      copyable: true,
    }),
  ];

  const vatFrequencyDisplay = computeVatRegistryColumnDisplayHe(
    businessType,
    settings.vat_type,
    settings.vat_frequency
  );

  const accounting_rows: ClientQuickProfileRow[] = [
    buildQuickProfileInfoRow({
      key: 'income_software',
      label_he: 'הכנסות',
      display_value: incomeSoftware,
      visible: true,
    }),
    buildQuickProfileInfoRow({
      key: 'vat_frequency',
      label_he: 'מע״מ',
      display_value: vatFrequencyDisplay,
      visible: true,
    }),
    buildQuickProfileInfoRow({
      key: 'income_tax_advances',
      label_he: 'מקדמות מס הכנסה',
      display_value: formatQuickProfileIncomeTaxAdvancesDisplayHe({
        enabled: settings.income_tax_advance_enabled,
        percent: settings.income_tax_advance_percent,
      }),
      visible: true,
    }),
    buildQuickProfileInfoRow({
      key: 'payroll',
      label_he: 'שכר',
      display_value: formatQuickProfilePayrollDisplayHe(payrollFlag),
      visible: true,
    }),
    buildQuickProfileInfoRow({
      key: 'income_tax_deductions',
      label_he: 'מס הכנסה ניכויים',
      display_value: formatQuickProfileIncomeTaxDeductionsDisplayHe(
        settings.income_tax_deductions_enabled
      ),
      visible: settings.income_tax_deductions_enabled === true,
    }),
  ];

  // Baseline = prior Jerusalem month (advances + aggregate metadata).
  // VAT / deductions select obligation-specific periods — see pure helpers.
  const vatReportingPeriodKey = resolveVatOperationalReportingPeriodKey({
    vat_frequency: settings.vat_frequency,
  });
  const deductionsPeriod = resolveIncomeTaxDeductionsOperationalReportingPeriodKey({
    frequency: settings.income_tax_deductions_frequency,
  });
  const reporting_rows: ClientQuickProfileRow[] = [];

  if (reportingPeriodKey || vatReportingPeriodKey || deductionsPeriod.applicable) {
    const countryCode = String(orgRuleset.country_code ?? '')
      .trim()
      .toUpperCase();
    const rulesetId = orgRuleset.ruleset_id;

    const niFile = String(settings.national_insurance_deductions_file_number ?? '').trim();
    const niApplicable =
      payrollFlag === true || Boolean(niFile) || settings.income_tax_deductions_enabled === true;
    const niPromise =
      niApplicable && reportingPeriodKey
        ? resolveNationalInsuranceDeductionsDueDate({
            country_code: countryCode,
            reporting_period_key: reportingPeriodKey,
          })
        : Promise.resolve(null);

    const [calendarResolutions, ni] = await Promise.all([
      resolveQuickProfileReportingDueDates({
        country_code: countryCode,
        country_pack_ruleset_id: rulesetId,
        reporting_period_key: reportingPeriodKey,
        vat_reporting_period_key: vatReportingPeriodKey,
        deductions_reporting_period_key: deductionsPeriod.reporting_period_key,
        vat_type: settings.vat_type,
        vat_due_type: settings.vat_due_type,
        vat_frequency: settings.vat_frequency,
        income_tax_advance_enabled: settings.income_tax_advance_enabled,
        income_tax_deductions_enabled:
          settings.income_tax_deductions_enabled &&
          deductionsPeriod.applicable &&
          Boolean(deductionsPeriod.reporting_period_key),
      }),
      niPromise,
    ]);
    const vatResolution = calendarResolutions.vat;
    const advancesResolution = calendarResolutions.advances;
    const deductionsResolution = calendarResolutions.deductions;

    if (vatResolution) {
      const vatReason = !vatResolution.resolved ? vatResolution.reason : null;
      const vatOmit =
        vatReason === 'vat_not_applicable' ||
        vatReason === 'vat_period_not_applicable_for_frequency';
      if (!vatOmit) {
        reporting_rows.push(
          buildQuickProfileInfoRow({
            key: 'vat_reporting_due_date',
            label_he: 'תאריך דיווח למע״מ',
            display_value: displayFromResolution(vatResolution),
            visible: true,
          })
        );
      }
    }

    if (advancesResolution) {
      reporting_rows.push(
        buildQuickProfileInfoRow({
          key: 'income_tax_advances_due_date',
          label_he: 'תאריך דיווח מקדמות מס הכנסה',
          display_value: displayFromResolution(advancesResolution),
          visible: true,
        })
      );
    }

    if (deductionsResolution) {
      reporting_rows.push(
        buildQuickProfileInfoRow({
          key: 'income_tax_deductions_due_date',
          label_he: 'תאריך דיווח מס הכנסה ניכויים',
          display_value: displayFromResolution(deductionsResolution),
          visible: true,
        })
      );
    }

    // Never invent / never alias Tax Authority dates. Show NI only if ACTIVE date exists.
    if (ni && ni.resolved) {
      reporting_rows.push(
        buildQuickProfileInfoRow({
          key: 'national_insurance_deductions_due_date',
          label_he: 'תאריך דיווח ביטוח לאומי ניכויים',
          display_value: displayFromResolution(ni),
          visible: true,
        })
      );
    }
  }

  const expenseRows = buildQuickProfileRecurringExpenseRows(
    (
      (expenseItems ?? []) as Array<{
        expense_type_code: string;
        business_percent: number | null;
        monthly_amount_ils: number | null;
      }>
    ).map((r) => ({
      expense_type_code: r.expense_type_code,
      business_percent: r.business_percent,
      monthly_amount_ils: r.monthly_amount_ils,
    }))
  );

  const vehicleRows = buildQuickProfileVehicleExpenseRows({
    has_vehicles: hasVehicles,
    vehicles: fleet.map((v) => ({
      vehicle_status: v.vehicle_status,
      business_use_percent: v.business_use_percent,
      license_plate: v.license_plate,
    })),
  });

  const recurring_expense_rows = [...expenseRows, ...vehicleRows];

  return {
    aggregate_key: CLIENT_OPERATIONS_CLIENT_QUICK_PROFILE_AGGREGATE_KEY,
    client_id: id,
    title: displayName || 'לקוח',
    reporting_period_key: reportingPeriodKey,
    identity_rows,
    accounting_rows,
    reporting_rows,
    recurring_expense_rows,
    expense_section_title_he: 'הוצאות קבועות',
    expense_section_visible: recurring_expense_rows.length > 0,
    allowed_actions: [],
  };
}
