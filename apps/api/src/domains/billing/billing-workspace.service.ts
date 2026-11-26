import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import { RBAC_PERMISSIONS, requireRbacPermission } from '../rbac/rbac.service.js';
import { resolvePersistedUiLanguage } from '../platform-localization/platform-localization.pure.js';
import { resolveStaffSeatEntitlement } from '../modules/staff-seat-entitlement.service.js';
import { supabaseEmbedOne } from '../../shared/supabase-embed.js';
import { applyAuthoritativeSellerVat, resolvePlatformSellerVat } from './platform-seller-vat.service.js';
import {
  buildStaffSeatPurchaseQuote,
  formatSeatMoneyAmount,
  nextPurchasedSeatQuantity,
} from '../payments/staff-seat-purchase-quote.pure.js';
import { buildOfficePaymentsAggregate } from '../payments/payment-infrastructure.service.js';
import type { ModulePurchaseQuote } from './module-purchase.pure.js';
import { BILLING_TABS, billingCopy, billingUiLang } from './billing-copy.pure.js';

export const BILLING_WORKSPACE_KEY = 'billing_workspace_aggregate';

function assertBillingReader(ctx: RequestContext, orgId: string) {
  if (ctx.organizationId !== orgId) throw forbidden('Organization context required');
  requireRbacPermission(ctx, orgId, RBAC_PERMISSIONS.access_billing);
}

