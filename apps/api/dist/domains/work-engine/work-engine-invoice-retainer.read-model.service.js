/**
 * Work Engine — invoice retainer setup aggregate.
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import { incomeWorkspacePermissionsFromContext } from '../income/income-issuer-context.service.js';
import { ensureRetainerDocumentDraftWorkspace, } from './work-engine-invoice-retainer-draft.service.js';
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
function buildOfficeRepresentativeIssuerScope(orgId, actorUserId, representedClientId, permissions) {
    return {
        org_id: orgId,
        actor_user_id: actorUserId,
        acting_mode: 'office_representative',
        issuer_business_id: representedClientId,
        represented_client_id: representedClientId,
        issuer_label: '',
        represented_client_label: '',
        permissions,
    };
}
/** Same scope/filters as income workspace customers_table_model (document wizard / end-customers). */
async function loadEndCustomers(scope) {
    const { data, error } = await supabaseAdmin
        .from('income_customers')
        .select('id, display_name, email, tax_id, status')
        .eq('organization_id', scope.org_id)
        .eq('issuer_business_id', scope.issuer_business_id)
        .eq('represented_client_id', scope.represented_client_id ?? '')
        .eq('status', 'active')
        .order('display_name', { ascending: true })
        .limit(5000);
    throwIfSupabaseError(error, 'loadRetainerEndCustomers');
    return (data ?? []);
}
async function loadProfiles(orgId, representedClientId) {
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .select('id, end_customer_id, document_type, frequency, next_document_date, advance_days, service_period_start, service_period_end, auto_advance_period, unit_price_before_vat_reference, currency, price_increase_enabled, price_increase_type, price_increase_value, status, source_draft_template_id, document_template_snapshot')
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
function settingValueFromWorkspace(workspace, key) {
    const field = workspace?.income_workspace_aggregate.document_details_step?.settings_schema.find((f) => f.key === key);
    return field?.value ?? null;
}
function buildRetainerSettings(profile, endCustomer, defaults, workspace) {
    const today = formatIsoDefault(new Date());
    const frequency = profile?.frequency ?? 'yearly';
    const advanceDays = profile?.advance_days ?? defaults.advance_days;
    const documentDate = settingValueFromWorkspace(workspace, 'document_date') ??
        profile?.next_document_date ??
        today;
    const unitPrice = profile?.unit_price_before_vat_reference ?? 0;
    const currency = profile?.currency ?? 'ILS';
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
        source_draft_template_id: workspace?.income_workspace_aggregate.active_wizard_draft_id ??
            profile?.source_draft_template_id ??
            null,
        document_template_snapshot: profile?.document_template_snapshot ?? null,
        frequency,
        frequency_label: FREQUENCY_LABELS[frequency],
        advance_days: advanceDays,
        draft_creation_date_display: formatHebrewDateDisplay(computeDraftCreationDateIso(documentDate, advanceDays)),
        service_period_start: profile?.service_period_start ?? today,
        service_period_start_display: formatHebrewDateDisplay(profile?.service_period_start ?? today),
        service_period_end: profile?.service_period_end ?? today,
        service_period_end_display: formatHebrewDateDisplay(profile?.service_period_end ?? today),
        auto_advance_period: profile?.auto_advance_period ?? defaults.auto_advance_period,
        price_increase_enabled: priceIncreaseEnabled,
        price_increase_type: priceIncreaseType,
        price_increase_value: priceIncreaseValue,
        next_cycle_unit_price_before_vat_display: priceIncreaseEnabled
            ? formatMoneyReference(nextCyclePrice, currency)
            : null,
        status: profile?.status ?? 'active',
        status_label: STATUS_LABELS[profile?.status ?? 'active'],
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
    const issuerScope = buildOfficeRepresentativeIssuerScope(orgId, params.ctx.user.id, representedClientId, perms);
    const customers = await loadEndCustomers(issuerScope);
    let profiles = [];
    try {
        profiles = await loadProfiles(orgId, representedClientId);
    }
    catch (e) {
        console.warn('[work-engine] loadRetainerProfiles failed; customer picker still available', e);
    }
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
        auto_advance_period: true,
    };
    const selectedEndCustomerId = params.endCustomerId?.trim() || null;
    let documentDraftWorkspace = null;
    let retainerSettings = null;
    if (selectedEndCustomerId) {
        const customer = customers.find((c) => c.id === selectedEndCustomerId);
        if (!customer)
            throw badRequest('end_customer_id is not eligible');
        const profile = profileByCustomerId.get(customer.id) ?? null;
        documentDraftWorkspace = await ensureRetainerDocumentDraftWorkspace({
            ctx: params.ctx,
            representedClientId,
            endCustomerId: customer.id,
            sourceDraftTemplateId: profile?.source_draft_template_id,
            fallbackDocumentType: (profile?.document_type ?? 'deal_invoice'),
        });
        retainerSettings = buildRetainerSettings(profile, customer, defaultValues, documentDraftWorkspace);
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
        document_draft_workspace: documentDraftWorkspace,
        retainer_settings: retainerSettings,
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
        frequency_options: FREQUENCY_OPTIONS,
        default_values: defaultValues,
        allowed_actions: allowedActions,
        scheduler_status: RECURRING_SCHEDULER_STATUS,
        scheduler_note: 'יצירת טיוטות אוטומטית תתבצע על ידי Scheduler (ממתין להפעלה). לא נשלח מסמך ללא אישור רואה חשבון.',
        work_engine_event_type: RECURRING_WORK_EVENT_TYPE,
        work_type: RECURRING_WORK_TYPE,
    };
}
