/**
 * Work Engine — invoice retainer setup aggregate.
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { formatMoneyReference } from '../income/income-document-draft-lines.pure.js';
import { incomeWorkspacePermissionsFromContext } from '../income/income-issuer-context.service.js';
import { resolveAvailableDocumentTypes } from '../income/income-document-types.resolver.js';
import { logAggregatePayloadBreakdown } from '../../shared/aggregate-payload-metrics.js';
import { ensureRetainerDocumentDraftWorkspace, } from './work-engine-invoice-retainer-draft.service.js';
import { loadDocumentNumbersById, loadRecurringProfileCycles, RECURRING_CYCLE_STATUS_LABELS, } from './work-engine-invoice-retainer-cycles.service.js';
import { RECURRING_SCHEDULER_STATUS_ACTIVE, RECURRING_SCHEDULER_STATUS_FAILED, RECURRING_WORK_EVENT_TYPE, RECURRING_WORK_TYPE, RECURRING_FREQUENCY_LABELS, RECURRING_FREQUENCY_OPTIONS, computeDraftCreationDateIso, computeNextUnitPriceBeforeVat, formatHebrewDateDisplay, } from './work-engine-invoice-retainer.pure.js';
import { WORK_ENGINE_INVOICE_RETAINER_SETUP_AGGREGATE_KEY, } from './work-engine-invoice-retainer.types.js';
const DOCUMENT_TYPE_LABELS = {
    quote: 'הצעת מחיר',
    deal_invoice: 'חשבון עסקה',
    tax_invoice: 'חשבונית מס',
};
const FREQUENCY_LABELS = RECURRING_FREQUENCY_LABELS;
const STATUS_LABELS = {
    active: 'פעיל',
    paused: 'מושהה',
    cancelled: 'מבוטל',
};
const STATUS_DESCRIPTIONS = {
    active: 'הריטיינר ייצור טיוטות לפי התזמון',
    paused: 'לא ייווצרו טיוטות עד להפעלה מחדש',
    cancelled: 'הריטיינר נסגר ולא יפעל',
};
const ADVANCE_CREATION_HELP_TEXT = 'כמה ימים לפני תאריך המסמך ליצור טיוטה לבדיקה';
const DRAFT_CREATION_DATE_LABEL = 'תאריך יצירת טיוטה צפוי';
const DOCUMENT_TYPE_CHANGE_NOTE = 'שינוי סוג מסמך יחול על טיוטות עתידיות בלבד. מסמכים שכבר הופקו לא ישתנו.';
const FREQUENCY_OPTIONS = RECURRING_FREQUENCY_OPTIONS.filter((option) => option.key !== 'monthly');
function logRetainerSetupTiming(representedClientId, endCustomerId, label, startMs) {
    const elapsedMs = Date.now() - startMs;
    console.info(`[work-engine][invoice-retainer-setup] client=${representedClientId} end_customer=${endCustomerId ?? 'none'} ${label}: ${elapsedMs}ms`);
    return Date.now();
}
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
        .select('id, end_customer_id, document_type, frequency, next_document_date, advance_days, service_period_start, service_period_end, auto_advance_period, unit_price_before_vat_reference, currency, price_increase_enabled, price_increase_type, price_increase_value, status, source_draft_template_id, document_template_snapshot, last_generated_draft_id, last_generated_at, last_generation_failed_at, last_generation_error_code, last_generation_error_message')
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
function profileSchedulerFailed(profile) {
    if (!profile?.last_generation_error_code)
        return false;
    if (!profile.last_generated_at)
        return true;
    if (!profile.last_generation_failed_at)
        return false;
    return profile.last_generation_failed_at > profile.last_generated_at;
}
function resolveSchedulerStatus(profile) {
    if (profileSchedulerFailed(profile))
        return RECURRING_SCHEDULER_STATUS_FAILED;
    return RECURRING_SCHEDULER_STATUS_ACTIVE;
}
function resolveDocumentTypeFromWorkspace(workspace, profile) {
    const fromStep = workspace?.income_workspace_aggregate.document_details_step?.document_type_key;
    const fromPreview = workspace?.income_workspace_aggregate.document_details_step?.document_preview?.document_type_label;
    if (fromStep === 'quote' || fromStep === 'deal_invoice' || fromStep === 'tax_invoice') {
        return {
            document_type: fromStep,
            document_type_label: fromPreview ?? DOCUMENT_TYPE_LABELS[fromStep],
        };
    }
    const fallback = profile?.document_type ?? 'deal_invoice';
    return {
        document_type: fallback,
        document_type_label: DOCUMENT_TYPE_LABELS[fallback],
    };
}
function buildRetainerSettings(profile, endCustomer, defaults, workspace, override) {
    const today = formatIsoDefault(new Date());
    const frequency = override?.frequency ?? profile?.frequency ?? 'yearly';
    const advanceDays = override?.advance_days ?? profile?.advance_days ?? defaults.advance_days;
    const documentDate = settingValueFromWorkspace(workspace, 'document_date') ??
        profile?.next_document_date ??
        today;
    const unitPrice = profile?.unit_price_before_vat_reference ?? 0;
    const currency = profile?.currency ?? 'ILS';
    const priceIncreaseEnabled = override?.price_increase_enabled ?? profile?.price_increase_enabled ?? false;
    const priceIncreaseType = override?.price_increase_enabled === false
        ? null
        : (override?.price_increase_type ?? profile?.price_increase_type ?? null);
    const priceIncreaseValue = override?.price_increase_enabled === false
        ? null
        : (override?.price_increase_value ?? profile?.price_increase_value ?? null);
    const { document_type, document_type_label } = resolveDocumentTypeFromWorkspace(workspace, profile);
    const status = profile?.status ?? 'active';
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
        document_type,
        document_type_label,
        document_type_change_note: DOCUMENT_TYPE_CHANGE_NOTE,
        frequency,
        frequency_label: FREQUENCY_LABELS[frequency],
        advance_days: advanceDays,
        advance_creation_help_text: ADVANCE_CREATION_HELP_TEXT,
        draft_creation_date_label: DRAFT_CREATION_DATE_LABEL,
        draft_creation_date_display: formatHebrewDateDisplay(computeDraftCreationDateIso(documentDate, advanceDays)),
        service_period_start: override?.service_period_start ?? profile?.service_period_start ?? today,
        service_period_start_display: formatHebrewDateDisplay(override?.service_period_start ?? profile?.service_period_start ?? today),
        service_period_end: override?.service_period_end ?? profile?.service_period_end ?? today,
        service_period_end_display: formatHebrewDateDisplay(override?.service_period_end ?? profile?.service_period_end ?? today),
        auto_advance_period: override?.auto_advance_period ?? profile?.auto_advance_period ?? defaults.auto_advance_period,
        price_increase_enabled: priceIncreaseEnabled,
        price_increase_type: priceIncreaseType,
        price_increase_value: priceIncreaseValue,
        next_cycle_unit_price_before_vat_display: priceIncreaseEnabled
            ? formatMoneyReference(nextCyclePrice, currency)
            : null,
        status,
        status_label: STATUS_LABELS[status],
        status_description: STATUS_DESCRIPTIONS[status],
        next_document_date: profile?.next_document_date ?? documentDate,
        next_document_date_display: formatHebrewDateDisplay(profile?.next_document_date ?? documentDate),
        last_generated_draft_id: profile?.last_generated_draft_id ?? null,
        last_generated_at: profile?.last_generated_at ?? null,
        last_generated_at_display: profile?.last_generated_at
            ? formatHebrewDateDisplay(profile.last_generated_at.slice(0, 10))
            : null,
    };
}
async function buildChildDocumentsHistory(orgId, profileId) {
    if (!profileId)
        return [];
    let cycles = [];
    try {
        cycles = await loadRecurringProfileCycles(orgId, profileId);
    }
    catch (e) {
        console.warn('[work-engine] loadRecurringProfileCycles failed', profileId, e);
        return [];
    }
    const documentIds = cycles
        .map((cycle) => cycle.generated_document_id)
        .filter((id) => Boolean(id));
    const documentNumbers = await loadDocumentNumbersById(orgId, documentIds);
    return cycles.map((cycle) => {
        const allowedActions = [];
        const draftRef = cycle.generated_draft_id
            ? `טיוטה #${cycle.cycle_number}`
            : null;
        const documentRef = cycle.generated_document_id
            ? (documentNumbers.get(cycle.generated_document_id) ?? `מסמך #${cycle.cycle_number}`)
            : null;
        return {
            cycle_id: cycle.id,
            cycle_number: cycle.cycle_number,
            scheduled_document_date_display: formatHebrewDateDisplay(cycle.scheduled_document_date),
            draft_creation_date_display: formatHebrewDateDisplay(cycle.draft_creation_date),
            status: cycle.status,
            status_label: RECURRING_CYCLE_STATUS_LABELS[cycle.status],
            generated_draft_id: cycle.generated_draft_id,
            generated_draft_reference_display: draftRef,
            generated_document_id: cycle.generated_document_id,
            generated_document_reference_display: documentRef,
            failure_reason: cycle.failure_reason,
            allowed_actions: allowedActions,
        };
    });
}
function buildTemplateDraftState(params) {
    const draftId = params.workspace?.income_workspace_aggregate.active_wizard_draft_id;
    if (draftId)
        return null;
    return {
        status: 'missing',
        prompt_message: 'ליצור טיוטת מסמך עכשיו?',
        confirm_begin_label: 'כן, צור טיוטה',
        cancel_label: 'לא עכשיו',
        begin_document_type: params.documentType,
        begin_income_customer_id: params.endCustomerId,
    };
}
function buildSaveProfileWithoutTemplatePrompt(workspace) {
    const draftId = workspace?.income_workspace_aggregate.active_wizard_draft_id;
    if (draftId)
        return null;
    return {
        message: 'ליצור טיוטת מסמך עכשיו?',
        confirm_label: 'כן, צור טיוטה',
        cancel_label: 'לא — שמור הגדרות ריטיינר בלבד',
    };
}
function buildIssueDocumentAction(workspace, canIssue) {
    const draftId = workspace?.income_workspace_aggregate.active_wizard_draft_id;
    if (!draftId || !canIssue)
        return null;
    const allowed = workspace?.income_workspace_aggregate.allowed_actions ?? [];
    if (!allowed.includes('issue_income_document')) {
        return {
            visible: true,
            label: 'הפקת מסמך',
            disabled_reason: 'אין הרשאת הפקה',
        };
    }
    return {
        visible: true,
        label: 'הפקת מסמך',
        disabled_reason: null,
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
    const selectedEndCustomerIdEarly = params.endCustomerId?.trim() || null;
    const aggregateStartMs = Date.now();
    let stepStartMs = aggregateStartMs;
    const perms = incomeWorkspacePermissionsFromContext(params.ctx);
    const client = await loadOfficeClient(orgId, representedClientId);
    stepStartMs = logRetainerSetupTiming(representedClientId, selectedEndCustomerIdEarly, 'load_office_client', stepStartMs);
    const issuerScope = buildOfficeRepresentativeIssuerScope(orgId, params.ctx.user.id, representedClientId, perms);
    const customers = await loadEndCustomers(issuerScope);
    stepStartMs = logRetainerSetupTiming(representedClientId, selectedEndCustomerIdEarly, 'load_end_customers', stepStartMs);
    let profiles = [];
    try {
        profiles = await loadProfiles(orgId, representedClientId);
    }
    catch (e) {
        console.warn('[work-engine] loadRetainerProfiles failed; customer picker still available', e);
    }
    stepStartMs = logRetainerSetupTiming(representedClientId, selectedEndCustomerIdEarly, 'load_profile', stepStartMs);
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
    const selectedEndCustomerId = selectedEndCustomerIdEarly;
    let documentDraftWorkspace = null;
    let retainerSettings = null;
    let documentTypeOptions = [];
    let templateDraft = null;
    let saveProfileWithoutTemplatePrompt = null;
    let issueDocumentAction = null;
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
            onTiming: (label, elapsedMs) => {
                console.info(`[work-engine][invoice-retainer-setup] client=${representedClientId} end_customer=${selectedEndCustomerId} template_draft.${label}: ${elapsedMs}ms`);
            },
        });
        stepStartMs = logRetainerSetupTiming(representedClientId, selectedEndCustomerId, 'template_draft', stepStartMs);
        retainerSettings = buildRetainerSettings(profile, customer, defaultValues, documentDraftWorkspace, params.settingsOverride);
        templateDraft = buildTemplateDraftState({
            workspace: documentDraftWorkspace,
            documentType: retainerSettings.document_type,
            endCustomerId: customer.id,
        });
        saveProfileWithoutTemplatePrompt = buildSaveProfileWithoutTemplatePrompt(documentDraftWorkspace);
        issueDocumentAction = buildIssueDocumentAction(documentDraftWorkspace, perms.issue);
        const docTypesResult = await resolveAvailableDocumentTypes(orgId, issuerScope);
        stepStartMs = logRetainerSetupTiming(representedClientId, selectedEndCustomerId, 'document_settings', stepStartMs);
        documentTypeOptions = docTypesResult.available_document_types
            .filter((dt) => dt.key === 'quote' || dt.key === 'deal_invoice' || dt.key === 'tax_invoice')
            .map((dt) => ({
            key: dt.key,
            label: dt.label,
            enabled: dt.enabled,
            disabled_reason: dt.disabled_reason,
        }));
    }
    const identity = selectedEndCustomerId && retainerSettings
        ? {
            office_client_label: `לקוח משרד: ${client.display_name}`,
            end_customer_label: `לקוח מקבל המסמך: ${retainerSettings.end_customer_display_name}`,
        }
        : null;
    const selectedProfile = selectedEndCustomerId != null
        ? (profileByCustomerId.get(selectedEndCustomerId) ?? null)
        : null;
    const childDocumentsHistory = await buildChildDocumentsHistory(orgId, selectedProfile?.id ?? null);
    stepStartMs = logRetainerSetupTiming(representedClientId, selectedEndCustomerId, 'child_history', stepStartMs);
    const schedulerStatus = resolveSchedulerStatus(selectedProfile);
    const schedulerNote = schedulerStatus === RECURRING_SCHEDULER_STATUS_FAILED
        ? `יצירת טיוטה אחרונה נכשלה (${selectedProfile?.last_generation_error_code ?? 'שגיאה'}). נדרשת בדיקה ידנית.`
        : 'יצירת טיוטות מתוזמנת פעילה. לא נשלח מסמך ללא אישור רואה חשבון.';
    const allowedActions = ['view_invoice_retainer_setup'];
    if (perms.edit) {
        allowedActions.push('create_income_recurring_document_profile', 'update_income_recurring_document_profile', 'preview_income_recurring_document_profile_settings', 'pause_income_recurring_document_profile', 'resume_income_recurring_document_profile', 'cancel_income_recurring_document_profile');
    }
    const response = {
        aggregate_key: WORK_ENGINE_INVOICE_RETAINER_SETUP_AGGREGATE_KEY,
        represented_client_id: representedClientId,
        client_display_name: client.display_name,
        selected_end_customer_id: selectedEndCustomerId,
        identity,
        document_type_options: documentTypeOptions,
        end_customers: endCustomers,
        document_draft_workspace: documentDraftWorkspace,
        template_draft: templateDraft,
        save_profile_without_template_prompt: saveProfileWithoutTemplatePrompt,
        issue_document_action: issueDocumentAction,
        retainer_settings: retainerSettings,
        child_documents_history: childDocumentsHistory,
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
        scheduler_status: schedulerStatus,
        scheduler_note: schedulerNote,
        work_engine_event_type: RECURRING_WORK_EVENT_TYPE,
        work_type: RECURRING_WORK_TYPE,
    };
    logRetainerSetupTiming(representedClientId, selectedEndCustomerId, 'final_response', aggregateStartMs);
    logAggregatePayloadBreakdown('work_engine_invoice_retainer_setup_aggregate', response);
    return response;
}
