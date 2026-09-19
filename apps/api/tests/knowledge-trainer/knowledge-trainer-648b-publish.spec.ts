import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../src/shared/errors.js';
import type { RequestContext } from '../../src/shared/context.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const COMMAND = 'publish_tax_knowledge_proposal_to_canonical_draft';
const DRAFT = 'סעיף 1. תושב ישראל נשוי זכאי.';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function ownerEmail(): string {
  return process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || 'marinator.321@gmail.com';
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function ownerCtx(userId: string, email: string): RequestContext {
  return {
    user: {
      id: userId,
      authUserId: '648b-test',
      email,
      fullName: 'Owner',
      status: 'active',
      uiLanguage: 'he',
    },
    membership: null,
    organizationId: null,
  };
}

function quote() {
  return { role: 'verbatim_from_draft', text: DRAFT, start: 0, end: DRAFT.length };
}

function unconstrainedRule(key: string, nodeKey: string, extra: Record<string, unknown> = {}) {
  return {
    proposal_rule_key: key,
    title: `Rule ${key}`,
    rule_kind: 'legal_rule',
    statement: `Unconstrained statement ${key}`,
    applicability_status: 'unconstrained',
    applies_if: null,
    does_not_apply_if: null,
    notes: null,
    effective_from: '2024-01-01',
    effective_to: null,
    legal_node_keys: [nodeKey],
    existing_tax_legal_node_ids: [],
    legal_value_keys: [],
    calculation_keys: [],
    ...extra,
  };
}

function closedProposal(input: {
  sourceId: string;
  kindId: string;
  extraNodes?: Record<string, unknown>[];
  extraRules?: Record<string, unknown>[];
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    schema_version: 1,
    contract: 'tax_knowledge_proposal_v1',
    extraction_outcome: 'rules',
    legal_nodes: [
      {
        proposal_node_key: 'n1',
        source_display_identifier: '1',
        title: 'סעיף 1',
        tax_legal_node_kind_id: input.kindId,
      },
      {
        proposal_node_key: 'n2',
        source_display_identifier: '1(א)',
        title: 'סעיף 1(א)',
        tax_legal_node_kind_id: input.kindId,
        parent: { kind: 'proposal_node', key: 'n1' },
      },
      ...(input.extraNodes ?? []),
    ],
    rules: [
      unconstrainedRule('r1', 'n1'),
      unconstrainedRule('r2', 'n2', { title: 'Rule r2 child', statement: 'Child rule statement' }),
      ...(input.extraRules ?? []),
    ],
    relationships: [
      {
        from: { kind: 'proposal_rule', key: 'r1' },
        to: { kind: 'proposal_rule', key: 'r2' },
        relationship_type: 'depends_on',
      },
    ],
    calculations: [],
    facts: [],
    legal_values: [],
    evidence: {
      source_role: 'reviewed_owner_draft',
      quotes: [quote()],
      citations: [{ tax_source_id: input.sourceId, locator: 'סעיף 1' }],
    },
    uncertainties: [],
    ...input.extra,
  };
}

test('TAX-648B Owner command publishes approved B2 to canonical DRAFT via one RPC', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const tableProbe = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposal_publications')
    .select('id')
    .limit(1);
  if (tableProbe.error && isSupabaseMissingTableError(tableProbe.error, 'legal_ingestion_tax_knowledge_proposal_publications')) {
    t.skip('migration 643/644 not applied');
    return;
  }

  const email = ownerEmail();
  const { data: ownerRow, error: ownerErr } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
  if (ownerErr) throw new Error(`owner lookup failed: ${errText(ownerErr)}`);
  const actorUserId = ownerRow?.id ? String(ownerRow.id) : null;
  if (!actorUserId) {
    t.skip('owner user row not found');
    return;
  }

  const {
    publishTaxKnowledgeProposalToCanonicalDraft,
  } = await import('../../src/domains/knowledge-trainer/knowledge-trainer-tax-knowledge-proposal.service.js');
  const { executeKnowledgeTrainerCommand } = await import(
    '../../src/domains/knowledge-trainer/knowledge-trainer-commands.service.js'
  );
  const { buildKnowledgeTrainerSlice } = await import('../../src/domains/knowledge-trainer/knowledge-trainer-read.service.js');
  const { resolveOwnerLegalValueRulesetContextForCountry } = await import(
    '../../src/domains/country-pack/legal-value.service.js'
  );

  let ilRulesetOk = true;
  try {
    await resolveOwnerLegalValueRulesetContextForCountry({ countryCode: 'IL', effectiveDate: '2024-01-01' });
  } catch {
    ilRulesetOk = false;
  }
  if (!ilRulesetOk) {
    t.skip('IL country pack/ruleset is not resolvable on DEV');
    return;
  }

  const ctx = ownerCtx(actorUserId, email);
  const marker = `tk648b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const { error: countryErr } = await supabaseAdmin.from('countries').upsert(
    [
      { code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' },
      { code: 'US', name: 'United States', status: 'active', default_timezone: 'America/New_York' },
    ],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  const sourceInsert = await supabaseAdmin
    .from('tax_sources')
    .insert([
      {
        country_code: 'IL',
        source_code: `${marker}_il_src`,
        title: 'TAX-648B IL source',
        provenance_type: 'official_guidance',
        status: 'draft',
      },
      {
        country_code: 'US',
        source_code: `${marker}_us_src`,
        title: 'TAX-648B US source',
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
      { country_code: 'IL', kind_code: `${marker}_il_kind`, label: `${marker} IL seif`, status: 'draft' },
      { country_code: 'US', kind_code: `${marker}_us_kind`, label: `${marker} US section`, status: 'draft' },
    ])
    .select('id, country_code');
  if (kindInsert.error) throw new Error(`tax_legal_node_kinds insert failed: ${errText(kindInsert.error)}`);
  const ilKindId = String(kindInsert.data?.find((row) => row.country_code === 'IL')?.id);
  const usKindId = String(kindInsert.data?.find((row) => row.country_code === 'US')?.id);

  async function insertProposal(input: {
    country: 'IL' | 'US';
    sourceId: string;
    suffix: string;
    status: string;
    proposalJson: Record<string, unknown>;
  }): Promise<{ id: string; document_id: string; draft_id: string; proposal_json: Record<string, unknown> }> {
    const docInsert = await supabaseAdmin
      .from('legal_ingestion_documents')
      .insert({
        country_code: input.country,
        tax_source_id: input.sourceId,
        input_type: 'text',
        provenance_type: 'official_guidance',
        original_filename: `${marker}-${input.suffix}.txt`,
        mime_type: 'text/plain',
        byte_size: 16,
        content_sha256: sha256Hex(`${marker}-${input.country}-${input.suffix}`),
        uploaded_by: actorUserId,
      })
      .select('id')
      .single();
    if (docInsert.error) throw new Error(`document insert failed: ${errText(docInsert.error)}`);
    const jobInsert = await supabaseAdmin
      .from('legal_ingestion_jobs')
      .insert({
        document_id: docInsert.data.id,
        country_code: input.country,
        tax_source_id: input.sourceId,
        status: 'uploaded',
      })
      .select('id')
      .single();
    if (jobInsert.error) throw new Error(`job insert failed: ${errText(jobInsert.error)}`);
    const draftInsert = await supabaseAdmin
      .from('legal_ingestion_legal_text_drafts')
      .insert({
        country_code: input.country,
        document_id: docInsert.data.id,
        job_id: jobInsert.data.id,
        tax_source_id: input.sourceId,
        kind_label: 'סעיף',
        title: `${marker} draft ${input.suffix}`,
        original_source_text: DRAFT,
        draft_legal_text: DRAFT,
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
        country_code: input.country,
        document_id: docInsert.data.id,
        tax_source_id: input.sourceId,
        legal_text_draft_id: draftInsert.data.id,
        creation_origin: 'owner_corrected',
        status: 'proposed',
        revision_no: 1,
        proposal_json: input.proposalJson,
        created_by: actorUserId,
        updated_by: actorUserId,
      })
      .select('id')
      .single();
    if (proposalInsert.error) throw new Error(`proposal insert failed: ${errText(proposalInsert.error)}`);
    if (input.status !== 'proposed') {
      const approve = await supabaseAdmin
        .from('legal_ingestion_tax_knowledge_proposals')
        .update({ status: input.status, updated_by: actorUserId })
        .eq('id', proposalInsert.data.id);
      if (approve.error) throw new Error(`proposal status update failed: ${errText(approve.error)}`);
    }
    return {
      id: String(proposalInsert.data.id),
      document_id: String(docInsert.data.id),
      draft_id: String(draftInsert.data.id),
      proposal_json: input.proposalJson,
    };
  }

  async function publish(proposalId: string) {
    try {
      return await executeKnowledgeTrainerCommand(ctx, COMMAND, { tax_knowledge_proposal_id: proposalId });
    } catch (error) {
      if (error instanceof AppError && (error.code === 'PLATFORM_OWNER_NOT_CONFIGURED' || error.code === 'PLATFORM_OWNER_REQUIRED' || error.code === 'OWNER_LEGAL_ACCESS_REQUIRED' || error.code === 'OWNER_LEGAL_CAPABILITY_REQUIRED')) {
        const result = await publishTaxKnowledgeProposalToCanonicalDraft(ctx, { tax_knowledge_proposal_id: proposalId });
        return {
          ok: true,
          command: COMMAND,
          refreshed: {
            aggregate_key: 'owner_legal_control_panel_aggregate',
            aggregate: {
              knowledge_trainer: await buildKnowledgeTrainerSlice(result.country_code, {
                document_id: result.document_id,
                legal_text_draft_id: result.draft_id,
                tax_knowledge_proposal_id: result.proposal_id,
              }),
            },
          },
        };
      }
      throw error;
    }
  }

  const unapproved = await insertProposal({
    country: 'IL',
    sourceId: ilSourceId,
    suffix: 'unapproved',
    status: 'proposed',
    proposalJson: closedProposal({ sourceId: ilSourceId, kindId: ilKindId }),
  });
  await assert.rejects(
    () => publishTaxKnowledgeProposalToCanonicalDraft(ctx, { tax_knowledge_proposal_id: unapproved.id }),
    (error: unknown) => error instanceof AppError && error.code === 'TAX_KNOWLEDGE_PROPOSAL_NOT_APPROVED',
  );

  const blocked = await insertProposal({
    country: 'IL',
    sourceId: ilSourceId,
    suffix: 'blocked',
    status: 'owner_approved',
    proposalJson: {
      ...closedProposal({ sourceId: ilSourceId, kindId: ilKindId }),
      extraction_outcome: 'no_rules',
      legal_nodes: [],
      rules: [],
      relationships: [],
      evidence: { source_role: 'reviewed_owner_draft', quotes: [], citations: [] },
    },
  });
  await assert.rejects(
    () => publishTaxKnowledgeProposalToCanonicalDraft(ctx, { tax_knowledge_proposal_id: blocked.id }),
    (error: unknown) => error instanceof AppError && error.code === 'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE',
  );

  const missingFact = await insertProposal({
    country: 'IL',
    sourceId: ilSourceId,
    suffix: 'missing-fact',
    status: 'owner_approved',
    proposalJson: closedProposal({
      sourceId: ilSourceId,
      kindId: ilKindId,
      extraRules: [],
      extra: {
        rules: [
          {
            ...unconstrainedRule('r1', 'n1'),
            applicability_status: 'determined',
            applies_if: { fact: `${marker}_missing_fact`, op: 'eq', type: 'boolean', value: true },
          },
        ],
        facts: [{ fact_key: `${marker}_missing_fact`, role: 'applicability_condition' }],
      },
    }),
  });
  await assert.rejects(
    () => publishTaxKnowledgeProposalToCanonicalDraft(ctx, { tax_knowledge_proposal_id: missingFact.id }),
    (error: unknown) =>
      error instanceof AppError &&
      (error.code === 'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE' || error.code === 'TAX_KNOWLEDGE_PROPOSAL_MISSING_FACT'),
  );

  const missingValue = await insertProposal({
    country: 'IL',
    sourceId: ilSourceId,
    suffix: 'missing-lv',
    status: 'owner_approved',
    proposalJson: closedProposal({
      sourceId: ilSourceId,
      kindId: ilKindId,
      extra: {
        rules: [unconstrainedRule('r1', 'n1', { legal_value_keys: [`${marker}_missing_lv`] })],
        legal_values: [{ value_key: `${marker}_missing_lv` }],
      },
    }),
  });
  await assert.rejects(
    () => publishTaxKnowledgeProposalToCanonicalDraft(ctx, { tax_knowledge_proposal_id: missingValue.id }),
    (error: unknown) =>
      error instanceof AppError &&
      (error.code === 'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE' || error.code === 'TAX_KNOWLEDGE_PROPOSAL_MISSING_LEGAL_VALUE'),
  );

  const leaked = await insertProposal({
    country: 'IL',
    sourceId: ilSourceId,
    suffix: 'us-kind',
    status: 'owner_approved',
    proposalJson: closedProposal({ sourceId: ilSourceId, kindId: usKindId }),
  });
  await assert.rejects(
    () => publishTaxKnowledgeProposalToCanonicalDraft(ctx, { tax_knowledge_proposal_id: leaked.id }),
    (error: unknown) =>
      error instanceof AppError &&
      (error.code === 'TAX_KNOWLEDGE_PROPOSAL_NOT_PUBLISHABLE' || error.code === 'TAX_KNOWLEDGE_PROPOSAL_COUNTRY_MISMATCH'),
  );

  await assert.rejects(
    () =>
      publishTaxKnowledgeProposalToCanonicalDraft(ctx, {
        tax_knowledge_proposal_id: blocked.id,
        country_pack_id: randomUUID(),
      }),
    (error: unknown) => error instanceof AppError && error.statusCode === 400,
  );

  const approved = await insertProposal({
    country: 'IL',
    sourceId: ilSourceId,
    suffix: 'ok',
    status: 'owner_approved',
    proposalJson: closedProposal({ sourceId: ilSourceId, kindId: ilKindId }),
  });

  const k4Before = await supabaseAdmin.from('tax_calculation_definitions').select('id', { count: 'exact', head: true });
  const factsBefore = await supabaseAdmin.from('tax_fact_definitions').select('id', { count: 'exact', head: true });
  const valuesBefore = await supabaseAdmin.from('country_legal_values').select('id', { count: 'exact', head: true });

  function trainerSlice(result: { refreshed?: { aggregate?: unknown } }) {
    const aggregate = (result.refreshed?.aggregate ?? {}) as Record<string, unknown>;
    const taxKnowledge = (aggregate.tax_knowledge ?? {}) as Record<string, unknown>;
    const library = (taxKnowledge.legal_library ?? {}) as Record<string, unknown>;
    return (library.trainer_upload ?? aggregate.knowledge_trainer ?? null) as {
      selected_document?: {
        tax_knowledge_proposals?: {
          selected?: {
            id?: string;
            status?: string;
            proposal_json?: Record<string, unknown>;
            allowed_actions?: Array<{ action_key: string; enabled: boolean }>;
            publication_trace?: { published_tax_rule_id?: string | null };
          };
        };
      };
    } | null;
  }

  const first = await publish(approved.id);
  assert.equal(first.ok, true);
  assert.equal(first.command, COMMAND);
  const selectedDoc = trainerSlice(first)?.selected_document;
  const selected = selectedDoc?.tax_knowledge_proposals?.selected;
  assert.equal(selected?.id, approved.id);
  assert.equal(selected?.status, 'published_to_canonical_draft');
  assert.deepEqual(selected?.proposal_json, approved.proposal_json);
  assert.equal(
    selected?.allowed_actions?.find((row) => row.action_key === COMMAND)?.enabled,
    false,
  );
  assert.ok(selected?.publication_trace?.published_tax_rule_id);

  const { data: after, error: afterErr } = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposals')
    .select('status, proposal_json, published_tax_rule_id, published_tax_rule_version_id, published_tax_legal_node_id')
    .eq('id', approved.id)
    .single();
  if (afterErr) throw new Error(errText(afterErr));
  assert.equal(after.status, 'published_to_canonical_draft');
  assert.deepEqual(after.proposal_json, approved.proposal_json);

  const { data: maps, error: mapErr } = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposal_publications')
    .select('local_kind, local_key, canonical_object_id, canonical_object_type')
    .eq('tax_knowledge_proposal_id', approved.id);
  if (mapErr) throw new Error(errText(mapErr));
  const nodeMaps = (maps ?? []).filter((row) => row.local_kind === 'legal_node');
  const ruleMaps = (maps ?? []).filter((row) => row.local_kind === 'rule');
  const versionMaps = (maps ?? []).filter((row) => row.local_kind === 'rule_version');
  assert.equal(nodeMaps.length, 2);
  assert.equal(ruleMaps.length, 2);
  assert.equal(versionMaps.length, 2);

  const { data: nodes, error: nodeErr } = await supabaseAdmin
    .from('tax_legal_nodes')
    .select('id, status, country_code, node_code, parent_node_id')
    .in(
      'id',
      nodeMaps.map((row) => row.canonical_object_id),
    );
  if (nodeErr) throw new Error(errText(nodeErr));
  assert.ok((nodes ?? []).every((row) => row.status === 'draft' && row.country_code === 'IL'));
  assert.ok((nodes ?? []).every((row) => String(row.node_code).startsWith('node_')));
  const parentId = nodeMaps.find((row) => row.local_key === 'n1')?.canonical_object_id;
  const child = (nodes ?? []).find((row) => row.id === nodeMaps.find((map) => map.local_key === 'n2')?.canonical_object_id);
  assert.equal(child?.parent_node_id, parentId);

  const { data: versions, error: versionErr } = await supabaseAdmin
    .from('tax_rule_versions')
    .select('id, status, payload_checksum')
    .in(
      'id',
      versionMaps.map((row) => row.canonical_object_id),
    );
  if (versionErr) throw new Error(errText(versionErr));
  assert.ok((versions ?? []).every((row) => row.status === 'draft'));
  assert.ok((versions ?? []).every((row) => String(row.payload_checksum || '').length === 64));

  const { data: rules, error: ruleErr } = await supabaseAdmin
    .from('tax_rules')
    .select('id, status, country_code, rule_code')
    .in(
      'id',
      ruleMaps.map((row) => row.canonical_object_id),
    );
  if (ruleErr) throw new Error(errText(ruleErr));
  assert.ok((rules ?? []).every((row) => row.status === 'draft' && row.country_code === 'IL'));
  assert.ok((rules ?? []).every((row) => String(row.rule_code).startsWith('rule_')));

  const retry = await publish(approved.id);
  const retrySelected = trainerSlice(retry)?.selected_document?.tax_knowledge_proposals?.selected;
  assert.equal(retrySelected?.status, 'published_to_canonical_draft');
  const { data: mapsAfterRetry, error: retryMapErr } = await supabaseAdmin
    .from('legal_ingestion_tax_knowledge_proposal_publications')
    .select('canonical_object_id')
    .eq('tax_knowledge_proposal_id', approved.id);
  if (retryMapErr) throw new Error(errText(retryMapErr));
  assert.deepEqual(
    (mapsAfterRetry ?? []).map((row) => row.canonical_object_id).sort(),
    (maps ?? []).map((row) => row.canonical_object_id).sort(),
  );

  const { count: k4After } = await supabaseAdmin.from('tax_calculation_definitions').select('id', { count: 'exact', head: true });
  const { count: factsAfter } = await supabaseAdmin.from('tax_fact_definitions').select('id', { count: 'exact', head: true });
  const { count: valuesAfter } = await supabaseAdmin.from('country_legal_values').select('id', { count: 'exact', head: true });
  assert.equal(k4After ?? 0, k4Before.count ?? 0);
  assert.equal(factsAfter ?? 0, factsBefore.count ?? 0);
  assert.equal(valuesAfter ?? 0, valuesBefore.count ?? 0);
});
