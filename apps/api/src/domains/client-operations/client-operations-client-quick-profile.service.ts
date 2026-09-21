/**
 * Client Operations — Client Quick Profile aggregate (single read model).
 * READ-ONLY. No commands. Org-scoped. Ready-to-render rows for a dumb UI.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import { formatFilingDueDateDisplay } from '../country-pack/reporting-calendar.pure.js';
import {
  resolveClientIncomeTaxAdvancesDueDate,
  resolveClientIncomeTaxDeductionsDueDate,
  resolveClientVatReportingDueDate,
  resolveNationalInsuranceDeductionsDueDate,
} from '../country-pack/reporting-calendar-resolver.service.js';
import { resolveOrganizationActiveRuleset } from '../country-pack/organization-country.service.js';
import { getClientTaxSettings } from './client-tax-settings.service.js';
import { loadVehicleFleet } from './client-vehicle-fleet.service.js';
import {
  CLIENT_OPERATIONS_CLIENT_QUICK_PROFILE_AGGREGATE_KEY,
  QUICK_PROFILE_EMPTY_DISPLAY,
  buildQuickProfileIdentityRow,
  buildQuickProfileInfoRow,
  buildQuickProfileRecurringExpenseRows,
  buildQuickProfileVehicleExpenseRows,
  resolveIncomeTaxDeductionsOperationalReportingPeriodKey,
  resolveOperationalReportingPeriodKey,
  resolveQuickProfilePhoneDisplay,
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

  const [{ data: client, error: clientErr }, { data: primaryContact }, { data: profile }] =
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
    ]);

  if (clientErr) throw clientErr;
  if (!client) throw forbidden('Client not found');

  const [{ data: accountingSettings }, { data: expenseItems }] = await Promise.all([
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
  ]);

  const taxBundle = await getClientTaxSettings(ctx, id);
  const settings = taxBundle.settings;

  const hasVehicles = Boolean(
    (accountingSettings as { has_vehicles?: boolean | null } | null)?.has_vehicles
  );
  const fleet = hasVehicles ? await loadVehicleFleet(orgId, id) : [];

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

  const accounting_rows: ClientQuickProfileRow[] = [
    buildQuickProfileInfoRow({
      key: 'income_software',
      label_he: 'הכנסות',
      display_value: incomeSoftware,
      visible: true,
    }),
  ];

  // Baseline = prior Jerusalem month (advances + aggregate metadata).
  // VAT / deductions select obligation-specific periods — see pure helpers.
  const reportingPeriodKey = resolveOperationalReportingPeriodKey();
  const vatReportingPeriodKey = resolveVatOperationalReportingPeriodKey({
    vat_frequency: settings.vat_frequency,
  });
  const deductionsPeriod = resolveIncomeTaxDeductionsOperationalReportingPeriodKey({
    frequency: settings.income_tax_deductions_frequency,
  });
  const reporting_rows: ClientQuickProfileRow[] = [];

  if (reportingPeriodKey || vatReportingPeriodKey || deductionsPeriod.applicable) {
    const asOf = new Date().toISOString().slice(0, 10);
    const orgRuleset = await resolveOrganizationActiveRuleset(orgId, asOf);
    const countryCode = String(orgRuleset.country_code ?? '')
      .trim()
      .toUpperCase();
    const rulesetId = orgRuleset.ruleset_id;

    if (vatReportingPeriodKey) {
      const vatResolution = await resolveClientVatReportingDueDate({
        country_code: countryCode,
        reporting_period_key: vatReportingPeriodKey,
        vat_type: settings.vat_type,
        vat_due_type: settings.vat_due_type,
        vat_frequency: settings.vat_frequency,
        country_pack_ruleset_id: rulesetId,
      });

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

    // Advances: CO obligations use previous calendar month; frequency is not used for period pick.
    if (settings.income_tax_advance_enabled && reportingPeriodKey) {
      const advances = await resolveClientIncomeTaxAdvancesDueDate({
        country_code: countryCode,
        reporting_period_key: reportingPeriodKey,
        income_tax_advance_enabled: true,
        country_pack_ruleset_id: rulesetId,
      });
      reporting_rows.push(
        buildQuickProfileInfoRow({
          key: 'income_tax_advances_due_date',
          label_he: 'תאריך דיווח מקדמות מס הכנסה',
          display_value: displayFromResolution(advances),
          visible: true,
        })
      );
    }

    if (
      settings.income_tax_deductions_enabled &&
      deductionsPeriod.applicable &&
      deductionsPeriod.reporting_period_key
    ) {
      const deductions = await resolveClientIncomeTaxDeductionsDueDate({
        country_code: countryCode,
        reporting_period_key: deductionsPeriod.reporting_period_key,
        country_pack_ruleset_id: rulesetId,
      });
      reporting_rows.push(
        buildQuickProfileInfoRow({
          key: 'income_tax_deductions_due_date',
          label_he: 'תאריך דיווח מס הכנסה ניכויים',
          display_value: displayFromResolution(deductions),
          visible: true,
        })
      );
    }

    const niFile = String(settings.national_insurance_deductions_file_number ?? '').trim();
    const niApplicable =
      payrollFlag || Boolean(niFile) || settings.income_tax_deductions_enabled;
    if (niApplicable && reportingPeriodKey) {
      const ni = await resolveNationalInsuranceDeductionsDueDate({
        country_code: countryCode,
        reporting_period_key: reportingPeriodKey,
      });
      // Never invent / never alias Tax Authority dates. Show only if ACTIVE date exists.
      if (ni.resolved) {
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
