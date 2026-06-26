/**
 * Retainer schedule — linked Work Engine work_items read (existing rows only).
 */
import { supabaseAdmin } from '../../db/client.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { RECURRING_FAILURE_WORK_TYPE, RECURRING_WORK_ENGINE_ENTITY_TYPE, RECURRING_WORK_TYPE, } from './work-engine-invoice-retainer.pure.js';
export async function loadScheduleProjectionWorkItemsByProfile(params) {
    const periodKeyPrefix = `retainer:profile:${params.profileId}:cycle:`;
    const { data, error } = await supabaseAdmin
        .from('work_items')
        .select('id, period_key, work_type, work_state')
        .eq('org_id', params.orgId)
        .eq('source_entity_type', RECURRING_WORK_ENGINE_ENTITY_TYPE)
        .eq('source_entity_id', params.profileId)
        .like('period_key', `${periodKeyPrefix}%`)
        .in('work_type', [RECURRING_WORK_TYPE, RECURRING_FAILURE_WORK_TYPE])
        .neq('work_state', 'archived')
        .order('updated_at', { ascending: false })
        .limit(500);
    throwIfSupabaseError(error, 'loadScheduleProjectionWorkItemsByProfile');
    const byPeriodKey = new Map();
    for (const row of (data ?? [])) {
        const periodKey = String(row.period_key ?? '').trim();
        if (!periodKey || byPeriodKey.has(periodKey))
            continue;
        byPeriodKey.set(periodKey, {
            work_item_id: row.id,
            work_type: row.work_type,
            work_state: row.work_state,
            period_key: periodKey,
        });
    }
    return byPeriodKey;
}
