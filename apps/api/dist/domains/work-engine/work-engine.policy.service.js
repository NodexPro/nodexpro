/**
 * Work Engine work-type policies (Stage 10). Defaults when no DB row exists.
 */
import { supabaseAdmin } from '../../db/client.js';
const DEFAULT_POLICY = {
    allow_staff_pickup_unassigned: true,
};
export async function resolveWorkTypeWorkflowPolicy(orgId, workType) {
    const map = await resolveWorkTypePoliciesBatch(orgId, [workType]);
    return map.get(workType) ?? DEFAULT_POLICY;
}
/** Batch-load policies for queue row projection (one query per aggregate build). */
export async function resolveWorkTypePoliciesBatch(orgId, workTypes) {
    const map = new Map();
    const uniq = [...new Set(workTypes.filter(Boolean))];
    for (const wt of uniq)
        map.set(wt, DEFAULT_POLICY);
    if (uniq.length === 0)
        return map;
    const { data, error } = await supabaseAdmin
        .from('work_engine_work_type_policies')
        .select('work_type, allow_staff_pickup_unassigned')
        .eq('org_id', orgId)
        .in('work_type', uniq);
    if (error)
        throw error;
    for (const row of data ?? []) {
        const r = row;
        map.set(r.work_type, {
            allow_staff_pickup_unassigned: r.allow_staff_pickup_unassigned !== false,
        });
    }
    return map;
}
export function canStaffPickUpUnassigned(policy, roleCode) {
    if (roleCode === 'owner' || roleCode === 'admin')
        return true;
    if (roleCode === 'staff' || roleCode === 'senior')
        return policy.allow_staff_pickup_unassigned;
    return false;
}
