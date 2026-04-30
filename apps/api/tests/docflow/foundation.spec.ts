import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { supabaseAdmin } from '../../src/db/client.js';
import { executeDocflowOfficeCommand, executeDocflowPortalCommand } from '../../src/domains/docflow/docflow-commands.service.js';
import { buildClientDocflowTabAggregate, buildClientPortalInboxAggregate } from '../../src/domains/docflow/docflow-read-models.service.js';
import { sha256Hex } from '../../src/domains/docflow/docflow-portal-auth.service.js';
import { docflowRoutes } from '../../src/routes/docflow.routes.js';
import type { RequestContext } from '../../src/shared/context.js';

type Env = {
  marker: string;
  userId: string;
  orgId: string;
  otherOrgId: string;
  clientId: string;
  otherClientId: string;
  threadId: string;
  otherThreadId: string;
  otherOrgThreadId: string;
  messageId: string;
  fileAssetId: string;
  portalUserId: string;
  portalToken: string;
};

function buildCtx(orgId: string, userId: string, permissions: string[]): RequestContext {
  return {
    user: { id: userId, authUserId: '', email: 'qa@test.local', fullName: null, status: 'active' },
    membership: { organizationId: orgId, userId, roleId: 'qa-role', roleCode: 'owner', permissions },
    organizationId: orgId,
  };
}

