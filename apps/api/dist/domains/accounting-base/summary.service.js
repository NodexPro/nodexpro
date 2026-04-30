import { supabaseAdmin } from '../../db/client.js';
import { badRequest } from '../../shared/errors.js';
import { assertOrgInContext } from './accounting-base.guards.js';
/**
 * Internal-only service for future command handlers.
 * Summary is derived data and must not become source of truth.
 */
export async function forCommandUpsertDerivedSummary(ctx, organizationId, input) {
    assertOrgInContext(ctx, organizationId);
    const payload = {
        organization_id: organizationId,
        period_id: input.period_id,
        summary_scope: input.summary_scope,
        summary_key: input.summary_key,
        amount_total: input.amount_total,
        currency: input.currency,
        calculated_at: input.calculated_at ?? new Date().toISOString(),
    };
    const { data, error } = await supabaseAdmin
        .from('accounting_summaries')
        .upsert(payload, { onConflict: 'organization_id,period_id,summary_scope,summary_key,currency' })
        .select('*')
        .single();
    if (error)
        throw error;
    return data;
}
export async function forCommandListSummariesByPeriod(ctx, organizationId, periodId) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_summaries')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('period_id', periodId)
        .order('summary_scope', { ascending: true })
        .order('summary_key', { ascending: true });
    if (error)
        throw error;
    return (data ?? []);
}
export async function forCommandClearSummariesByPeriod(ctx, organizationId, periodId) {
    assertOrgInContext(ctx, organizationId);
    const { data, error } = await supabaseAdmin
        .from('accounting_summaries')
        .delete()
        .eq('organization_id', organizationId)
        .eq('period_id', periodId)
        .select('id');
    if (error)
        throw error;
    return { deleted: (data ?? []).length };
}
function toSummarySide(direction) {
    return direction === 'credit' ? 'income_total' : 'expense_total';
}
function addToBucket(bucket, key, amount) {
    bucket.set(key, (bucket.get(key) ?? 0) + amount);
}
/**
 * Recomputes derived summary rows from accounting_entries.
 * Source of truth remains accounting_entries; summaries are projections only.
 * No manual editing path should mutate accounting_summaries directly.
 */
export async function forSystemRecomputeDerivedSummaries(ctx, organizationId, input) {
    assertOrgInContext(ctx, organizationId);
    const targetPeriodId = input?.period_id?.trim() || null;
    let entriesQuery = supabaseAdmin
        .from('accounting_entries')
        .select('period_id, entry_type, category_id, amount, currency, direction')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .eq('posting_state', 'finalized');
    if (targetPeriodId) {
        entriesQuery = entriesQuery.eq('period_id', targetPeriodId);
    }
    const { data: entriesData, error: entriesError } = await entriesQuery;
    if (entriesError)
        throw entriesError;
    const entries = (entriesData ?? []);
    const periodTotals = new Map();
    const typeTotals = new Map();
    const categoryTotals = new Map();
    const periodIds = new Set();
    for (const e of entries) {
        if (!e.period_id || !e.currency) {
            throw badRequest('Invalid accounting entry data for summary recompute');
        }
        periodIds.add(e.period_id);
        const side = toSummarySide(e.direction);
        // Raw grouped totals only. Do not store signed/balance values in summary layer.
        addToBucket(periodTotals, `${e.period_id}|${side}|${e.currency}`, e.amount);
        addToBucket(typeTotals, `${e.period_id}|${e.entry_type}|${side}|${e.currency}`, e.amount);
        addToBucket(categoryTotals, `${e.period_id}|${e.category_id}|${side}|${e.currency}`, e.amount);
    }
    if (targetPeriodId && !periodIds.has(targetPeriodId)) {
        periodIds.add(targetPeriodId);
    }
    if (periodIds.size === 0) {
        return {
            periods: 0,
            rows_written: 0,
            totals_by_period: 0,
            totals_by_type: 0,
            totals_by_category: 0,
        };
    }
    const periodIdList = Array.from(periodIds);
    const { error: clearError } = await supabaseAdmin
        .from('accounting_summaries')
        .delete()
        .eq('organization_id', organizationId)
        .in('period_id', periodIdList);
    if (clearError)
        throw clearError;
    const nowIso = new Date().toISOString();
    const rows = [];
    for (const [key, total] of periodTotals.entries()) {
        const [period_id, side, currency] = key.split('|');
        rows.push({
            organization_id: organizationId,
            period_id,
            summary_scope: 'period',
            summary_key: `${period_id}:${side}`,
            amount_total: total,
            currency,
            calculated_at: nowIso,
        });
    }
    for (const [key, total] of typeTotals.entries()) {
        const [period_id, entry_type, side, currency] = key.split('|');
        rows.push({
            organization_id: organizationId,
            period_id,
            summary_scope: 'global',
            summary_key: `entry_type:${entry_type}:${side}`,
            amount_total: total,
            currency,
            calculated_at: nowIso,
        });
    }
    for (const [key, total] of categoryTotals.entries()) {
        const [period_id, category_id, side, currency] = key.split('|');
        rows.push({
            organization_id: organizationId,
            period_id,
            summary_scope: 'category',
            summary_key: `${category_id}:${side}`,
            amount_total: total,
            currency,
            calculated_at: nowIso,
        });
    }
    if (rows.length > 0) {
        const { error: insertError } = await supabaseAdmin.from('accounting_summaries').insert(rows);
        if (insertError)
            throw insertError;
    }
    return {
        periods: periodIdList.length,
        rows_written: rows.length,
        totals_by_period: periodTotals.size,
        totals_by_type: typeTotals.size,
        totals_by_category: categoryTotals.size,
    };
}
