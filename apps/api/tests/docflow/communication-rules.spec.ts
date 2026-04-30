import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../src/db/client.js';
import { executeDocflowCommunicationOfficeCommand } from '../../src/domains/docflow/docflow-communication-rule.service.js';
import { buildClientPortalInboxAggregate } from '../../src/domains/docflow/docflow-read-models.service.js';
import type { RequestContext } from '../../src/shared/context.js';

type CommEnv = {
  marker: string;
  userId: string;
  orgId: string;
  clientId: string;
  packId: string;
  rulesetId: string;
  legalValueId: string;
  valueKey: string;
  portalUserId: string;
};

type CommRulePayloadOptions = {
  targetFilter?: unknown;
};

function buildCtx(orgId: string, userId: string): RequestContext {
  return {
    user: { id: userId, authUserId: '', email: 'qa@test.local', fullName: null, status: 'active' },
    membership: { organizationId: orgId, userId, roleId: 'qa-role', roleCode: 'owner', permissions: ['docflow:system_message_write'] },
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

async function createCommEnv(templateText: string, opts?: CommRulePayloadOptions): Promise<CommEnv> {
  const marker = `docflow-comm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const userId = randomUUID();
  const orgId = randomUUID();
  const clientId = randomUUID();
  const packId = randomUUID();
  const rulesetId = randomUUID();
  const legalValueId = randomUUID();
  const valueKey = `comm_${marker}`;
  const portalUserId = randomUUID();

  await supabaseAdmin.from('users').insert({ id: userId, email: `${marker}@test.local`, status: 'active' });
  await supabaseAdmin
    .from('organizations')
    .insert({ id: orgId, name: `${marker}-org`, country_code: 'IL', timezone: 'UTC', status: 'active' });
  await supabaseAdmin.from('clients').insert({
    id: clientId,
    organization_id: orgId,
    tax_id: `TAX-${marker}`,
    display_name: `${marker}-client`,
    status: 'active',
    created_by: userId,
  });
  await supabaseAdmin.from('client_portal_users').insert({
    id: portalUserId,
    org_id: orgId,
    client_id: clientId,
    email_normalized: `${marker}-portal@test.local`,
    status: 'active',
    auth_method: 'magic_link',
  });

  await supabaseAdmin.from('countries').upsert(
    { code: 'IL', name: 'Israel', status: 'active' },
    { onConflict: 'code' }
  );

  await supabaseAdmin.from('country_packs').insert({
    id: packId,
    country_code: 'IL',
    pack_code: `pack_${marker}`,
    name: 'Test pack',
    status: 'enabled',
    framework_version: '1',
    code_version: '1',
  });

  await supabaseAdmin.from('country_pack_rulesets').insert({
    id: rulesetId,
    country_pack_id: packId,
    ruleset_code: `rs_${marker}`,
    ruleset_version: 'v1',
    effective_from: '2020-01-01',
    effective_to: null,
    status: 'active',
  });

  await supabaseAdmin.from('country_legal_values').insert({
    id: legalValueId,
    country_code: 'IL',
    value_key: valueKey,
    label: 'Comm test',
    category: 'Modules',
    module_scope: 'docflow',
    value_type: 'json',
    status: 'active',
  });

  await supabaseAdmin.from('country_legal_value_versions').insert({
    legal_value_id: legalValueId,
    country_pack_ruleset_id: rulesetId,
    value_payload_json: {
      type: 'docflow_communication',
      message_template: templateText,
      review_required: true,
      message_type: 'reminder',
      target_filter: opts?.targetFilter ?? 'all',
      condition_config: {},
    },
    effective_from: '2020-01-01',
    effective_to: null,
    status: 'active',
  });

  await supabaseAdmin.from('organization_country_settings').upsert(
    {
      organization_id: orgId,
      country_code: 'IL',
      active_country_pack_id: packId,
      active_ruleset_id: rulesetId,
      settings_status: 'active',
    },
    { onConflict: 'organization_id' }
  );

  await enableDocflowEntitlement(orgId);

  return { marker, userId, orgId, clientId, packId, rulesetId, legalValueId, valueKey, portalUserId };
}

async function createAdditionalActiveClient(orgId: string, userId: string, marker: string, suffix: string): Promise<string> {
  const id = randomUUID();
  await supabaseAdmin.from('clients').insert({
    id,
    organization_id: orgId,
    tax_id: `TAX-${marker}-${suffix}`,
    display_name: `${marker}-client-${suffix}`,
    status: 'active',
    created_by: userId,
  });
  return id;
}

async function cleanupCommEnv(e: CommEnv): Promise<void> {
  await supabaseAdmin.from('communication_draft_messages').delete().eq('org_id', e.orgId);
  await supabaseAdmin.from('communication_rule_runs').delete().eq('org_id', e.orgId);
  await supabaseAdmin.from('client_obligations').delete().eq('organization_id', e.orgId);
  await supabaseAdmin.from('client_tax_settings').delete().eq('organization_id', e.orgId);
  await supabaseAdmin.from('client_message_events').delete().eq('org_id', e.orgId);
  await supabaseAdmin.from('client_messages').delete().eq('org_id', e.orgId);
  await supabaseAdmin.from('client_message_threads').delete().eq('org_id', e.orgId);
  await supabaseAdmin.from('client_portal_users').delete().eq('org_id', e.orgId);
  await supabaseAdmin.from('clients').delete().eq('organization_id', e.orgId);
  await supabaseAdmin.from('organization_country_settings').delete().eq('organization_id', e.orgId);
  await supabaseAdmin.from('country_legal_value_versions').delete().eq('country_pack_ruleset_id', e.rulesetId);
  await supabaseAdmin.from('country_legal_values').delete().eq('id', e.legalValueId);
  await supabaseAdmin.from('country_pack_rulesets').delete().eq('id', e.rulesetId);
  await supabaseAdmin.from('country_packs').delete().eq('id', e.packId);
  await supabaseAdmin.from('organization_module_subscriptions').delete().eq('organization_id', e.orgId);
  await supabaseAdmin.from('organization_modules').delete().eq('organization_id', e.orgId);
  await supabaseAdmin.from('audit_log').delete().eq('organization_id', e.orgId);
  await supabaseAdmin.from('organizations').delete().eq('id', e.orgId);
  await supabaseAdmin.from('users').delete().eq('id', e.userId);
}

test('draft message_body comes from Owner Panel legal value template', async () => {
  const template = 'OWNER_TEMPLATE_V1';
  const env = await createCommEnv(template);
  try {
    const ctx = buildCtx(env.orgId, env.userId);
    const out = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'ctx1',
    });
    assert.equal(out.refreshed.aggregate_key, 'communication_rule_run_review_aggregate');
    const drafts = out.refreshed.aggregate.drafts as { message_body: string; client_id: string }[];
    const d = drafts.find((x) => x.client_id === env.clientId);
    assert.ok(d);
    assert.equal(d.message_body, template);
  } finally {
    await cleanupCommEnv(env);
  }
});

test('changing Owner template affects new runs only (existing draft text unchanged)', async () => {
  const env = await createCommEnv('TEMPLATE_A');
  try {
    const ctx = buildCtx(env.orgId, env.userId);
    await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'period1',
    });

    const { data: draftBefore } = await supabaseAdmin
      .from('communication_draft_messages')
      .select('id, message_body')
      .eq('org_id', env.orgId)
      .eq('client_id', env.clientId)
      .maybeSingle();
    assert.equal(draftBefore?.message_body, 'TEMPLATE_A');

    await supabaseAdmin
      .from('country_legal_value_versions')
      .update({
        value_payload_json: {
          type: 'docflow_communication',
          message_template: 'TEMPLATE_B',
          review_required: true,
          message_type: 'reminder',
          condition_config: {},
        },
      })
      .eq('legal_value_id', env.legalValueId)
      .eq('country_pack_ruleset_id', env.rulesetId);

    await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'period2',
    });

    const { data: oldDraft } = await supabaseAdmin
      .from('communication_draft_messages')
      .select('message_body')
      .eq('org_id', env.orgId)
      .eq('client_id', env.clientId)
      .eq('id', draftBefore!.id)
      .single();
    assert.equal(oldDraft?.message_body, 'TEMPLATE_A');

    const { data: newDraft } = await supabaseAdmin
      .from('communication_draft_messages')
      .select('message_body')
      .eq('org_id', env.orgId)
      .eq('client_id', env.clientId)
      .neq('id', draftBefore!.id)
      .maybeSingle();
    assert.equal(newDraft?.message_body, 'TEMPLATE_B');
  } finally {
    await cleanupCommEnv(env);
  }
});

test('duplicate run_communication_rule does not create duplicate drafts', async () => {
  const env = await createCommEnv('T');
  try {
    const ctx = buildCtx(env.orgId, env.userId);
    const payload = {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'same',
    };
    await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', payload);
    await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', payload);
    const { data, error } = await supabaseAdmin
      .from('communication_draft_messages')
      .select('id')
      .eq('org_id', env.orgId)
      .eq('client_id', env.clientId);
    if (error) throw error;
    assert.equal((data ?? []).length, 1);
  } finally {
    await cleanupCommEnv(env);
  }
});

test('approve_draft_message with refresh_aggregate returns floating widget aggregate', async () => {
  const env = await createCommEnv('WIDGET_REFRESH');
  try {
    const ctx = buildCtx(env.orgId, env.userId);
    const runOut = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'widget-refresh',
    });
    const runId = (runOut.refreshed.aggregate.run as { id: string }).id;
    const draftId = ((runOut.refreshed.aggregate.drafts as { id: string }[])[0] ?? {}).id;
    assert.ok(draftId);
    const out = await executeDocflowCommunicationOfficeCommand(ctx, 'approve_draft_message', {
      org_id: env.orgId,
      rule_run_id: runId,
      draft_id: draftId,
      refresh_aggregate: 'docflow_floating_widget_aggregate',
    });
    assert.equal(out.refreshed.aggregate_key, 'docflow_floating_widget_aggregate');
    const w = out.refreshed.aggregate as { pending_drafts?: unknown[]; aggregate_key?: string };
    assert.equal(w.aggregate_key, 'docflow_floating_widget_aggregate');
    assert.ok(Array.isArray(w.pending_drafts));
  } finally {
    await cleanupCommEnv(env);
  }
});

test('send_approved_message publishes system message visible to client portal', async () => {
  const env = await createCommEnv('Hello client from rule');
  try {
    const ctx = buildCtx(env.orgId, env.userId);
    const runOut = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'send-test',
    });
    const runId = (runOut.refreshed.aggregate.run as { id: string }).id;
    const draftId = ((runOut.refreshed.aggregate.drafts as { id: string }[])[0] ?? {}).id;
    assert.ok(draftId);

    await executeDocflowCommunicationOfficeCommand(ctx, 'approve_draft_message', {
      org_id: env.orgId,
      rule_run_id: runId,
      draft_id: draftId,
    });
    await executeDocflowCommunicationOfficeCommand(ctx, 'send_approved_message', {
      org_id: env.orgId,
      rule_run_id: runId,
      draft_id: draftId,
    });

    const { data: sentDraft } = await supabaseAdmin
      .from('communication_draft_messages')
      .select('thread_id')
      .eq('id', draftId)
      .single();
    const threadId = String(sentDraft?.thread_id ?? '');
    assert.ok(threadId);

    const inbox = await buildClientPortalInboxAggregate({
      orgId: env.orgId,
      clientId: env.clientId,
      portalUserId: env.portalUserId,
      selectedThreadId: threadId,
    });
    const messages = inbox.messages as { body: string; message_status?: string }[];
    const hit = messages.some((m) => m.body === 'Hello client from rule' && m.message_status === 'published');
    assert.ok(hit, 'portal should show published system message body');
  } finally {
    await cleanupCommEnv(env);
  }
});

test('send_approved_message without portal access stores pending_client_access delivery status', async () => {
  const env = await createCommEnv('Pending delivery until invite');
  try {
    await supabaseAdmin.from('client_portal_users').delete().eq('org_id', env.orgId).eq('client_id', env.clientId);
    const ctx = buildCtx(env.orgId, env.userId);
    const runOut = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'pending-access',
    });
    const runId = (runOut.refreshed.aggregate.run as { id: string }).id;
    const draftId = ((runOut.refreshed.aggregate.drafts as { id: string }[])[0] ?? {}).id;
    assert.ok(draftId);

    await executeDocflowCommunicationOfficeCommand(ctx, 'approve_draft_message', {
      org_id: env.orgId,
      rule_run_id: runId,
      draft_id: draftId,
    });
    const sentOut = await executeDocflowCommunicationOfficeCommand(ctx, 'send_approved_message', {
      org_id: env.orgId,
      rule_run_id: runId,
      draft_id: draftId,
    });

    const draftRows = sentOut.refreshed.aggregate.drafts as Array<{ id: string; delivery_status?: string; delivery_reason?: string }>;
    const sentDraft = draftRows.find((d) => d.id === draftId);
    assert.equal(sentDraft?.delivery_status, 'pending_client_access');
    assert.equal(sentDraft?.delivery_reason, 'client_portal_not_activated');

    const { data: deliveries, error: dErr } = await supabaseAdmin
      .from('client_message_deliveries')
      .select('delivery_status, failure_reason')
      .eq('org_id', env.orgId)
      .eq('client_id', env.clientId)
      .eq('channel', 'docflow')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (dErr) throw dErr;
    assert.equal(deliveries?.delivery_status, 'pending');
    assert.equal(deliveries?.failure_reason, 'client_portal_not_activated');
  } finally {
    await cleanupCommEnv(env);
  }
});

test('communication_rules table is not part of schema (operational tables only)', async () => {
  const { error } = await supabaseAdmin.from('communication_rules').select('id').limit(1);
  assert.ok(error, 'communication_rules should not exist');
});

test('target_filter all creates drafts for all eligible clients', async () => {
  const env = await createCommEnv('TARGET_ALL', { targetFilter: 'all' });
  try {
    const c2 = await createAdditionalActiveClient(env.orgId, env.userId, env.marker, 'c2');
    const ctx = buildCtx(env.orgId, env.userId);
    const out = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'all-target',
    });
    const agg = out.refreshed.aggregate as { drafts: Array<{ client_id: string }>; run: { generated_count: number; skipped_count: number; target_filter_summary?: string } };
    const ids = new Set((agg.drafts ?? []).map((d) => d.client_id));
    assert.ok(ids.has(env.clientId));
    assert.ok(ids.has(c2));
    assert.equal(agg.run.generated_count, 2);
    assert.equal(agg.run.skipped_count, 0);
    assert.equal(agg.run.target_filter_summary, 'All active clients');
  } finally {
    await cleanupCommEnv(env);
  }
});

test('target_filter has_payroll maps to income tax deductions yes (כן) clients only', async () => {
  const env = await createCommEnv('TARGET_PAYROLL', {
    targetFilter: { mode: 'filtered', flags: ['has_payroll'] },
  });
  try {
    const deductionsYesClient = env.clientId;
    const deductionsNoClient = await createAdditionalActiveClient(env.orgId, env.userId, env.marker, 'no-deductions');
    await supabaseAdmin.from('client_tax_settings').upsert(
      [
        {
          organization_id: env.orgId,
          client_id: deductionsYesClient,
          income_tax_deductions_enabled: true,
          vat_type: 'yes',
          vat_frequency: 'monthly',
          income_tax_advance_enabled: false,
        },
        {
          organization_id: env.orgId,
          client_id: deductionsNoClient,
          income_tax_deductions_enabled: false,
          vat_type: 'yes',
          vat_frequency: 'monthly',
          income_tax_advance_enabled: false,
        },
      ],
      { onConflict: 'organization_id,client_id' }
    );
    const ctx = buildCtx(env.orgId, env.userId);
    const out = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'payroll-only',
    });
    const agg = out.refreshed.aggregate as {
      drafts: Array<{ client_id: string }>;
      skipped_clients: Array<{ client_id: string; reason: string }>;
      run: { generated_count: number; target_filter_summary?: string };
    };
    assert.deepEqual((agg.drafts ?? []).map((d) => d.client_id), [deductionsYesClient]);
    assert.equal(agg.run.generated_count, 1);
    assert.equal(agg.run.target_filter_summary, 'לקוחות עם מס הכנסה ניכויים = כן');
    assert.ok((agg.skipped_clients ?? []).some((s) => s.client_id === deductionsNoClient && s.reason === 'has_payroll_not_yes'));
  } finally {
    await cleanupCommEnv(env);
  }
});

test('target_filter vat_monthly excludes unrelated clients', async () => {
  const env = await createCommEnv('TARGET_VAT_MONTHLY', {
    targetFilter: { mode: 'filtered', flags: ['vat_monthly'] },
  });
  try {
    const vatMonthly = env.clientId;
    const vatBiMonthly = await createAdditionalActiveClient(env.orgId, env.userId, env.marker, 'vat-bi');
    await supabaseAdmin.from('client_tax_settings').upsert(
      [
        {
          organization_id: env.orgId,
          client_id: vatMonthly,
          vat_type: 'yes',
          vat_frequency: 'monthly',
          income_tax_advance_enabled: false,
        },
        {
          organization_id: env.orgId,
          client_id: vatBiMonthly,
          vat_type: 'yes',
          vat_frequency: 'bi_monthly',
          income_tax_advance_enabled: false,
        },
      ],
      { onConflict: 'organization_id,client_id' }
    );
    const ctx = buildCtx(env.orgId, env.userId);
    const out = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'vat-monthly',
    });
    const drafts = (out.refreshed.aggregate.drafts as Array<{ client_id: string }>) ?? [];
    assert.deepEqual(drafts.map((d) => d.client_id), [vatMonthly]);
  } finally {
    await cleanupCommEnv(env);
  }
});

test('target_filter selected_clients includes only selected org clients and skips outsiders', async () => {
  const env = await createCommEnv('TARGET_SELECTED', {
    targetFilter: { mode: 'selected_clients', client_ids: [] as string[] },
  });
  let outsiderOrg = '';
  let outsiderClient = '';
  try {
    const c2 = await createAdditionalActiveClient(env.orgId, env.userId, env.marker, 'c2');
    outsiderOrg = randomUUID();
    outsiderClient = randomUUID();
    await supabaseAdmin.from('organizations').insert({
      id: outsiderOrg,
      name: `${env.marker}-outsider-org`,
      country_code: 'IL',
      timezone: 'UTC',
      status: 'active',
    });
    await supabaseAdmin.from('clients').insert({
      id: outsiderClient,
      organization_id: outsiderOrg,
      tax_id: `TAX-${env.marker}-outside`,
      display_name: `${env.marker}-outside-client`,
      status: 'active',
      created_by: env.userId,
    });
    await supabaseAdmin
      .from('country_legal_value_versions')
      .update({
        value_payload_json: {
          type: 'docflow_communication',
          message_template: 'TARGET_SELECTED',
          review_required: true,
          message_type: 'reminder',
          target_filter: { mode: 'selected_clients', client_ids: [env.clientId, outsiderClient] },
          condition_config: {},
        },
      })
      .eq('legal_value_id', env.legalValueId)
      .eq('country_pack_ruleset_id', env.rulesetId);
    const ctx = buildCtx(env.orgId, env.userId);
    const out = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'selected-clients',
    });
    const agg = out.refreshed.aggregate as {
      drafts: Array<{ client_id: string }>;
      skipped_clients: Array<{ client_id: string; reason: string }>;
    };
    assert.deepEqual((agg.drafts ?? []).map((d) => d.client_id), [env.clientId]);
    assert.ok((agg.skipped_clients ?? []).some((s) => s.client_id === outsiderClient && s.reason === 'selected_client_not_in_org_or_inactive'));
    assert.ok((agg.skipped_clients ?? []).some((s) => s.client_id === c2 && s.reason === 'not_in_selected_clients'));
  } finally {
    if (outsiderClient) await supabaseAdmin.from('clients').delete().eq('id', outsiderClient);
    if (outsiderOrg) await supabaseAdmin.from('organizations').delete().eq('id', outsiderOrg);
    await cleanupCommEnv(env);
  }
});

test('unsupported filter flag does not fallback to all', async () => {
  const env = await createCommEnv('TARGET_UNSUPPORTED', {
    targetFilter: { mode: 'filtered', flags: ['totally_unknown_flag'] },
  });
  try {
    await createAdditionalActiveClient(env.orgId, env.userId, env.marker, 'c2');
    const ctx = buildCtx(env.orgId, env.userId);
    const out = await executeDocflowCommunicationOfficeCommand(ctx, 'run_communication_rule', {
      org_id: env.orgId,
      value_key: env.valueKey,
      run_date: '2025-06-01',
      run_context_key: 'unsupported-flag',
    });
    const agg = out.refreshed.aggregate as {
      drafts: Array<{ client_id: string }>;
      run: { generated_count: number; skipped_count: number };
      skipped_clients: Array<{ client_id: string; reason: string }>;
    };
    assert.equal((agg.drafts ?? []).length, 0);
    assert.equal(agg.run.generated_count, 0);
    assert.ok(agg.run.skipped_count >= 2);
    assert.ok((agg.skipped_clients ?? []).every((s) => s.reason.startsWith('unsupported_filter_flag:')));
  } finally {
    await cleanupCommEnv(env);
  }
});