async function enableDocflowEntitlement(orgId: string): Promise<void> {
  const { data: mod, error: modErr } = await supabaseAdmin.from('modules').select('id').eq('code', 'docflow').single();
  if (modErr || !mod) throw modErr ?? new Error('Docflow module missing');
  const { data: plan, error: planErr } = await supabaseAdmin
    .from('module_plans')
    .select('id')
    .eq('module_id', mod.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .single();
  if (planErr || !plan) throw planErr ?? new Error('Docflow module plan missing');
  const { error: omErr } = await supabaseAdmin.from('organization_modules').upsert(
    { organization_id: orgId, module_id: mod.id, status: 'active' },
    { onConflict: 'organization_id,module_id' }
  );
  if (omErr) throw omErr;
  const { error: subErr } = await supabaseAdmin.from('organization_module_subscriptions').upsert(
    {
      organization_id: orgId,
      module_id: mod.id,
      module_plan_id: plan.id,
      status: 'active',
      started_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id,module_id' }
  );
  if (subErr) throw subErr;
}

async function createEnv(withEntitlement: boolean): Promise<Env> {
  const marker = `docflow-sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = randomUUID();
  const orgId = randomUUID();
  const otherOrgId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();
  const threadId = randomUUID();
  const otherThreadId = randomUUID();
  const otherOrgThreadId = randomUUID();
  const messageId = randomUUID();
  const fileAssetId = randomUUID();
  const portalUserId = randomUUID();
  const portalToken = `pt-${marker}`;

  await supabaseAdmin.from('users').insert({ id: userId, email: `${marker}@test.local`, status: 'active' });
  await supabaseAdmin.from('organizations').insert([
    { id: orgId, name: `${marker}-org`, country_code: 'IL', timezone: 'UTC', status: 'active' },
    { id: otherOrgId, name: `${marker}-org-b`, country_code: 'IL', timezone: 'UTC', status: 'active' },
  ]);
  await supabaseAdmin.from('clients').insert([
    { id: clientId, organization_id: orgId, display_name: `${marker}-client-a`, status: 'active' },
    { id: otherClientId, organization_id: orgId, display_name: `${marker}-client-b`, status: 'active' },
  ]);
  await supabaseAdmin.from('client_portal_users').insert({
    id: portalUserId,
    org_id: orgId,
    client_id: clientId,
    email_normalized: `${marker}-portal@test.local`,
    status: 'active',
    auth_method: 'magic_link',
  });
  await supabaseAdmin.from('client_portal_sessions').insert({
    org_id: orgId,
    client_id: clientId,
    portal_user_id: portalUserId,
    session_token_hash: sha256Hex(portalToken),
    status: 'active',
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
  });
  await supabaseAdmin.from('client_message_threads').insert([
    {
      id: threadId,
      org_id: orgId,
      client_id: clientId,
      module_key: 'docflow',
      thread_type: 'question',
      thread_status: 'open',
      created_by_type: 'office',
      created_by_user_id: userId,
    },
    {
      id: otherThreadId,
      org_id: orgId,
      client_id: otherClientId,
      module_key: 'docflow',
      thread_type: 'question',
      thread_status: 'open',
      created_by_type: 'office',
      created_by_user_id: userId,
    },
    {
      id: otherOrgThreadId,
      org_id: otherOrgId,
      client_id: randomUUID(),
      module_key: 'docflow',
      thread_type: 'question',
      thread_status: 'open',
      created_by_type: 'office',
      created_by_user_id: userId,
    },
  ]);
  await supabaseAdmin.from('client_messages').insert({
    id: messageId,
    org_id: orgId,
    client_id: clientId,
    thread_id: threadId,
    message_type: 'text',
    created_by_type: 'office',
    created_by_user_id: userId,
    body: 'hello',
    message_status: 'published',
  });
  await supabaseAdmin.from('file_assets').insert({
    id: fileAssetId,
    organization_id: orgId,
    storage_provider: 'supabase',
    storage_bucket: 'client-files',
    storage_key: `${orgId}/${clientId}/test-${Date.now()}`,
    file_name: 'x.txt',
    mime_type: 'text/plain',
    file_size: 1,
    uploaded_by: userId,
    access_level: 'organization',
  });
  await supabaseAdmin.from('client_message_attachments').insert({
    org_id: orgId,
    client_id: clientId,
    thread_id: threadId,
    message_id: messageId,
    file_asset_id: fileAssetId,
  });

  if (withEntitlement) await enableDocflowEntitlement(orgId);

  return { marker, userId, orgId, otherOrgId, clientId, otherClientId, threadId, otherThreadId, otherOrgThreadId, messageId, fileAssetId, portalUserId, portalToken };
}

async function cleanupEnv(env: Env): Promise<void> {
  await supabaseAdmin.from('audit_log').delete().or(`organization_id.eq.${env.orgId},organization_id.eq.${env.otherOrgId}`);
  await supabaseAdmin.from('organization_module_subscriptions').delete().in('organization_id', [env.orgId, env.otherOrgId]);
  await supabaseAdmin.from('organization_modules').delete().in('organization_id', [env.orgId, env.otherOrgId]);
  await supabaseAdmin.from('organizations').delete().in('id', [env.orgId, env.otherOrgId]);
  await supabaseAdmin.from('users').delete().eq('id', env.userId);
}

test('office cannot send message to thread from another client/org', async () => {
  const env = await createEnv(true);
  try {
    const ctx = buildCtx(env.orgId, env.userId, ['clients:write']);
    await assert.rejects(
      executeDocflowOfficeCommand(ctx, 'send_office_message', {
        org_id: env.orgId,
        client_id: env.clientId,
        thread_id: env.otherThreadId,
        message_type: 'text',
        body: 'x',
      }),
      /Thread not found/
    );
    await assert.rejects(
      executeDocflowOfficeCommand(ctx, 'send_office_message', {
        org_id: env.orgId,
        client_id: env.clientId,
        thread_id: env.otherOrgThreadId,
        message_type: 'text',
        body: 'x',
      }),
      /Thread not found/
    );
  } finally {
    await cleanupEnv(env);
  }
});

test('client portal cannot send message to thread outside its session scope', async () => {
  const env = await createEnv(true);
  try {
    await assert.rejects(
      executeDocflowPortalCommand('send_client_message', {
        portal_session_token: env.portalToken,
        thread_id: env.otherThreadId,
        message_type: 'text',
        body: 'x',
      }),
      /Thread not found/
    );
  } finally {
    await cleanupEnv(env);
  }
});

test('office cannot mark read on thread outside client scope', async () => {
  const env = await createEnv(true);
  try {
    const ctx = buildCtx(env.orgId, env.userId, ['clients:write']);
    await assert.rejects(
      executeDocflowOfficeCommand(ctx, 'mark_thread_read_by_office', {
        org_id: env.orgId,
        client_id: env.clientId,
        thread_id: env.otherThreadId,
      }),
      /Thread not found/
    );
  } finally {
    await cleanupEnv(env);
  }
});

test('client cannot mark read on thread outside session scope', async () => {
  const env = await createEnv(true);
  try {
    await assert.rejects(
      executeDocflowPortalCommand('mark_thread_read_by_client', {
        portal_session_token: env.portalToken,
        thread_id: env.otherThreadId,
      }),
      /Thread not found/
    );
  } finally {
    await cleanupEnv(env);
  }
});

test('portal aggregate blocked when DocFlow entitlement inactive', async () => {
  const env = await createEnv(false);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/v1/docflow', docflowRoutes);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const statusCode = typeof err === 'object' && err && 'statusCode' in err ? Number((err as { statusCode: number }).statusCode) : 500;
    res.status(statusCode).json({ message });
  });
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Test server failed');
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/docflow/portal/aggregates/client-portal-inbox`, {
      headers: { 'X-Client-Portal-Session': env.portalToken },
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
    await cleanupEnv(env);
  }
});

test('portal file open blocked when DocFlow entitlement inactive', async () => {
  const env = await createEnv(false);
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/v1/docflow', docflowRoutes);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    const statusCode = typeof err === 'object' && err && 'statusCode' in err ? Number((err as { statusCode: number }).statusCode) : 500;
    res.status(statusCode).json({ message });
  });
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Test server failed');
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/docflow/portal/files/${env.fileAssetId}/open`, {
      headers: { 'X-Client-Portal-Session': env.portalToken },
    });
    assert.equal(res.status, 403);
  } finally {
    server.close();
    await cleanupEnv(env);
  }
});

test('command success still returns refreshed aggregate', async () => {
  const env = await createEnv(true);
  try {
    const ctx = buildCtx(env.orgId, env.userId, ['clients:write']);
    const out = await executeDocflowOfficeCommand(ctx, 'send_office_message', {
      org_id: env.orgId,
      client_id: env.clientId,
      thread_id: env.threadId,
      message_type: 'text',
      body: 'ok',
    });
    assert.equal(out.ok, true);
    assert.equal(out.refreshed.aggregate_key, 'client_docflow_tab_aggregate');
    assert.equal(typeof out.refreshed.aggregate, 'object');
    assert.equal(out.refreshed.aggregate !== null, true);
  } finally {
    await cleanupEnv(env);
  }
});

test('system message requires entitlement', async () => {
  const env = await createEnv(false);
  try {
    const ctx = buildCtx(env.orgId, env.userId, ['docflow:system_message_write']);
    await assert.rejects(
      executeDocflowOfficeCommand(ctx, 'create_system_message', {
        org_id: env.orgId,
        client_id: env.clientId,
        thread_id: env.threadId,
        module_key: 'docflow',
        message_type: 'system',
        body: 'system',
        rule_code: 'r1',
        idempotency_key: `idem-${env.marker}`,
      }),
      /Not entitled|No subscription/
    );
  } finally {
    await cleanupEnv(env);
  }
});

test('system message requires valid thread scope', async () => {
  const env = await createEnv(true);
  try {
    const ctx = buildCtx(env.orgId, env.userId, ['docflow:system_message_write']);
    await assert.rejects(
      executeDocflowOfficeCommand(ctx, 'create_system_message', {
        org_id: env.orgId,
        client_id: env.clientId,
        thread_id: env.otherThreadId,
        module_key: 'docflow',
        message_type: 'system',
        body: 'system',
        rule_code: 'r2',
        idempotency_key: `idem-${env.marker}-x`,
      }),
      /Thread not found/
    );
  } finally {
    await cleanupEnv(env);
  }
});

test('duplicate idempotency key does not create duplicate system message', async () => {
  const env = await createEnv(true);
  const idem = `idem-${env.marker}-dup`;
  try {
    const ctx = buildCtx(env.orgId, env.userId, ['docflow:system_message_write']);
    await executeDocflowOfficeCommand(ctx, 'create_system_message', {
      org_id: env.orgId,
      client_id: env.clientId,
      thread_id: env.threadId,
      module_key: 'docflow',
      message_type: 'system',
      body: 'dup',
      rule_code: 'r3',
      idempotency_key: idem,
    });
    await executeDocflowOfficeCommand(ctx, 'create_system_message', {
      org_id: env.orgId,
      client_id: env.clientId,
      thread_id: env.threadId,
      module_key: 'docflow',
      message_type: 'system',
      body: 'dup',
      rule_code: 'r3',
      idempotency_key: idem,
    });
    const { count, error } = await supabaseAdmin
      .from('client_message_events')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', env.orgId)
      .eq('client_id', env.clientId)
      .eq('event_type', 'system_message_created')
      .contains('payload_json', { idempotency_key: idem });
    if (error) throw error;
    assert.equal(count, 1);
  } finally {
    await cleanupEnv(env);
  }
});

test('client portal does not see draft system message and sees published system message', async () => {
  const env = await createEnv(true);
  try {
    const ctx = buildCtx(env.orgId, env.userId, ['docflow:system_message_write']);
    await executeDocflowOfficeCommand(ctx, 'create_system_message', {
      org_id: env.orgId,
      client_id: env.clientId,
      thread_id: env.threadId,
      module_key: 'docflow',
      message_type: 'system',
      body: 'draft-only',
      rule_code: 'r4',
      idempotency_key: `idem-${env.marker}-draft`,
    });
    await executeDocflowOfficeCommand(ctx, 'create_system_message', {
      org_id: env.orgId,
      client_id: env.clientId,
      thread_id: env.threadId,
      module_key: 'docflow',
      message_type: 'reminder',
      body: 'published-visible',
      rule_code: 'r5',
      idempotency_key: `idem-${env.marker}-pub`,
      send_mode: 'auto_send_allowed',
      auto_send_allowed_by_rule: true,
    });

    const aggregate = await buildClientPortalInboxAggregate({
      orgId: env.orgId,
      clientId: env.clientId,
      portalUserId: env.portalUserId,
      selectedThreadId: env.threadId,
    });
    const agg = aggregate as Record<string, unknown>;
    const messages = Array.isArray(agg.messages) ? (agg.messages as Array<Record<string, unknown>>) : [];
    assert.equal(messages.some((m) => String(m.body ?? '') === 'draft-only'), false);
    assert.equal(messages.some((m) => String(m.body ?? '') === 'published-visible'), true);
  } finally {
    await cleanupEnv(env);
  }
});

test('system message command writes audit and refreshed aggregate', async () => {
  const env = await createEnv(true);
  const idem = `idem-${env.marker}-audit`;
  try {
    const ctx = buildCtx(env.orgId, env.userId, ['docflow:system_message_write']);
    const out = await executeDocflowOfficeCommand(ctx, 'create_system_message', {
      org_id: env.orgId,
      client_id: env.clientId,
      thread_id: env.threadId,
      module_key: 'docflow',
      message_type: 'system',
      body: 'audit',
      rule_code: 'r6',
      idempotency_key: idem,
    });
    assert.equal(out.ok, true);
    assert.equal(out.refreshed.aggregate_key, 'client_docflow_tab_aggregate');
    const { count, error } = await supabaseAdmin
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', env.orgId)
      .eq('action', 'system_message_created')
      .contains('payload_json', { idempotency_key: idem });
    if (error) throw error;
    assert.equal((count ?? 0) >= 1, true);
  } finally {
    await cleanupEnv(env);
  }
});

test('invite_client_to_docflow is blocked when client has no phone and no email', async () => {
  const env = await createEnv(true);
  try {
    await supabaseAdmin.from('clients').update({ phone: null, email: null }).eq('id', env.clientId).eq('organization_id', env.orgId);
    const ctx = buildCtx(env.orgId, env.userId, ['clients:write']);
    await assert.rejects(
      executeDocflowOfficeCommand(ctx, 'invite_client_to_docflow', {
        org_id: env.orgId,
        client_id: env.clientId,
        email: 'invite@test.local',
      }),
      /missing_client_contact_channel/
    );
  } finally {
    await cleanupEnv(env);
  }
});

test('client_docflow_tab aggregate exposes invite eligibility and Hebrew reason', async () => {
  const env = await createEnv(true);
  try {
    await supabaseAdmin.from('clients').update({ phone: null, email: null }).eq('id', env.clientId).eq('organization_id', env.orgId);
    const officeAgg = await buildClientDocflowTabAggregate({
      orgId: env.orgId,
      clientId: env.clientId,
      selectedThreadId: env.threadId,
    });
    assert.equal(officeAgg.can_invite_to_docflow, false);
    assert.equal(officeAgg.invite_to_docflow_reason_code, 'missing_client_contact_channel');
    assert.equal(
      officeAgg.invite_to_docflow_reason_text,
      'כדי להזמין את הלקוח ל-DocFlow, יש להוסיף טלפון או אימייל בפרטי הלקוח.'
    );
  } finally {
    await cleanupEnv(env);
  }
});

