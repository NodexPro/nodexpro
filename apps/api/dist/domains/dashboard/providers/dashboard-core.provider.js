import { supabaseAdmin } from '../../../db/client.js';
import { forbidden } from '../../../shared/errors.js';
import { getTrialState } from '../../trial/trial.service.js';
function monthKeyUTC(d) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
}
const CORE_PROVIDER_CODE = 'core';
export const dashboardCoreProvider = {
    code: CORE_PROVIDER_CODE,
    required: true,
    supports: () => true,
    async getOverviewPart(ctx) {
        const orgId = ctx.organizationId;
        const membership = ctx.membership;
        if (!orgId || !membership)
            throw forbidden('Active organization required');
        const now = new Date();
        const startThisMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
        const startNextMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
        const startLastMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0));
        const monthsToShow = 6;
        const startRangeUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (monthsToShow - 1), 1, 0, 0, 0));
        const [orgRow, thisMonthCountRes, lastMonthCountRes, totalClientsRes, createdRowsRes, trialState] = await Promise.all([
            supabaseAdmin.from('organizations').select('id, name').eq('id', orgId).single(),
            supabaseAdmin
                .from('clients')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('is_archived', false)
                .gte('created_at', startThisMonthUTC.toISOString())
                .lt('created_at', startNextMonthUTC.toISOString()),
            supabaseAdmin
                .from('clients')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('is_archived', false)
                .gte('created_at', startLastMonthUTC.toISOString())
                .lt('created_at', startThisMonthUTC.toISOString()),
            supabaseAdmin
                .from('clients')
                .select('id', { count: 'exact', head: true })
                .eq('organization_id', orgId)
                .eq('is_archived', false),
            supabaseAdmin
                .from('clients')
                .select('created_at')
                .eq('organization_id', orgId)
                .eq('is_archived', false)
                .gte('created_at', startRangeUTC.toISOString()),
            getTrialState(orgId),
        ]);
        const org = orgRow.data;
        if (!org)
            throw forbidden('Organization not found');
        const thisMonthCount = thisMonthCountRes.count ?? 0;
        const lastMonthCount = lastMonthCountRes.count ?? 0;
        const totalClients = totalClientsRes.count ?? 0;
        const absDelta = thisMonthCount - lastMonthCount;
        const pctDelta = lastMonthCount > 0 ? (absDelta / lastMonthCount) * 100 : null;
        const months = [];
        const cursor = new Date(startRangeUTC);
        for (let i = 0; i < monthsToShow; i++) {
            months.push(monthKeyUTC(cursor));
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
        const countsByMonth = new Map(months.map((m) => [m, 0]));
        const createdRows = (createdRowsRes.data ?? []);
        for (const row of createdRows) {
            const d = new Date(row.created_at);
            const k = monthKeyUTC(d);
            if (countsByMonth.has(k))
                countsByMonth.set(k, (countsByMonth.get(k) ?? 0) + 1);
        }
        const newClientsByMonth = months.map((m) => ({ month: m, count: countsByMonth.get(m) ?? 0 }));
        const canCreateClient = membership.permissions.includes('clients:write');
        const canUploadDocument = membership.permissions.includes('documents:write');
        const canInviteMember = membership.permissions.includes('invite_users') || membership.permissions.includes('members:write');
        return {
            summary: {
                new_clients_this_month: thisMonthCount,
                new_clients_last_month: lastMonthCount,
                new_clients_vs_last_month_pct: pctDelta != null ? Number(pctDelta.toFixed(2)) : null,
                new_clients_vs_last_month_abs: absDelta,
                total_clients: totalClients,
                total_clients_secondary_line: 'active in registry',
            },
            charts: {
                new_clients_by_month: newClientsByMonth,
            },
            organization: {
                name: org.name,
                trial_status: trialState.trialStatus,
                trial_ends_at: trialState.endsAt,
                active_plan: trialState.trialStatus === 'trialing' ? 'Trial' : '—',
            },
            quick_actions: {
                can_create_client: canCreateClient,
                can_upload_document: canUploadDocument,
                can_invite_member: canInviteMember,
            },
        };
    },
};
