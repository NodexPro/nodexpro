/**
 * Lease-based command idempotency for Work Engine mutating commands.
 */
import { supabaseAdmin } from '../../db/client.js';
import { badRequest, conflict } from '../../shared/errors.js';
export async function beginWorkEngineCommandIdempotency(args) {
    const { orgId, commandType, idempotencyKey } = args;
    const insertResp = await supabaseAdmin
        .from('work_engine_command_idempotency')
        .insert({
        org_id: orgId,
        idempotency_key: idempotencyKey,
        command_type: commandType,
    })
        .select('id')
        .maybeSingle();
    if (!insertResp.error && insertResp.data?.id) {
        return { kind: 'fresh', leaseRowId: String(insertResp.data.id) };
    }
    const code = insertResp.error?.code;
    if (code !== '23505') {
        if (insertResp.error)
            throw insertResp.error;
        throw badRequest('Idempotency insert failed', 'idempotency_insert_failed');
    }
    const { data: existing, error: selErr } = await supabaseAdmin
        .from('work_engine_command_idempotency')
        .select('command_type, completed_at')
        .eq('org_id', orgId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
    if (selErr)
        throw selErr;
    const row = existing;
    if (!row)
        throw insertResp.error ?? badRequest('Idempotency conflict', 'idempotency_conflict');
    if (row.command_type !== commandType) {
        throw badRequest('idempotency_key was already used for a different command', 'idempotency_key_mismatch');
    }
    if (row.completed_at)
        return { kind: 'replay' };
    throw conflict('Duplicate idempotency request in flight', 'idempotency_in_flight');
}
export async function completeWorkEngineCommandIdempotency(args) {
    const { error } = await supabaseAdmin
        .from('work_engine_command_idempotency')
        .update({
        completed_at: new Date().toISOString(),
        work_item_id: args.workItemId,
    })
        .eq('id', args.leaseRowId);
    if (error)
        throw error;
}
export async function abortWorkEngineCommandIdempotency(leaseRowId) {
    const { error } = await supabaseAdmin
        .from('work_engine_command_idempotency')
        .delete()
        .eq('id', leaseRowId);
    if (error)
        throw error;
}
