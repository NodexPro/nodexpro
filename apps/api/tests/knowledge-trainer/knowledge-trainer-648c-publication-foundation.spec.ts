import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { taxRulePayloadChecksum } from '../../src/domains/tax-knowledge/tax-knowledge-checksum.pure.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function ownerEmail(): string | null {
  return process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || 'marinator.321@gmail.com';
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function rpcMissing(error: { code?: string; message?: string; details?: string; hint?: string } | null): boolean {
  const blob = errText(error);
  return (
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    /legal_ingestion_apply_tk_proposal_canonical_draft/i.test(blob) ||
    /Could not find the function/i.test(blob)
  );
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

test('TAX-648C live multi-object map, uniqueness, rollback, retry, draft-only, IL/US isolation', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  const email = ownerEmail();
  if (!email) {
    t.skip('PLATFORM_OWNER_EMAIL not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const tableProbe = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposal_publications')
    .select('id')
    .limit(1);
  if (tableProbe.error && isSupabaseMissingTableError(tableProbe.error, 'legal_ingestion_tax_knowledge_proposal_publications')) {
    t.skip('migration 643 not applied');
    return;
  }
  if (tableProbe.error && tableProbe.error.code !== 'PGRST116') {
    const blob = errText(tableProbe.error);
    if (/does not exist|schema cache/i.test(blob)) {
      t.skip('migration 643 not applied');
      return;
    }
  }

  const rpcProbe = await supabaseAdmin.rpc(
    'legal_ingestion_apply_tk_proposal_canonical_draft',
    {
      p_tax_knowledge_proposal_id: randomUUID(),
      p_actor_user_id: randomUUID(),
      p_plan: { country_code: 'IL' },
    },
  );
  if (rpcMissing(rpcProbe.error)) {
    t.skip('migration 643 RPC not applied');
    return;
  }

  const marker = `tk648c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data: ownerRow, error: ownerErr } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (ownerErr) throw new Error(`owner lookup failed: ${errText(ownerErr)}`);
  const actorUserId = ownerRow?.id ? String(ownerRow.id) : null;
  if (!actorUserId) {
    t.skip('owner user row not found');
    return;
  }

  const { error: countryErr } = await supabaseAdmin.from('countries').upsert(
    [
      { code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' },
      { code: 'US', name: 'United States', status: 'active', default_timezone: 'America/New_York' },
    ],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  const packIl = randomUUID();
  const rulesetIl = randomUUID();
  const packUs = randomUUID();
  const rulesetUs = randomUUID();
  const { error: packErr } = await supabaseAdmin.from('country_packs').insert([
    {
      id: packIl,
      country_code: 'IL',
      pack_code: `${marker}_il_pack`,
      name: `${marker} IL pack`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    },
    {
      id: packUs,
      country_code: 'US',
      pack_code: `${marker}_us_pack`,
      name: `${marker} US pack`,
      status: 'enabled',
      framework_version: '1.0.0',
      code_version: '1.0.0',
    },
  ]);
  if (packErr) throw new Error(`country_packs insert failed: ${errText(packErr)}`);
  const { error: rulesetErr } = await supabaseAdmin.from('country_pack_rulesets').insert([
    {
      id: rulesetIl,
      country_pack_id: packIl,
      ruleset_code: `${marker}_il_rs`,
      ruleset_version: '1.0.0',
      effective_from: '2020-01-01',
      status: 'active',
    },
    {
      id: rulesetUs,
      country_pack_id: packUs,
      ruleset_code: `${marker}_us_rs`,
      ruleset_version: '1.0.0',
      effective_from: '2020-01-01',
      status: 'active',
    },
  ]);
  if (rulesetErr) throw new Error(`country_pack_rulesets insert failed: ${errText(rulesetErr)}`);

  const sourceInsert = await supabaseAdmin
    .from('tax_sources')
    .insert([
      {
        country_code: 'IL',
        source_code: `${marker}_il_src`,
        title: 'TAX-648C IL source',
        provenance_type: 'official_guidance',
        status: 'draft',
      },
      {
        country_code: 'US',
        source_code: `${marker}_us_src`,
        title: 'TAX-648C US source',
        provenance_type: 'official_guidance',
        status: 'draft',
      },
    ])
    .select('id, country_code, source_code');
  if (sourceInsert.error) throw new Error(`tax_sources insert failed: ${errText(sourceInsert.error)}`);
  const ilSourceId = String(sourceInsert.data?.find((row) => row.source_code === `${marker}_il_src`)?.id);
  const usSourceId = String(sourceInsert.data?.find((row) => row.source_code === `${marker}_us_src`)?.id);

  const kindInsert = await supabaseAdmin
    .from('tax_legal_node_kinds')
    .insert([
      {
        country_code: 'IL',
        kind_code: `${marker}_il_kind`,
        label: `${marker} IL seif`,
        status: 'draft',
      },
      {
        country_code: 'US',
        kind_code: `${marker}_us_kind`,
        label: `${marker} US section`,
        status: 'draft',
      },
    ])
    .select('id, country_code');
  if (kindInsert.error) throw new Error(`tax_legal_node_kinds insert failed: ${errText(kindInsert.error)}`);
  const ilKindId = String(kindInsert.data?.find((row) => row.country_code === 'IL')?.id);
  const usKindId = String(kindInsert.data?.find((row) => row.country_code === 'US')?.id);

  const usNodeInsert = await supabaseAdmin
    .from('tax_legal_nodes')
    .insert({
      country_code: 'US',
      tax_source_id: usSourceId,
      tax_legal_node_kind_id: usKindId,
      node_code: `${marker}_us_existing`,
      title: `${marker} US node`,
      status: 'draft',
    })
    .select('id')
    .single();
  if (usNodeInsert.error) throw new Error(`US node insert failed: ${errText(usNodeInsert.error)}`);
  const usNodeId = String(usNodeInsert.data.id);

  async function insertProposal(country: 'IL' | 'US', sourceId: string, suffix: string): Promise<string> {
    const docInsert = await supabaseAdmin
      .from('legal_ingestion_documents')
      .insert({
        country_code: country,
        tax_source_id: sourceId,
        input_type: 'text',
        provenance_type: 'official_guidance',
        original_filename: `${marker}-${suffix}.txt`,
        mime_type: 'text/plain',
        byte_size: 16,
        content_sha256: sha256Hex(`${marker}-${country}-${suffix}`),
        uploaded_by: actorUserId,
      })
      .select('id')
      .single();
    if (docInsert.error) throw new Error(`document insert failed: ${errText(docInsert.error)}`);
    const documentId = String(docInsert.data.id);

    const jobInsert = await supabaseAdmin
      .from('legal_ingestion_jobs')
      .insert({
        document_id: documentId,
        country_code: country,
        tax_source_id: sourceId,
        status: 'uploaded',
      })
      .select('id')
      .single();
    if (jobInsert.error) throw new Error(`job insert failed: ${errText(jobInsert.error)}`);

    const draftInsert = await supabaseAdmin
      .from('legal_ingestion_legal_text_drafts')
      .insert({
        country_code: country,
        document_id: documentId,
        job_id: jobInsert.data.id,
        tax_source_id: sourceId,
        kind_label: 'סעיף',
        title: `${marker} draft ${suffix}`,
        original_source_text: `${marker} original`,
        draft_legal_text: `${marker} draft`,
        text_boundary_status: 'certain',
        review_status: 'ready',
        creation_origin: 'owner_manual',
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select('id')
      .single();
    if (draftInsert.error) throw new Error(`draft insert failed: ${errText(draftInsert.error)}`);

    const proposalInsert = await supabaseAdmin
      .from('legal_ingestion_tax_knowledge_proposals')
      .insert({
        country_code: country,
        document_id: documentId,
        tax_source_id: sourceId,
        legal_text_draft_id: draftInsert.data.id,
        creation_origin: 'owner_corrected',
        status: 'proposed',
        revision_no: 1,
        proposal_json: { contract: 'tax_knowledge_proposal_v1', marker, suffix },
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select('id')
      .single();
    if (proposalInsert.error) throw new Error(`proposal insert failed: ${errText(proposalInsert.error)}`);

    const approve = await supabaseAdmin
      .from('legal_ingestion_tax_knowledge_proposals')
      .update({ status: 'owner_approved', updated_by: actorUserId })
      .eq('id', proposalInsert.data.id)
      .select('id, status')
      .single();
    if (approve.error) throw new Error(`proposal approve failed: ${errText(approve.error)}`);
    return String(proposalInsert.data.id);
  }

  function payloadFor(notes: string): Record<string, unknown> {
    return { statement: notes, applies_if: null, does_not_apply_if: null, notes };
  }

  function rulePlan(localKey: string, nodeKeys: string[], notes: string, extras: Record<string, unknown> = {}) {
    const payload = payloadFor(notes);
    return {
      local_key: localKey,
      title: `${marker} ${localKey}`,
      rule_code: `${marker}_${localKey}`.replace(/[^a-z0-9_]/gi, '_').slice(0, 80),
      legal_node_local_keys: nodeKeys,
      version: {
        effective_from: '2024-01-01',
        payload_json: payload,
        payload_checksum: taxRulePayloadChecksum(payload),
      },
      source_pins: [{ locator: `${localKey} pin` }],
      ...extras,
    };
  }

  const ilProposalId = await insertProposal('IL', ilSourceId, 'il-main');
  const usProposalId = await insertProposal('US', usSourceId, 'us-main');
  const failProposalId = await insertProposal('IL', ilSourceId, 'il-fail');
  const isoProposalId = await insertProposal('IL', ilSourceId, 'il-iso');

  const successPlan = {
    country_code: 'IL',
    country_pack_id: packIl,
    country_pack_ruleset_id: rulesetIl,
    nodes: [
      {
        local_key: 'node-parent',
        tax_legal_node_kind_id: ilKindId,
        title: `${marker} parent`,
        node_code: `${marker}_node_parent`,
      },
      {
        local_key: 'node-child',
        parent_local_key: 'node-parent',
        tax_legal_node_kind_id: ilKindId,
        title: `${marker} child`,
        node_code: `${marker}_node_child`,
      },
    ],
    rules: [rulePlan('rule-a', ['node-parent'], 'rule a'), rulePlan('rule-b', ['node-child'], 'rule b')],
    relationships: [{ from_local_key: 'rule-a', to_local_key: 'rule-b', relationship_type: 'depends_on' }],
    unresolved: [
      {
        from_local_key: 'rule-a',
        relationship_intent: 'depends_on',
        locator_text: `${marker} unresolved`,
        cited_instrument_kind: 'section',
      },
    ],
  };

  const k4Before = await supabaseAdmin.from('tax_calculation_definitions').select('id', { count: 'exact', head: true });
  const factsBefore = await supabaseAdmin.from('tax_fact_definitions').select('id', { count: 'exact', head: true });
  const valuesBefore = await supabaseAdmin.from('country_legal_values').select('id', { count: 'exact', head: true });

  const first = await supabaseAdmin.rpc(
    'legal_ingestion_apply_tk_proposal_canonical_draft',
    {
      p_tax_knowledge_proposal_id: ilProposalId,
      p_actor_user_id: actorUserId,
      p_plan: successPlan,
    },
  );
  if (first.error) throw new Error(`IL publish failed: ${errText(first.error)}`);
  const firstRow = first.data as {
    already_published: boolean;
    status: string;
    publications: Array<{ local_kind: string; local_key: string; canonical_object_id: string }>;
    published_tax_rule_id: string;
    published_tax_rule_version_id: string;
    published_tax_legal_node_id: string;
  };
  assert.equal(firstRow.already_published, false);
  assert.equal(firstRow.status, 'published_to_canonical_draft');
  const nodeMaps = firstRow.publications.filter((row) => row.local_kind === 'legal_node');
  const ruleMaps = firstRow.publications.filter((row) => row.local_kind === 'rule');
  const versionMaps = firstRow.publications.filter((row) => row.local_kind === 'rule_version');
  assert.equal(nodeMaps.length, 2);
  assert.equal(ruleMaps.length, 2);
  assert.equal(versionMaps.length, 2);

  const versionIds = versionMaps.map((row) => row.canonical_object_id);
  const { data: versions, error: versionErr } = await supabaseAdmin
    .from('tax_rule_versions')
    .select('id, status')
    .in('id', versionIds);
  if (versionErr) throw new Error(errText(versionErr));
  assert.ok((versions ?? []).every((row) => row.status === 'draft'));
  assert.equal((versions ?? []).length, 2);

  const childNodeId = nodeMaps.find((row) => row.local_key === 'node-child')?.canonical_object_id;
  const { data: childNode, error: childErr } = await supabaseAdmin
    .from('tax_legal_nodes')
    .select('id, parent_node_id, status, country_code')
    .eq('id', childNodeId)
    .single();
  if (childErr) throw new Error(errText(childErr));
  assert.equal(childNode.status, 'draft');
  assert.equal(childNode.country_code, 'IL');
  assert.equal(childNode.parent_node_id, nodeMaps.find((row) => row.local_key === 'node-parent')?.canonical_object_id);

  const { data: links, error: linkErr } = await supabaseAdmin
    .from('tax_rule_legal_nodes')
    .select('id')
    .in(
      'tax_rule_id',
      ruleMaps.map((row) => row.canonical_object_id),
    );
  if (linkErr) throw new Error(errText(linkErr));
  assert.equal((links ?? []).length, 2);

  const { data: auditRows, error: auditErr } = await supabaseAdmin
    .from('audit_log')
    .select('id, action')
    .eq('entity_id', ilProposalId)
    .eq('action', 'legal_training_tax_knowledge_proposal_published_to_canonical_draft');
  if (auditErr) throw new Error(errText(auditErr));
  assert.ok((auditRows ?? []).length >= 1);

  const retry = await supabaseAdmin.rpc(
    'legal_ingestion_apply_tk_proposal_canonical_draft',
    {
      p_tax_knowledge_proposal_id: ilProposalId,
      p_actor_user_id: actorUserId,
      p_plan: successPlan,
    },
  );
  if (retry.error) throw new Error(`retry failed: ${errText(retry.error)}`);
  const retryRow = retry.data as typeof firstRow;
  assert.equal(retryRow.already_published, true);
  assert.deepEqual(
    retryRow.publications.map((row) => row.canonical_object_id).sort(),
    firstRow.publications.map((row) => row.canonical_object_id).sort(),
  );

  const { data: nodesAfterRetry, error: nodesRetryErr } = await supabaseAdmin
    .from('tax_legal_nodes')
    .select('id')
    .like('node_code', `${marker}_node_%`);
  if (nodesRetryErr) throw new Error(errText(nodesRetryErr));
  assert.equal((nodesAfterRetry ?? []).length, 2);

  const dup = await supabaseAdmin.from('legal_ingestion_tax_knowledge_proposal_publications').insert({
    tax_knowledge_proposal_id: ilProposalId,
    country_code: 'IL',
    local_kind: 'legal_node',
    local_key: 'node-parent',
    canonical_object_type: 'tax_legal_node',
    canonical_object_id: nodeMaps[0].canonical_object_id,
  });
  assert.ok(dup.error, 'same local_key must not map twice');
  assert.match(errText(dup.error), /duplicate|unique|already maps/i);

  const { count: k4After } = await supabaseAdmin
    .from('tax_calculation_definitions')
    .select('id', { count: 'exact', head: true });
  const { count: factsAfter } = await supabaseAdmin
    .from('tax_fact_definitions')
    .select('id', { count: 'exact', head: true });
  const { count: valuesAfter } = await supabaseAdmin
    .from('country_legal_values')
    .select('id', { count: 'exact', head: true });
  assert.equal(k4After ?? 0, k4Before.count ?? 0);
  assert.equal(factsAfter ?? 0, factsBefore.count ?? 0);
  assert.equal(valuesAfter ?? 0, valuesBefore.count ?? 0);

  const failPlan = {
    country_code: 'IL',
    country_pack_id: packIl,
    country_pack_ruleset_id: rulesetIl,
    nodes: [
      {
        local_key: 'fail-parent',
        tax_legal_node_kind_id: ilKindId,
        title: `${marker} fail parent`,
        node_code: `${marker}_fail_parent`,
      },
      {
        local_key: 'fail-child',
        parent_local_key: 'fail-parent',
        tax_legal_node_kind_id: ilKindId,
        title: `${marker} fail child`,
        node_code: `${marker}_fail_child`,
      },
    ],
    rules: [
      {
        ...rulePlan('fail-rule-a', ['fail-parent'], 'fail a'),
      },
      {
        ...rulePlan('fail-rule-b', ['fail-child'], 'fail b', {
          legal_value_ids: [randomUUID()],
        }),
      },
    ],
  };
  const failed = await supabaseAdmin.rpc(
    'legal_ingestion_apply_tk_proposal_canonical_draft',
    {
      p_tax_knowledge_proposal_id: failProposalId,
      p_actor_user_id: actorUserId,
      p_plan: failPlan,
    },
  );
  assert.ok(failed.error, 'missing legal_value_id must fail closed');
  assert.match(errText(failed.error), /legal_value_id|Country Legal Values/i);

  const { data: leftoverNodes, error: leftoverNodeErr } = await supabaseAdmin
    .from('tax_legal_nodes')
    .select('id')
    .like('node_code', `${marker}_fail_%`);
  if (leftoverNodeErr) throw new Error(errText(leftoverNodeErr));
  assert.equal((leftoverNodes ?? []).length, 0);

  const { data: leftoverRules, error: leftoverRuleErr } = await supabaseAdmin
    .from('tax_rules')
    .select('id')
    .like('rule_code', `${marker}_fail%`);
  if (leftoverRuleErr) throw new Error(errText(leftoverRuleErr));
  assert.equal((leftoverRules ?? []).length, 0);

  const { data: leftoverMap, error: leftoverMapErr } = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposal_publications')
    .select('id')
    .eq('tax_knowledge_proposal_id', failProposalId);
  if (leftoverMapErr) throw new Error(errText(leftoverMapErr));
  assert.equal((leftoverMap ?? []).length, 0);

  const { data: failStatus, error: failStatusErr } = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposals')
    .select('status, published_tax_rule_id')
    .eq('id', failProposalId)
    .single();
  if (failStatusErr) throw new Error(errText(failStatusErr));
  assert.equal(failStatus.status, 'owner_approved');
  assert.equal(failStatus.published_tax_rule_id, null);

  const iso = await supabaseAdmin.rpc(
    'legal_ingestion_apply_tk_proposal_canonical_draft',
    {
      p_tax_knowledge_proposal_id: isoProposalId,
      p_actor_user_id: actorUserId,
      p_plan: {
        country_code: 'IL',
        nodes: [
          {
            local_key: 'us-leak',
            existing_tax_legal_node_id: usNodeId,
          },
        ],
      },
    },
  );
  assert.ok(iso.error, 'US node must not publish onto an IL proposal');
  assert.match(errText(iso.error), /country|tax_source/i);

  const usPlan = {
    country_code: 'US',
    country_pack_id: packUs,
    country_pack_ruleset_id: rulesetUs,
    nodes: [
      {
        local_key: 'us-node',
        tax_legal_node_kind_id: usKindId,
        title: `${marker} us published`,
        node_code: `${marker}_us_node`,
      },
    ],
    rules: [rulePlan('us-rule', ['us-node'], 'us rule')],
  };
  const usPub = await supabaseAdmin.rpc(
    'legal_ingestion_apply_tk_proposal_canonical_draft',
    {
      p_tax_knowledge_proposal_id: usProposalId,
      p_actor_user_id: actorUserId,
      p_plan: usPlan,
    },
  );
  if (usPub.error) throw new Error(`US publish failed: ${errText(usPub.error)}`);
  const usRow = usPub.data as typeof firstRow;
  assert.equal(usRow.already_published, false);
  assert.equal(usRow.publications.filter((row) => row.local_kind === 'legal_node').length, 1);
  assert.equal(usRow.publications.filter((row) => row.local_kind === 'rule').length, 1);

  const { data: usPublishedNode, error: usPublishedErr } = await supabaseAdmin
    .from('tax_legal_nodes')
    .select('country_code, status')
    .eq('id', usRow.published_tax_legal_node_id)
    .single();
  if (usPublishedErr) throw new Error(errText(usPublishedErr));
  assert.equal(usPublishedNode.country_code, 'US');
  assert.equal(usPublishedNode.status, 'draft');

  const { data: crossMap, error: crossMapErr } = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposal_publications')
    .select('id')
    .eq('tax_knowledge_proposal_id', ilProposalId)
    .eq('canonical_object_id', usRow.published_tax_legal_node_id);
  if (crossMapErr) throw new Error(errText(crossMapErr));
  assert.equal((crossMap ?? []).length, 0);

  const helperDenied = await supabaseAdmin.rpc('legal_ingestion_publication_map_put', {
    p_proposal_id: ilProposalId,
    p_country_code: 'IL',
    p_local_kind: 'legal_node',
    p_local_key: 'should-not-write',
    p_canonical_object_type: 'tax_legal_node',
    p_canonical_object_id: firstRow.published_tax_legal_node_id,
  });
  assert.ok(helperDenied.error, 'helper map_put must not be a service_role writer');
});
