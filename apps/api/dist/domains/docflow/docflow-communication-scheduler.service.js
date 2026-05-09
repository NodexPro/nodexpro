import { supabaseAdmin } from '../../db/client.js';
import { config } from '../../config.js';
import { AppError, badRequest } from '../../shared/errors.js';
import { resolveCountryContext } from '../country-pack/country-pack-resolver.service.js';
import { assertDocflowEntitled } from './docflow.guards.js';
import { parseDocflowCommunicationPayload, runCommunicationRuleCore } from './docflow-communication-rule.service.js';
function monthAbbrevUTC(d) {
    return d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}
function dayUTC(d) {
    // Use UTC to avoid server timezone drift across environments.
    return Number(d.toISOString().slice(8, 10));
}
function isMonthlyScheduleMatch(schedule, dateUtc) {
    const day = Number(schedule.day ?? 0);
    if (!Number.isFinite(day) || day <= 0)
        return false;
    if (dayUTC(dateUtc) !== day)
        return false;
    const monthsRaw = Array.isArray(schedule.months) ? schedule.months : [];
    const months = monthsRaw.map((m) => String(m ?? '').trim()).filter(Boolean);
    if (months.length === 0)
        return true;
    const m = monthAbbrevUTC(dateUtc);
    return months.includes(m);
}
function shouldRunToday(scheduleConfig, dateUtc) {
    if (!scheduleConfig)
        return false;
    const kind = String(scheduleConfig.kind ?? '').trim().toLowerCase();
    if (kind === 'monthly')
        return isMonthlyScheduleMatch(scheduleConfig, dateUtc);
    // default / manual / unknown: do not auto-run
    return false;
}
/** Accept YYYY-MM-DD or ISO timestamps (common from clients); always return UTC calendar day as YYYY-MM-DD. */
function normalizeSchedulerRunDate(input) {
    const fallbackYmd = new Date().toISOString().slice(0, 10);
    const raw = input === undefined || input === null || (typeof input === 'string' && input.trim() === '')
        ? fallbackYmd
        : String(input).trim();
    let ymd = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        ymd = raw;
    }
    else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
        ymd = raw.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd))
            throw badRequest('Invalid date; expected YYYY-MM-DD');
    }
    else {
        const d = new Date(raw);
        if (!Number.isFinite(d.getTime()))
            throw badRequest('Invalid date; expected YYYY-MM-DD or ISO-8601');
        ymd = d.toISOString().slice(0, 10);
    }
    const dateUtc = new Date(`${ymd}T00:00:00.000Z`);
    if (!Number.isFinite(dateUtc.getTime()))
        throw badRequest('Invalid date; expected YYYY-MM-DD');
    return { ymd, dateUtc };
}
async function listDocflowActiveOrgIds() {
    const { data: mod, error: modErr } = await supabaseAdmin.from('modules').select('id').eq('code', 'docflow').maybeSingle();
    if (modErr)
        throw modErr;
    const moduleId = mod?.id;
    if (!moduleId)
        return [];
    const { data: rows, error } = await supabaseAdmin
        .from('organization_modules')
        .select('organization_id')
        .eq('module_id', moduleId)
        .eq('status', 'active');
    if (error)
        throw error;
    return [...new Set((rows ?? []).map((r) => String(r.organization_id ?? '').trim()).filter(Boolean))];
}
/**
 * Daily scheduler for DocFlow communication rules.
 * Runs server-side only. Must be triggered by an internal cron (Render Cron Job).
 */
export async function runDocflowCommunicationDailyScheduler(params) {
    const { ymd: date, dateUtc } = normalizeSchedulerRunDate(params?.date);
    const runContextKey = String(params?.run_context_key ?? 'scheduler:daily').trim();
    const dryRun = params?.dry_run === true;
    if (!config.internalCronSecret) {
        throw new AppError(503, 'INTERNAL_CRON_SECRET is not configured', 'CRON_MISCONFIGURED');
    }
    const orgIds = await listDocflowActiveOrgIds();
    const result = {
        date,
        scanned_orgs: orgIds.length,
        entitled_orgs: 0,
        triggered_rules: 0,
        skipped_rules: 0,
        errors: [],
    };
    for (const orgId of orgIds) {
        try {
            await assertDocflowEntitled(orgId);
            result.entitled_orgs += 1;
            const ctxResolved = await resolveCountryContext(orgId, date);
            const valuesMap = ctxResolved.resolved_values_map ?? {};
            for (const [valueKey, raw] of Object.entries(valuesMap)) {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                    continue;
                const payload = raw;
                if (String(payload.type ?? '') !== 'docflow_communication')
                    continue;
                const comm = parseDocflowCommunicationPayload(payload);
                const scheduleCfg = comm.schedule_config && typeof comm.schedule_config === 'object' && !Array.isArray(comm.schedule_config)
                    ? comm.schedule_config
                    : undefined;
                if (!shouldRunToday(scheduleCfg, dateUtc)) {
                    result.skipped_rules += 1;
                    continue;
                }
                if (!dryRun) {
                    await runCommunicationRuleCore({
                        orgId,
                        valueKey,
                        runDate: date,
                        runContextKey,
                        actorUserId: null,
                        trigger: 'scheduled',
                    });
                }
                result.triggered_rules += 1;
            }
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e ?? 'unknown_error');
            result.errors.push({ org_id: orgId, error: msg });
        }
    }
    return result;
}
