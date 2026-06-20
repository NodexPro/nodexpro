/**
 * Work Engine recurring document scheduler — Phase 1 runtime.
 *
 * When today >= next_document_date - advance_days for an active profile:
 *   1. Create income document draft from document_template_snapshot (no issue/send)
 *   2. Link draft + advance profile cycle fields
 *   3. Emit recurring_document_draft_created → work_item recurring_invoice_review
 *
 * On failure: emit recurring_generation_failed → work_item recurring_generation_failed.
 * Does not crash the entire scheduler run.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { createRecurringCycleDraftFromSnapshot, } from './work-engine-invoice-retainer-draft.service.js';
import { emitRecurringDocumentDraftCreatedWorkEvent, emitRecurringGenerationFailedWorkEvent, } from './work-engine-invoice-retainer-bridge.js';
import { RECURRING_SCHEDULER_STATUS_ACTIVE, advanceServicePeriod, buildRecurringSchedulerCycleKey, computeNextUnitPriceBeforeVat, isRecurringProfileDueForDraftGeneration, } from './work-engine-invoice-retainer.pure.js';
const DEFAULT_BATCH_SIZE = 25;
const PROFILE_SELECT = 'id, organization_id, represented_client_id, end_customer_id, document_type, frequency, next_document_date, advance_days, service_period_start, service_period_end, auto_advance_period, quantity, unit_price_before_vat_reference, currency, discount_percent_reference, discount_amount_reference, price_increase_enabled, price_increase_type, price_increase_value, document_template_snapshot, last_scheduler_cycle_key';
function buildSchedulerIssuerScope(orgId, actorUserId, representedClientId) {
    return {
        org_id: orgId,
        actor_user_id: actorUserId,
        acting_mode: 'office_representative',
        issuer_business_id: representedClientId,
        represented_client_id: representedClientId,
        issuer_label: '',
        represented_client_label: '',
        permissions: {
            view: true,
            edit: true,
            issue: true,
            issue_on_behalf: true,
        },
    };
}
async function listRecurringSchedulerOrgIds(singleOrgId) {
    if (singleOrgId?.trim())
        return [singleOrgId.trim()];
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .select('organization_id')
        .eq('status', 'active')
        .not('document_template_snapshot', 'is', null)
        .limit(5000);
    if (error)
        throw error;
    const seen = new Set();
    for (const row of data ?? []) {
        const id = String(row.organization_id ?? '').trim();
        if (id)
            seen.add(id);
    }
    return [...seen].sort();
}
async function loadActiveProfilesForOrg(orgId, limit) {
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .select(PROFILE_SELECT)
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .not('document_template_snapshot', 'is', null)
        .order('next_document_date', { ascending: true })
        .limit(limit);
    throwIfSupabaseError(error, 'loadRecurringSchedulerProfiles');
    return (data ?? []);
}
function parseSnapshot(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const o = raw;
    if (o.snapshot_kind !== 'document_template_snapshot')
        return null;
    return o;
}
async function markProfileGenerationFailed(params) {
    const { error } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .update({
        last_scheduler_cycle_key: params.cycleKey,
        last_generation_failed_at: new Date().toISOString(),
        last_generation_error_code: params.errorCode,
        last_generation_error_message: params.errorMessage.slice(0, 2000),
    })
        .eq('id', params.profile.id)
        .eq('organization_id', params.profile.organization_id);
    if (error)
        throw error;
    await writeAudit({
        organizationId: params.profile.organization_id,
        actorUserId: null,
        moduleCode: 'work_engine',
        entityType: 'income_recurring_document_profile',
        entityId: params.profile.id,
        action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_GENERATION_FAILED,
        payload: {
            cycle_key: params.cycleKey,
            scheduled_document_date: params.scheduledDocumentDate,
            error_code: params.errorCode,
            error_message: params.errorMessage,
        },
    });
}
async function advanceProfileAfterSuccess(params) {
    const nextUnitPrice = computeNextUnitPriceBeforeVat({
        current_unit_price_before_vat_reference: params.profile.unit_price_before_vat_reference,
        price_increase_enabled: params.profile.price_increase_enabled,
        price_increase_type: params.profile.price_increase_type,
        price_increase_value: params.profile.price_increase_value,
    });
    let nextDocumentDate = params.profile.next_document_date;
    let servicePeriodStart = params.profile.service_period_start;
    let servicePeriodEnd = params.profile.service_period_end;
    if (params.profile.auto_advance_period) {
        const advanced = advanceServicePeriod({
            service_period_start: params.profile.service_period_start,
            service_period_end: params.profile.service_period_end,
            frequency: params.profile.frequency,
        });
        nextDocumentDate = advanced.next_document_date;
        servicePeriodStart = advanced.service_period_start;
        servicePeriodEnd = advanced.service_period_end;
    }
    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .update({
        last_generated_draft_id: params.draftId,
        last_generated_at: nowIso,
        last_scheduler_cycle_key: params.cycleKey,
        last_generation_failed_at: null,
        last_generation_error_code: null,
        last_generation_error_message: null,
        next_document_date: nextDocumentDate,
        service_period_start: servicePeriodStart,
        service_period_end: servicePeriodEnd,
        unit_price_before_vat_reference: nextUnitPrice,
    })
        .eq('id', params.profile.id)
        .eq('organization_id', params.profile.organization_id);
    if (error)
        throw error;
    await writeAudit({
        organizationId: params.profile.organization_id,
        actorUserId: null,
        moduleCode: 'work_engine',
        entityType: 'income_recurring_document_profile',
        entityId: params.profile.id,
        action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_DRAFT_CREATED,
        payload: {
            draft_id: params.draftId,
            cycle_key: params.cycleKey,
            scheduled_document_date: params.scheduledDocumentDate,
            service_period_start: params.servicePeriodStart,
            service_period_end: params.servicePeriodEnd,
        },
    });
    await writeAudit({
        organizationId: params.profile.organization_id,
        actorUserId: null,
        moduleCode: 'work_engine',
        entityType: 'income_recurring_document_profile',
        entityId: params.profile.id,
        action: AUDIT_ACTIONS.INCOME_RECURRING_PROFILE_ADVANCED,
        payload: {
            next_document_date: nextDocumentDate,
            service_period_start: servicePeriodStart,
            service_period_end: servicePeriodEnd,
            unit_price_before_vat_reference: nextUnitPrice,
        },
    });
}
async function processDueProfile(params) {
    const profile = params.profile;
    const scheduledDocumentDate = profile.next_document_date;
    const cycleKey = buildRecurringSchedulerCycleKey(profile.id, scheduledDocumentDate);
    if (profile.last_scheduler_cycle_key === cycleKey) {
        return 'skipped';
    }
    if (!isRecurringProfileDueForDraftGeneration({
        today_iso: params.todayIso,
        next_document_date: scheduledDocumentDate,
        advance_days: profile.advance_days,
    })) {
        return 'skipped';
    }
    const snapshot = parseSnapshot(profile.document_template_snapshot);
    if (!snapshot) {
        if (!params.dryRun) {
            await markProfileGenerationFailed({
                profile,
                cycleKey,
                scheduledDocumentDate,
                errorCode: 'MISSING_SNAPSHOT',
                errorMessage: 'document_template_snapshot is missing or invalid',
            });
            await emitRecurringGenerationFailedWorkEvent({
                ctx: params.ctx,
                organizationId: profile.organization_id,
                representedClientId: profile.represented_client_id,
                endCustomerId: profile.end_customer_id,
                recurringProfileId: profile.id,
                errorCode: 'MISSING_SNAPSHOT',
                errorMessage: 'document_template_snapshot is missing or invalid',
                scheduledDocumentDate,
            });
        }
        return 'failed';
    }
    if (params.dryRun)
        return 'created';
    const servicePeriodStart = profile.service_period_start;
    const servicePeriodEnd = profile.service_period_end;
    try {
        const scope = buildSchedulerIssuerScope(profile.organization_id, params.ctx.user.id, profile.represented_client_id);
        const draftId = await createRecurringCycleDraftFromSnapshot({
            scope,
            representedClientId: profile.represented_client_id,
            endCustomerId: profile.end_customer_id,
            snapshot,
            scheduledDocumentDate,
            quantity: Number(profile.quantity),
            unitPriceBeforeVatReference: profile.unit_price_before_vat_reference,
            currency: profile.currency,
            discountPercentReference: profile.discount_percent_reference,
            discountAmountReference: profile.discount_amount_reference,
        });
        await advanceProfileAfterSuccess({
            profile,
            draftId,
            cycleKey,
            scheduledDocumentDate,
            servicePeriodStart,
            servicePeriodEnd,
        });
        await emitRecurringDocumentDraftCreatedWorkEvent({
            ctx: params.ctx,
            organizationId: profile.organization_id,
            representedClientId: profile.represented_client_id,
            endCustomerId: profile.end_customer_id,
            recurringProfileId: profile.id,
            draftId,
            documentType: snapshot.document_type,
            scheduledDocumentDate,
            servicePeriodStart,
            servicePeriodEnd,
        });
        return 'created';
    }
    catch (err) {
        const errorCode = err instanceof AppError
            ? String(err.code ?? 'DRAFT_CREATION_FAILED')
            : 'DRAFT_CREATION_FAILED';
        const errorMessage = err instanceof Error ? err.message : String(err ?? 'unknown_error');
        await markProfileGenerationFailed({
            profile,
            cycleKey,
            scheduledDocumentDate,
            errorCode,
            errorMessage,
        });
        await emitRecurringGenerationFailedWorkEvent({
            ctx: params.ctx,
            organizationId: profile.organization_id,
            representedClientId: profile.represented_client_id,
            endCustomerId: profile.end_customer_id,
            recurringProfileId: profile.id,
            errorCode,
            errorMessage,
            scheduledDocumentDate,
        });
        return 'failed';
    }
}
export async function runWorkEngineRecurringDocumentScheduler(params) {
    const todayIso = String(params?.today_iso ?? new Date().toISOString().slice(0, 10));
    const dryRun = params?.dry_run === true;
    const batchSize = Math.min(Math.max(Number(params?.batch_size ?? DEFAULT_BATCH_SIZE) || DEFAULT_BATCH_SIZE, 1), 200);
    const summary = {
        status: RECURRING_SCHEDULER_STATUS_ACTIVE,
        recurring_profiles_scanned: 0,
        recurring_profiles_due: 0,
        recurring_drafts_created: 0,
        recurring_failures: 0,
    };
    const orgIds = await listRecurringSchedulerOrgIds(params?.org_id);
    for (const orgId of orgIds) {
        const ctx = params?.scheduler_ctx ??
            {
                user: {
                    id: '00000000-0000-0000-0000-000000000001',
                    authUserId: '00000000-0000-0000-0000-000000000001',
                    email: 'scheduler@internal',
                    fullName: 'Work Engine Scheduler',
                    status: 'active',
                    uiLanguage: 'he',
                },
                membership: {
                    organizationId: orgId,
                    userId: '00000000-0000-0000-0000-000000000001',
                    roleId: 'scheduler',
                    roleCode: 'owner',
                    permissions: [],
                },
                organizationId: orgId,
            };
        const profiles = await loadActiveProfilesForOrg(orgId, batchSize);
        summary.recurring_profiles_scanned += profiles.length;
        for (const profile of profiles) {
            try {
                const scheduledDocumentDate = profile.next_document_date;
                const due = isRecurringProfileDueForDraftGeneration({
                    today_iso: todayIso,
                    next_document_date: scheduledDocumentDate,
                    advance_days: profile.advance_days,
                });
                const cycleKey = buildRecurringSchedulerCycleKey(profile.id, scheduledDocumentDate);
                const alreadyProcessed = profile.last_scheduler_cycle_key === cycleKey;
                if (!due || alreadyProcessed)
                    continue;
                summary.recurring_profiles_due += 1;
                const outcome = await processDueProfile({
                    profile,
                    todayIso,
                    dryRun,
                    ctx,
                });
                if (outcome === 'created')
                    summary.recurring_drafts_created += 1;
                if (outcome === 'failed')
                    summary.recurring_failures += 1;
            }
            catch (err) {
                summary.recurring_failures += 1;
                console.error('[work-engine] recurring scheduler profile error', profile.id, err);
            }
        }
    }
    return summary;
}
