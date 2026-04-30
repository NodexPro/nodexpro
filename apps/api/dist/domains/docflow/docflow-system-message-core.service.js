import { supabaseAdmin } from '../../db/client.js';
import { badRequest, forbidden } from '../../shared/errors.js';
import { writeAudit } from '../../shared/audit-events.js';
import { assertDocflowThreadScope } from './docflow.guards.js';
export async function assertModuleKeyValid(moduleKey) {
    const { data, error } = await supabaseAdmin.from('modules').select('id').eq('code', moduleKey).maybeSingle();
    if (error)
        throw error;
    if (!data)
        throw badRequest('Invalid module_key');
}
export async function resolveSystemThread(args) {
    if (args.ruleContextKey) {
        const { data: eventRow, error: eventErr } = await supabaseAdmin
            .from('client_message_events')
            .select('thread_id')
            .eq('org_id', args.orgId)
            .eq('client_id', args.clientId)
            .eq('event_type', 'system_message_created')
            .contains('payload_json', { module_key: args.moduleKey, rule_context_key: args.ruleContextKey })
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (eventErr)
            throw eventErr;
        const existingThreadId = String(eventRow?.thread_id ?? '').trim();
        if (existingThreadId) {
            const { data: thread, error: threadErr } = await supabaseAdmin
                .from('client_message_threads')
                .select('id, thread_status')
                .eq('id', existingThreadId)
                .eq('org_id', args.orgId)
                .eq('client_id', args.clientId)
                .maybeSingle();
            if (threadErr)
                throw threadErr;
            if (thread && thread.thread_status !== 'archived')
                return thread.id;
        }
    }
    const { data: openThread, error: openErr } = await supabaseAdmin
        .from('client_message_threads')
        .select('id')
        .eq('org_id', args.orgId)
        .eq('client_id', args.clientId)
        .eq('module_key', args.moduleKey)
        .neq('thread_status', 'archived')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (openErr)
        throw openErr;
    if (openThread?.id)
        return openThread.id;
    const { data: created, error: createErr } = await supabaseAdmin
        .from('client_message_threads')
        .insert({
        org_id: args.orgId,
        client_id: args.clientId,
        module_key: args.moduleKey,
        thread_type: 'reminder',
        thread_status: 'open',
        created_by_type: 'system',
        title: 'System message',
    })
        .select('id')
        .single();
    if (createErr || !created)
        throw createErr ?? new Error('Failed to create system thread');
    return created.id;
}
export async function findSystemMessageByIdempotency(args) {
    const { data, error } = await supabaseAdmin
        .from('client_message_events')
        .select('thread_id, message_id')
        .eq('org_id', args.orgId)
        .eq('client_id', args.clientId)
        .eq('event_type', 'system_message_created')
        .contains('payload_json', { module_key: args.moduleKey, idempotency_key: args.idempotencyKey })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error)
        throw error;
    const threadId = String(data?.thread_id ?? '').trim();
    const messageId = String(data?.message_id ?? '').trim();
    if (!threadId || !messageId)
        return null;
    return { threadId, messageId };
}
/**
 * Shared create_system_message persistence. Returns existing message if idempotency matches.
 */
export async function createSystemMessageCore(params) {
    const { orgId, clientId, moduleKey, messageType, body, idempotencyKey, ruleCode, ruleContextKey, sendModeRaw, autoSendAllowedByRule, allowPublishWithoutAutoSendRule, emitAutoSentEvent = true, threadIdInput, actorUserId, } = params;
    await assertModuleKeyValid(moduleKey);
    if (sendModeRaw === 'auto_send_allowed' && !autoSendAllowedByRule && !allowPublishWithoutAutoSendRule) {
        throw forbidden('Auto send is not allowed by backend rule config');
    }
    const existing = await findSystemMessageByIdempotency({ orgId, clientId, moduleKey, idempotencyKey });
    if (existing) {
        return { threadId: existing.threadId, messageId: existing.messageId, reusedExisting: true };
    }
    const threadId = threadIdInput
        ? (await assertDocflowThreadScope(orgId, clientId, threadIdInput), threadIdInput)
        : await resolveSystemThread({ orgId, clientId, moduleKey, ruleContextKey });
    const messageStatus = sendModeRaw === 'auto_send_allowed' ? 'published' : 'draft';
    const { data: message, error: msgErr } = await supabaseAdmin
        .from('client_messages')
        .insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        message_type: messageType,
        created_by_type: 'system',
        body,
        message_status: messageStatus,
    })
        .select('id')
        .single();
    if (msgErr || !message)
        throw msgErr ?? new Error('Failed to create system message');
    await supabaseAdmin
        .from('client_message_threads')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', threadId)
        .eq('org_id', orgId)
        .eq('client_id', clientId);
    const payloadJson = {
        org_id: orgId,
        client_id: clientId,
        module_key: moduleKey,
        thread_id: threadId,
        message_id: message.id,
        idempotency_key: idempotencyKey,
        rule_code: ruleCode,
        rule_context_key: ruleContextKey,
        send_mode: sendModeRaw,
    };
    await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        message_id: message.id,
        event_type: 'system_message_created',
        actor_type: 'system',
        payload_json: payloadJson,
    });
    await supabaseAdmin.from('client_message_events').insert({
        org_id: orgId,
        client_id: clientId,
        thread_id: threadId,
        message_id: message.id,
        event_type: messageStatus === 'draft' ? 'system_message_drafted' : 'system_message_published',
        actor_type: 'system',
        payload_json: payloadJson,
    });
    if (messageStatus === 'published' && emitAutoSentEvent) {
        await supabaseAdmin.from('client_message_events').insert({
            org_id: orgId,
            client_id: clientId,
            thread_id: threadId,
            message_id: message.id,
            event_type: 'system_message_auto_sent',
            actor_type: 'system',
            payload_json: payloadJson,
        });
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'docflow',
        entityType: 'docflow_message',
        entityId: message.id,
        action: 'system_message_created',
        payload: payloadJson,
    });
    await writeAudit({
        organizationId: orgId,
        actorUserId,
        moduleCode: 'docflow',
        entityType: 'docflow_message',
        entityId: message.id,
        action: messageStatus === 'draft' ? 'system_message_drafted' : 'system_message_published',
        payload: payloadJson,
    });
    if (messageStatus === 'published' && emitAutoSentEvent) {
        await writeAudit({
            organizationId: orgId,
            actorUserId,
            moduleCode: 'docflow',
            entityType: 'docflow_message',
            entityId: message.id,
            action: 'system_message_auto_sent',
            payload: payloadJson,
        });
    }
    return { threadId, messageId: message.id, reusedExisting: false };
}
