/**
 * Work Engine — invoice retainer named commands.
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest, forbidden, notFound } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { incomeWorkspacePermissionsFromContext } from '../income/income-issuer-context.service.js';
import { buildWorkEngineInvoicesTabAggregate } from './work-engine-invoices-tab.read-model.service.js';
import { buildWorkEngineInvoiceRetainerSetupAggregate } from './work-engine-invoice-retainer.read-model.service.js';
import { buildDocumentTemplateSnapshotForRetainer } from './work-engine-invoice-retainer-draft.service.js';
import { RECURRING_FREQUENCY_OPTIONS, } from './work-engine-invoice-retainer.pure.js';
import { WORK_ENGINE_INVOICE_RETAINER_COMMANDS, } from './work-engine-invoice-retainer.types.js';
const ALLOWED_RETAINER_COMMANDS = new Set(Object.values(WORK_ENGINE_INVOICE_RETAINER_COMMANDS));
const RETAINER_FREQUENCIES = new Set(RECURRING_FREQUENCY_OPTIONS.map((o) => o.key));
const RETAINER_INCREASE_TYPES = new Set(['percent', 'amount']);
function assertEditAccess(ctx) {
    const perms = incomeWorkspacePermissionsFromContext(ctx);
    if (!perms.view)
        throw forbidden('income.view required');
    if (!perms.issue_on_behalf)
        throw forbidden('income.issue_on_behalf required');
    if (!perms.edit)
        throw forbidden('income.edit required');
}
function reqString(body, key) {
    const value = String(body[key] ?? '').trim();
    if (!value)
        throw badRequest(`${key} is required`);
    return value;
}
function optionalString(body, key) {
    const raw = body[key];
    if (raw == null || String(raw).trim() === '')
        return null;
    return String(raw).trim();
}
function optionalNumber(body, key) {
    const raw = body[key];
    if (raw == null || raw === '')
        return null;
    const n = Number(raw);
    if (!Number.isFinite(n))
        throw badRequest(`${key} must be a number`);
    return n;
}
function reqNumber(body, key) {
    const n = optionalNumber(body, key);
    if (n == null)
        throw badRequest(`${key} is required`);
    return n;
}
function reqBoolean(body, key) {
    const raw = body[key];
    if (typeof raw === 'boolean')
        return raw;
    if (raw === 'true')
        return true;
    if (raw === 'false')
        return false;
    throw badRequest(`${key} must be boolean`);
}
async function assertEndCustomerBelongs(params) {
    const { data, error } = await supabaseAdmin
        .from('income_customers')
        .select('id, status')
        .eq('organization_id', params.orgId)
        .eq('represented_client_id', params.representedClientId)
        .eq('issuer_business_id', params.representedClientId)
        .eq('id', params.endCustomerId)
        .maybeSingle();
    throwIfSupabaseError(error, 'assertRetainerEndCustomer');
    const row = data;
    if (!row || row.status !== 'active')
        throw badRequest('end_customer_id is not eligible');
}
async function loadProfile(params) {
    const { data, error } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .select('id, end_customer_id, status')
        .eq('organization_id', params.orgId)
        .eq('id', params.profileId)
        .eq('represented_client_id', params.representedClientId)
        .maybeSingle();
    throwIfSupabaseError(error, 'loadRetainerProfile');
    const row = data;
    if (!row)
        throw notFound('Recurring profile not found');
    return row;
}
function parseRetainerSettingsPayload(body, opts) {
    const partial = opts?.partial === true;
    const frequencyRaw = body.frequency;
    const frequency = frequencyRaw == null || String(frequencyRaw).trim() === ''
        ? partial
            ? undefined
            : (() => {
                throw badRequest('frequency is required');
            })()
        : reqString(body, 'frequency');
    if (frequency != null && !RETAINER_FREQUENCIES.has(frequency))
        throw badRequest('frequency is invalid');
    const priceIncreaseEnabled = body.price_increase_enabled == null && partial
        ? undefined
        : reqBoolean(body, 'price_increase_enabled');
    const priceIncreaseType = optionalString(body, 'price_increase_type');
    const priceIncreaseValue = optionalNumber(body, 'price_increase_value');
    if (priceIncreaseEnabled === true) {
        if (!priceIncreaseType || !RETAINER_INCREASE_TYPES.has(priceIncreaseType)) {
            throw badRequest('price_increase_type is required when price increase is enabled');
        }
        if (priceIncreaseValue == null || priceIncreaseValue < 0) {
            throw badRequest('price_increase_value is required when price increase is enabled');
        }
    }
    const advanceDaysRaw = body.advance_days;
    const advanceDays = advanceDaysRaw == null || advanceDaysRaw === ''
        ? partial
            ? undefined
            : reqNumber(body, 'advance_days')
        : Math.max(0, Math.min(365, Math.trunc(reqNumber(body, 'advance_days'))));
    const servicePeriodStart = body.service_period_start == null || String(body.service_period_start).trim() === ''
        ? partial
            ? undefined
            : reqString(body, 'service_period_start')
        : reqString(body, 'service_period_start');
    const servicePeriodEnd = body.service_period_end == null || String(body.service_period_end).trim() === ''
        ? partial
            ? undefined
            : reqString(body, 'service_period_end')
        : reqString(body, 'service_period_end');
    const autoAdvancePeriod = body.auto_advance_period == null && partial
        ? undefined
        : reqBoolean(body, 'auto_advance_period');
    return {
        frequency,
        advance_days: advanceDays,
        service_period_start: servicePeriodStart,
        service_period_end: servicePeriodEnd,
        auto_advance_period: autoAdvancePeriod,
        price_increase_enabled: priceIncreaseEnabled,
        price_increase_type: priceIncreaseEnabled ? priceIncreaseType : priceIncreaseEnabled === false ? null : priceIncreaseType,
        price_increase_value: priceIncreaseEnabled ? priceIncreaseValue : priceIncreaseEnabled === false ? null : priceIncreaseValue,
    };
}
async function buildProfileWritePayload(params) {
    const sourceDraftTemplateId = reqString(params.body, 'source_draft_template_id');
    const retainerSettings = parseRetainerSettingsPayload(params.body);
    const { snapshot, denormalized } = await buildDocumentTemplateSnapshotForRetainer({
        orgId: params.orgId,
        representedClientId: params.representedClientId,
        endCustomerId: params.endCustomerId,
        sourceDraftTemplateId,
    });
    return {
        source_draft_template_id: sourceDraftTemplateId,
        document_template_snapshot: snapshot,
        ...denormalized,
        ...retainerSettings,
    };
}
async function commandResponse(params) {
    const aggregate = await buildWorkEngineInvoiceRetainerSetupAggregate({
        ctx: params.ctx,
        representedClientId: params.representedClientId,
        endCustomerId: params.endCustomerId,
    });
    const response = {
        ok: true,
        command: params.command,
        work_engine_invoice_retainer_setup_aggregate: aggregate,
    };
    if (params.includeInvoicesTab) {
        response.work_engine_invoices_tab_aggregate = await buildWorkEngineInvoicesTabAggregate({
            ctx: params.ctx,
        });
    }
    return response;
}
export async function executeWorkEngineInvoiceRetainerCommand(ctx, command, body) {
    if (!ALLOWED_RETAINER_COMMANDS.has(command)) {
        throw badRequest(`Unknown retainer command: ${command}`);
    }
    assertEditAccess(ctx);
    const orgId = ctx.organizationId;
    const userId = ctx.user?.id ?? null;
    const representedClientId = reqString(body, 'represented_client_id');
    if (command === WORK_ENGINE_INVOICE_RETAINER_COMMANDS.preview) {
        const endCustomerId = reqString(body, 'end_customer_id');
        await assertEndCustomerBelongs({ orgId, representedClientId, endCustomerId });
        const settingsOverride = parseRetainerSettingsPayload(body, { partial: true });
        const aggregate = await buildWorkEngineInvoiceRetainerSetupAggregate({
            ctx,
            representedClientId,
            endCustomerId,
            settingsOverride,
        });
        return {
            ok: true,
            command: WORK_ENGINE_INVOICE_RETAINER_COMMANDS.preview,
            work_engine_invoice_retainer_setup_aggregate: aggregate,
        };
    }
    if (command === WORK_ENGINE_INVOICE_RETAINER_COMMANDS.create) {
        const endCustomerId = reqString(body, 'end_customer_id');
        await assertEndCustomerBelongs({ orgId, representedClientId, endCustomerId });
        const payload = await buildProfileWritePayload({
            orgId,
            representedClientId,
            endCustomerId,
            body,
        });
        const { data, error } = await supabaseAdmin
            .from('income_recurring_document_profiles')
            .insert({
            organization_id: orgId,
            represented_client_id: representedClientId,
            issuer_business_id: representedClientId,
            acting_mode: 'office_representative',
            end_customer_id: endCustomerId,
            ...payload,
            status: 'active',
            created_by_user_id: userId,
            updated_by_user_id: userId,
        })
            .select('id')
            .single();
        throwIfSupabaseError(error, 'createRetainerProfile');
        await writeAudit({
            organizationId: orgId,
            actorUserId: userId,
            moduleCode: 'income',
            entityType: 'income_recurring_document_profile',
            entityId: data.id,
            action: AUDIT_ACTIONS.INCOME_RECURRING_DOCUMENT_PROFILE_CREATED,
            payload: {
                represented_client_id: representedClientId,
                end_customer_id: endCustomerId,
                source_draft_template_id: payload.source_draft_template_id,
            },
        });
        return commandResponse({
            ctx,
            command,
            representedClientId,
            endCustomerId,
            includeInvoicesTab: true,
        });
    }
    const profileId = reqString(body, 'profile_id');
    const existing = await loadProfile({ orgId, profileId, representedClientId });
    if (command === WORK_ENGINE_INVOICE_RETAINER_COMMANDS.update) {
        const payload = await buildProfileWritePayload({
            orgId,
            representedClientId,
            endCustomerId: existing.end_customer_id,
            body,
        });
        const { error } = await supabaseAdmin
            .from('income_recurring_document_profiles')
            .update({
            ...payload,
            updated_by_user_id: userId,
        })
            .eq('organization_id', orgId)
            .eq('id', profileId);
        throwIfSupabaseError(error, 'updateRetainerProfile');
        await writeAudit({
            organizationId: orgId,
            actorUserId: userId,
            moduleCode: 'income',
            entityType: 'income_recurring_document_profile',
            entityId: profileId,
            action: AUDIT_ACTIONS.INCOME_RECURRING_DOCUMENT_PROFILE_UPDATED,
            payload: {
                represented_client_id: representedClientId,
                source_draft_template_id: payload.source_draft_template_id,
            },
        });
        return commandResponse({
            ctx,
            command,
            representedClientId,
            endCustomerId: existing.end_customer_id,
        });
    }
    const nextStatus = command === WORK_ENGINE_INVOICE_RETAINER_COMMANDS.pause
        ? 'paused'
        : command === WORK_ENGINE_INVOICE_RETAINER_COMMANDS.resume
            ? 'active'
            : 'cancelled';
    const { error } = await supabaseAdmin
        .from('income_recurring_document_profiles')
        .update({ status: nextStatus, updated_by_user_id: userId })
        .eq('organization_id', orgId)
        .eq('id', profileId);
    throwIfSupabaseError(error, 'setRetainerProfileStatus');
    await writeAudit({
        organizationId: orgId,
        actorUserId: userId,
        moduleCode: 'income',
        entityType: 'income_recurring_document_profile',
        entityId: profileId,
        action: AUDIT_ACTIONS.INCOME_RECURRING_DOCUMENT_PROFILE_UPDATED,
        payload: { status: nextStatus, represented_client_id: representedClientId },
    });
    return commandResponse({
        ctx,
        command: command,
        representedClientId,
        endCustomerId: existing.end_customer_id,
        includeInvoicesTab: command === WORK_ENGINE_INVOICE_RETAINER_COMMANDS.cancel,
    });
}
