/**
 * Work Engine — invoice retainer setup aggregate.
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import { incomeWorkspacePermissionsFromContext } from '../income/income-issuer-context.service.js';
import { RECURRING_SCHEDULER_STATUS, RECURRING_WORK_EVENT_TYPE, RECURRING_WORK_TYPE, computeDraftCreationDateIso, computeNextUnitPriceBeforeVat, formatHebrewDateDisplay, } from './work-engine-invoice-retainer.pure.js';
import { WORK_ENGINE_INVOICE_RETAINER_SETUP_AGGREGATE_KEY, } from './work-engine-invoice-retainer.types.js';
const DOCUMENT_TYPE_LABELS = {
    quote: 'הצעת מחיר',
    deal_invoice: 'חשבון עסקה',
    tax_invoice: 'חשבונית מס',
};
const FREQUENCY_LABELS = {
    monthly: 'חודשי',
    semi_annual: 'חצי שנתי',
    yearly: 'שנתי',
};
const STATUS_LABELS = {
    active: 'פעיל',
    paused: 'מושהה',
    cancelled: 'בוטל',
};
const DOCUMENT_TYPE_OPTIONS = [
    { key: 'deal_invoice', label: DOCUMENT_TYPE_LABELS.deal_invoice, enabled: true },
    { key: 'quote', label: DOCUMENT_TYPE_LABELS.quote, enabled: true },
    { key: 'tax_invoice', label: DOCUMENT_TYPE_LABELS.tax_invoice, enabled: true },
];
const FREQUENCY_OPTIONS = Object.keys(FREQUENCY_LABELS).map((key) => ({
    key,
    label: FREQUENCY_LABELS[key],
}));
function assertAccess(ctx) {
    const perms = incomeWorkspacePermissionsFromContext(ctx);
    if (!perms.view)
        throw forbidden('income.view required');
    if (!perms.issue_on_behalf)
        throw forbidden('income.issue_on_behalf required');
}
async function loadOfficeClient(orgId, clientId) {
    const { data, error } = await supabaseAdmin
        .from('clients')
        .select('id, display_name, is_archived')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadRetainerOfficeClient');
    const row = data;
    if (!row || row.is_archived)
        throw notFound('Office client not found');
    return row;
}
async function loadEndCustomers(orgId, representedClientId) {
    const { data, error } = await supabaseAdmin
        .from('income_customers')
        .select('id, display_name, email, tax_id, status')
        .eq('organization_id', orgId)
        .eq('represented_client_id', representedClientId)
        .eq('issuer_business_id', representedClientId)
        .eq('status', 'active')
        .order('display_name', { ascending: true })
        .limit(5000);
    throwIfSupabaseError(error, 'loadRetainerEndCustomers');
    return (data ?? []);
}
async function loadProfiles(orgId, representedClientId) {
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .select('id, end_customer_id, document_type, frequency, next_document_date, advance_days, service_period_start, service_period_end, auto_advance_period, line_description_template, quantity, unit_price_before_vat_reference, currency, discount_percent_reference, discount_amount_reference, price_increase_enabled, price_increase_type, price_increase_value, status')
        .eq('organization_id', orgId)
        .eq('represented_client_id', representedClientId)
        .eq('issuer_business_id', representedClientId)
        .eq('acting_mode', 'office_representative')
        .neq('status', 'cancelled')
        .order('updated_at', { ascending: false })
        .limit(5000);
    throwIfSupabaseError(error, 'loadRetainerProfiles');
    return (data ?? []);
}
function buildProfileSummary(profile) {
    return `${DOCUMENT_TYPE_LABELS[profile.document_type]} · ${FREQUENCY_LABELS[profile.frequency]} · ${formatHebrewDateDisplay(profile.next_document_date)}`;
}
function formatIsoDefault(dt) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function buildProfileForm(profile, endCustomer, defaults) {
    const today = new Date();
    const defaultNext = formatIsoDefault(today);
    const documentType = profile?.document_type ?? 'deal_invoice';
    const frequency = profile?.frequency ?? 'yearly';
    const nextDocumentDate = profile?.next_document_date ?? defaultNext;
    const advanceDays = profile?.advance_days ?? defaults.advance_days;
    const unitPrice = profile?.unit_price_before_vat_reference ?? 0;
    const currency = profile?.currency ?? defaults.currency;
    const priceIncreaseEnabled = profile?.price_increase_enabled ?? false;
    const priceIncreaseType = profile?.price_increase_type ?? null;
    const priceIncreaseValue = profile?.price_increase_value ?? null;
    const nextCyclePrice = computeNextUnitPriceBeforeVat({
        current_unit_price_before_vat_reference: unitPrice,
        price_increase_enabled: priceIncreaseEnabled,
        price_increase_type: priceIncreaseType,
        price_increase_value: priceIncreaseValue,
    });
    return {
        profile_id: profile?.id ?? null,
        end_customer_id: endCustomer.id,
        end_customer_display_name: endCustomer.display_name,
        document_type: documentType,
        document_type_label: DOCUMENT_TYPE_LABELS[documentType],
        frequency,
        frequency_label: FREQUENCY_LABELS[frequency],
        next_document_date: nextDocumentDate,
        next_document_date_display: formatHebrewDateDisplay(nextDocumentDate),
        advance_days: advanceDays,
        draft_creation_date: computeDraftCreationDateIso(nextDocumentDate, advanceDays),
        draft_creation_date_display: formatHebrewDateDisplay(computeDraftCreationDateIso(nextDocumentDate, advanceDays)),
        service_period_start: profile?.service_period_start ?? defaultNext,
        service_period_start_display: formatHebrewDateDisplay(profile?.service_period_start ?? defaultNext),
        service_period_end: profile?.service_period_end ?? defaultNext,
        service_period_end_display: formatHebrewDateDisplay(profile?.service_period_end ?? defaultNext),
        auto_advance_period: profile?.auto_advance_period ?? defaults.auto_advance_period,
        line_description_template: profile?.line_description_template ?? '',
        quantity: profile?.quantity ?? defaults.quantity,
        unit_price_before_vat_reference: unitPrice,
        unit_price_before_vat_display: formatMoneyReference(unitPrice, currency),
        currency,
        discount_percent_reference: profile?.discount_percent_reference ?? null,
        discount_amount_reference: profile?.discount_amount_reference ?? null,
        price_increase_enabled: priceIncreaseEnabled,
        price_increase_type: priceIncreaseType,
        price_increase_value: priceIncreaseValue,
        next_cycle_unit_price_before_vat_reference: priceIncreaseEnabled ? nextCyclePrice : null,
        next_cycle_unit_price_before_vat_display: priceIncreaseEnabled
            ? formatMoneyReference(nextCyclePrice, currency)
            : null,
        status: profile?.status ?? 'active',
        status_label: STATUS_LABELS[profile?.status ?? 'active'],
        vat_note: 'חישוב מע״מ יתבצע בהפקת המסמך לפי מדיניות Income הקיימת.',
    };
}
export async function buildWorkEngineInvoiceRetainerSetupAggregate(params) {
    const orgId = params.ctx.organizationId;
    if (!orgId)
        throw forbidden('Organization context required');
    assertAccess(params.ctx);
    const representedClientId = String(params.representedClientId ?? '').trim();
    if (!representedClientId)
        throw badRequest('represented_client_id is required');
    const perms = incomeWorkspacePermissionsFromContext(params.ctx);
    const client = await loadOfficeClient(orgId, representedClientId);
    const [customers, profiles] = await Promise.all([
        loadEndCustomers(orgId, representedClientId),
        loadProfiles(orgId, representedClientId),
    ]);
    const profileByCustomerId = new Map();
    for (const profile of profiles) {
        if (!profileByCustomerId.has(profile.end_customer_id)) {
            profileByCustomerId.set(profile.end_customer_id, profile);
        }
    }
    const customerNameById = new Map(customers.map((c) => [c.id, c.display_name]));
    const endCustomers = customers.map((customer) => {
        const profile = profileByCustomerId.get(customer.id) ?? null;
        return {
            end_customer_id: customer.id,
            display_name: customer.display_name,
            email: customer.email,
            tax_id: customer.tax_id,
            selectable: true,
            recurring_profile_id: profile?.id ?? null,
            profile_status: profile?.status ?? null,
            profile_status_label: profile ? STATUS_LABELS[profile.status] : null,
            profile_summary: profile ? buildProfileSummary(profile) : null,
        };
    });
    const defaultValues = {
        advance_days: 30,
        currency: 'ILS',
        auto_advance_period: true,
        quantity: 1,
    };
    const selectedEndCustomerId = params.endCustomerId?.trim() || null;
    let profileForm = null;
    if (selectedEndCustomerId) {
        const customer = customers.find((c) => c.id === selectedEndCustomerId);
        if (!customer)
            throw badRequest('end_customer_id is not eligible');
        profileForm = buildProfileForm(profileByCustomerId.get(customer.id) ?? null, customer, defaultValues);
    }
    const allowedActions = ['view_invoice_retainer_setup'];
    if (perms.edit) {
        allowedActions.push('create_income_recurring_document_profile', 'update_income_recurring_document_profile', 'pause_income_recurring_document_profile', 'resume_income_recurring_document_profile', 'cancel_income_recurring_document_profile');
    }
    return {
        aggregate_key: WORK_ENGINE_INVOICE_RETAINER_SETUP_AGGREGATE_KEY,
        represented_client_id: representedClientId,
        client_display_name: client.display_name,
        selected_end_customer_id: selectedEndCustomerId,
        end_customers: endCustomers,
        profile: profileForm,
        recurring_profiles: profiles.map((profile) => ({
            profile_id: profile.id,
            end_customer_id: profile.end_customer_id,
            end_customer_display_name: customerNameById.get(profile.end_customer_id) ?? profile.end_customer_id,
            document_type_label: DOCUMENT_TYPE_LABELS[profile.document_type],
            frequency_label: FREQUENCY_LABELS[profile.frequency],
            status: profile.status,
            status_label: STATUS_LABELS[profile.status],
            next_document_date_display: formatHebrewDateDisplay(profile.next_document_date),
        })),
        document_type_options: DOCUMENT_TYPE_OPTIONS,
        frequency_options: FREQUENCY_OPTIONS,
        default_values: defaultValues,
        allowed_actions: allowedActions,
        scheduler_status: RECURRING_SCHEDULER_STATUS,
        scheduler_note: 'יצירת טיוטות אוטומטית תתבצע על ידי Scheduler (ממתין להפעלה). לא נשלח מסמך ללא אישור רואה חשבון.',
        work_engine_event_type: RECURRING_WORK_EVENT_TYPE,
        work_type: RECURRING_WORK_TYPE,
    };
}