function formatAddress(s: {
  address_line_1?: string | null;
  address_line_2?: string | null;
  city?: string | null;
  postal_code?: string | null;
}): string | null {
  const parts = [s.address_line_1, s.address_line_2, s.city, s.postal_code]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

async function loadPlatformSellerVat() {
  const asOfDate = new Date().toISOString().slice(0, 10);
  return resolvePlatformSellerVat(asOfDate);
}

function dateLabel(raw: string | null | undefined): string {
  const value = String(raw ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}


export async function buildBillingWorkspaceAggregate(ctx: RequestContext, orgId: string) {
  const started = Date.now();
  assertBillingReader(ctx, orgId);
  const lang = billingUiLang(resolvePersistedUiLanguage(ctx.user.uiLanguage));
  const copy = billingCopy(lang);
  const [seats, orgRes, settingsRes, subsRes] = await Promise.all([
    resolveStaffSeatEntitlement(orgId),
    supabaseAdmin.from('organizations').select('name, legal_name, country_code').eq('id', orgId).maybeSingle(),
    supabaseAdmin
      .from('organization_settings')
      .select('organization_name, legal_id_number, address_line_1, address_line_2, city, postal_code, phone, country')
      .eq('organization_id', orgId)
      .maybeSingle(),
    supabaseAdmin
      .from('organization_module_subscriptions')
      .select('status, modules(name, is_system)')
      .eq('organization_id', orgId)
      .in('status', ['active', 'trialing']),
  ]);
  const currency = seats.commercial_currency || seats.seat_currency || 'ILS';
  const net = Number(seats.commercial_recurring_total_amount) || 0;
  const moduleRows = (subsRes.data ?? [])
    .map((row) => {
      const module = supabaseEmbedOne((row as { modules?: unknown }).modules) as { name?: string; is_system?: boolean } | null;
      if (module?.is_system) return null;
      return { name: module?.name ?? '' };
    })
    .filter((row): row is { name: string } => Boolean(row && row.name));
  const settings = (settingsRes.data ?? {}) as Record<string, string | null>;
  const org = orgRes.data as { name?: string; legal_name?: string | null; country_code?: string } | null;

  return {
    aggregate_key: BILLING_WORKSPACE_KEY,
    organization_id: orgId,
    ui: {
      locale: lang,
      direction: lang === 'he' ? 'rtl' : 'ltr',
      text: copy,
      tabs: BILLING_TABS.map((tab) => ({ id: tab.id, label: copy[tab.label_key] })),
    },
    seller_context: 'nodexpro_platform' as const,
    checkout_available: false,
    overview: {
      active_modules: moduleRows,
      occupied_staff_seats: seats.active_consumed_staff_seats,
      available_staff_seats: seats.available_staff_seats,
      subscription_net_label: formatSeatMoneyAmount(net, currency),
      next_payment_label: copy.next_payment_unconfigured,
      payment_status_label: copy.payment_status_unconfigured,
    },
    billing_details: {
      legal_name: org?.legal_name || settings.organization_name || org?.name || null,
      registration_number: settings.legal_id_number ?? null,
      address: formatAddress(settings),
      email: ctx.user.email ?? null,
      country: org?.country_code || settings.country || null,
      currency,
      phone: settings.phone ?? null,
      note: copy.payer_note,
      edit_href: '/settings',
      can_edit: ctx.membership?.roleCode === 'owner',
    },
    payment_method: {
      configured: false,
      label: copy.payment_method_unconfigured,
    },
    timing: {
      load_ms: Date.now() - started,
      source: 'billing_workspace',
    },
  };
}

export async function buildBillingModulesAggregate(
  ctx: RequestContext,
  orgId: string,
  options?: { quote?: ModulePurchaseQuote },
) {
  const started = Date.now();
  assertBillingReader(ctx, orgId);
  const lang = billingUiLang(resolvePersistedUiLanguage(ctx.user.uiLanguage));
  const copy = billingCopy(lang);
  const [subsRes, modulesRes, plansRes, intentsRes] = await Promise.all([
    supabaseAdmin
      .from('organization_module_subscriptions')
      .select(
        'module_id, module_plan_id, status, started_at, ends_at, module_plans(name, code, currency, price_amount, billing_period), modules(name, is_system, code)',
      )
      .eq('organization_id', orgId),
    supabaseAdmin
      .from('modules')
      .select('id, code, name, is_system, is_active')
      .eq('is_active', true)
      .eq('is_system', false),
    supabaseAdmin
      .from('module_plans')
      .select('id, module_id, code, name, billing_period, currency, price_amount, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('module_purchase_intents')
      .select('id, module_id, module_plan_id, status')
      .eq('organization_id', orgId)
      .in('status', ['quoted', 'pending_payment']),
  ]);
  const subByModule = new Map(
    (subsRes.data ?? []).map((row) => [String((row as { module_id: string }).module_id), row]),
  );
  const plansByModule = new Map<string, typeof plansRes.data>();
  for (const plan of plansRes.data ?? []) {
    const list = plansByModule.get(plan.module_id) ?? [];
    list.push(plan);
    plansByModule.set(plan.module_id, list);
  }
  const intentByModule = new Map(
    (intentsRes.data ?? []).map((row) => [String((row as { module_id: string }).module_id), row]),
  );
  const subscriptions = (subsRes.data ?? [])
    .map((row) => {
      const module = supabaseEmbedOne((row as { modules?: unknown }).modules) as {
        name?: string;
        is_system?: boolean;
        code?: string;
      } | null;
      if (module?.is_system) return null;
      const plan = supabaseEmbedOne((row as { module_plans?: unknown }).module_plans) as {
        name?: string;
        currency?: string;
        price_amount?: number;
        billing_period?: string;
      } | null;
      return {
        module_id: (row as { module_id: string }).module_id,
        name: module?.name ?? '',
        plan_name: plan?.name ?? '',
        price_label: formatSeatMoneyAmount(Number(plan?.price_amount) || 0, plan?.currency || 'ILS'),
        period_label: plan?.billing_period === 'year' ? copy.period_year : copy.period_month,
        started_at: dateLabel((row as { started_at?: string }).started_at) || '—',
        status_label:
          (row as { status?: string }).status === 'trialing'
            ? copy.status_trial
            : (row as { status?: string }).status === 'active'
              ? copy.status_active
              : copy.status,
      };
    })
    .filter(Boolean);
  const offers = (modulesRes.data ?? [])
    .filter((module) => !subByModule.has(module.id))
    .map((module) => ({
      module_id: module.id,
      name: module.name,
      plans: (plansByModule.get(module.id) ?? []).map((plan) => ({
        module_plan_id: plan.id,
        name: plan.name,
        price_label: formatSeatMoneyAmount(Number(plan.price_amount) || 0, plan.currency),
        period_label: plan.billing_period === 'year' ? copy.period_year : copy.period_month,
        quote_enabled: true,
        pay_enabled: false,
      })),
      open_intent: intentByModule.get(module.id)
        ? { id: (intentByModule.get(module.id) as { id: string }).id, label: copy.unpaid_request }
        : null,
    }));
  return {
    aggregate_key: 'billing_modules_aggregate',
    organization_id: orgId,
    ui: { locale: lang, direction: lang === 'he' ? 'rtl' : 'ltr', text: copy },
    checkout_available: false,
    subscriptions,
    offers,
    quote: options?.quote
      ? {
          ...options.quote,
          labels: {
            ...options.quote.labels,
            vat: options.quote.vat_authoritative ? options.quote.labels.vat : copy.vat_not_configured,
            total: options.quote.vat_authoritative ? options.quote.labels.total : copy.vat_not_configured,
          },
        }
      : null,
    available_commands: {
      quote_module_purchase: { enabled: true },
      create_module_purchase_intent: { enabled: true },
      cancel_module_purchase_intent: { enabled: Boolean(intentsRes.data?.length) },
      pay: { enabled: false },
    },
    timing: { load_ms: Date.now() - started, source: 'billing_modules' },
  };
}

export async function buildBillingStaffLicensesAggregate(
  ctx: RequestContext,
  orgId: string,
  options?: { quoteQuantity?: number },
) {
  const started = Date.now();
  assertBillingReader(ctx, orgId);
  const lang = billingUiLang(resolvePersistedUiLanguage(ctx.user.uiLanguage));
  const copy = billingCopy(lang);
  const [seats, vat, openIntent] = await Promise.all([
    resolveStaffSeatEntitlement(orgId),
    loadPlatformSellerVat(),
    supabaseAdmin
      .from('staff_seat_purchase_intents')
      .select('id, status, quantity')
      .eq('organization_id', orgId)
      .in('status', ['quoted', 'pending_payment'])
      .maybeSingle()
      .then((res) => (res.error ? null : res.data)),
  ]);
  const vatAuthoritative = vat.authoritative && vat.source === 'country_pack';
  const appliedVat = applyAuthoritativeSellerVat(vat);
  const quantity = options?.quoteQuantity ?? (Number(openIntent?.quantity) || 1);
  const quote = buildStaffSeatPurchaseQuote({
    quantity,
    catalogUnitPrice: Number(seats.list_unit_price_amount ?? 0),
    officeCurrentUnitPrice: seats.current_terms_unit_price_amount ?? null,
    currency: seats.seat_currency,
    billingPeriod: seats.seat_billing_period,
    vatRate: appliedVat.vatRate,
    vatPercentLabel: appliedVat.vatPercentLabel,
  });
  const recurringAfter = nextPurchasedSeatQuantity(seats.purchased_staff_seats, quote.quantity) * quote.unit_price_net;
  const canWrite = ctx.membership?.roleCode === 'owner' || ctx.membership?.roleCode === 'admin';
  return {
    aggregate_key: 'billing_staff_licenses_aggregate',
    organization_id: orgId,
    ui: { locale: lang, direction: lang === 'he' ? 'rtl' : 'ltr', text: copy },
    checkout_available: false,
    seats: {
      included_staff_seats: seats.included_staff_seats,
      grandfathered_staff_seats: seats.grandfathered_staff_seats,
      purchased_additional_staff_seats: seats.purchased_staff_seats,
      occupied_staff_seats: seats.active_consumed_staff_seats,
      available_staff_seats: seats.available_staff_seats,
    },
    pricing: {
      current_contract_label:
        seats.current_terms_unit_price_amount != null
          ? formatSeatMoneyAmount(Number(seats.current_terms_unit_price_amount), seats.seat_currency)
          : copy.no_contract_rate,
      current_contract_note: copy.staff_contract_note,
      catalog_list_label: formatSeatMoneyAmount(Number(seats.list_unit_price_amount ?? 0), seats.seat_currency),
      catalog_list_note: copy.staff_catalog_note,
      quote_source_note:
        quote.price_source === 'office_commercial_terms' ? copy.quote_uses_contract : copy.quote_uses_catalog,
    },
    purchase_quote: {
      ...quote,
      vat_authoritative: vatAuthoritative,
      checkout_available: false as const,
      pay_enabled: false as const,
      legal_rule_version_id: vat.legal_value_version_id,
      unresolved_reason: vat.unresolved_reason,
      labels: {
        unit: formatSeatMoneyAmount(quote.unit_price_net, quote.currency),
        net: formatSeatMoneyAmount(quote.net_amount, quote.currency),
        vat_rate: vatAuthoritative ? vat.standard_rate_percent_label : copy.not_configured,
        vat: vatAuthoritative ? formatSeatMoneyAmount(quote.vat_amount, quote.currency) : copy.not_configured,
        total: vatAuthoritative ? formatSeatMoneyAmount(quote.total_amount, quote.currency) : copy.total_unavailable,
        recurring_after: formatSeatMoneyAmount(recurringAfter, quote.currency),
      },
    },
    open_intent: openIntent ? { id: openIntent.id, status: openIntent.status, quantity: Number(openIntent.quantity) || quantity } : null,
    available_commands: {
      quote_staff_seat_purchase: { enabled: canWrite },
      create_staff_seat_purchase_intent: { enabled: false },
      cancel_staff_seat_purchase_intent: { enabled: false },
      pay: { enabled: false, disabled_reason: copy.checkout_unavailable },
    },
    timing: { load_ms: Date.now() - started, source: 'billing_staff_licenses' },
  };
}

export async function buildBillingPlatformPaymentsAggregate(ctx: RequestContext, orgId: string) {
  const started = Date.now();
  assertBillingReader(ctx, orgId);
  const lang = billingUiLang(resolvePersistedUiLanguage(ctx.user.uiLanguage));
  const copy = billingCopy(lang);
  const [{ data: transactions }, { data: subscriptions }] = await Promise.all([
    supabaseAdmin
      .from('payment_transactions')
      .select('id, status, amount, currency, created_at, seller_context')
      .eq('organization_id', orgId)
      .eq('seller_context', 'nodexpro_platform')
      .order('created_at', { ascending: false })
      .limit(50),
    supabaseAdmin
      .from('platform_billing_subscriptions')
      .select('kind, status, quantity, currency, billing_period, current_period_end')
      .eq('organization_id', orgId),
  ]);
  return {
    aggregate_key: 'billing_platform_payments_aggregate',
    organization_id: orgId,
    ui: { locale: lang, direction: lang === 'he' ? 'rtl' : 'ltr', text: copy },
    seller_context: 'nodexpro_platform' as const,
    note: copy.platform_seller_note,
    checkout_available: false,
    rows: (transactions ?? []).map((row) => ({
      id: row.id,
      date_label: dateLabel(row.created_at as string) || '—',
      amount_label: formatSeatMoneyAmount(Number(row.amount) || 0, String(row.currency || 'ILS')),
      status_label: String(row.status) === 'verified' ? copy.paid : copy.recorded,
    })),
    empty: !(transactions?.length || subscriptions?.length),
    empty_label: copy.platform_payments_empty,
    timing: { load_ms: Date.now() - started, source: 'billing_platform_payments' },
  };
}

export async function loadOfficePaymentsForBilling(ctx: RequestContext, orgId: string) {
  assertBillingReader(ctx, orgId);
  return buildOfficePaymentsAggregate(ctx, orgId);
}
