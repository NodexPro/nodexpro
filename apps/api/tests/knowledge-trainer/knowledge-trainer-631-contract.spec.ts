import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLegalIdentifier } from '../../src/domains/tax-knowledge/legal-identifier.pure.js';
import { capabilityRequiredForOwnerCommand } from '../../src/domains/owner-country-legal-access/owner-country-legal-access.pure.js';
import {
  createDraftRequiresParentFirst,
  draftWouldCycle,
  findDraftIdentityConflict,
  reparentScopeError,
  validateDraftReady,
} from '../../src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const types = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
const commands = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-commands.service.ts');
const draftService = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.service.ts');
const draftPure = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-legal-text-draft.pure.ts');
const read = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
const persist = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-structure.service.ts');
const worker = () => readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-worker.runtime.ts');
const access = () => readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access.pure.ts');
const resolve = () =>
  readRepo('apps/api/src/domains/owner-country-legal-access/owner-country-legal-access-country-resolve.service.ts');

const DRAFT_COMMANDS = [
  'create_legal_text_draft_from_candidate',
  'update_legal_text_draft_text',
  'update_legal_text_draft_identity',
  'reparent_legal_text_draft',
  'set_legal_text_draft_boundary',
  'reset_legal_text_draft_to_source',
  'set_legal_text_draft_review_status',
] as const;

test('TAX-631 named commands exist and return refreshed Owner aggregate', () => {
  const typesSrc = types();
  const commandsSrc = commands();
  for (const command of DRAFT_COMMANDS) {
    assert.match(typesSrc, new RegExp(`'${command}'`));
    assert.match(commandsSrc, new RegExp(`case '${command}':`));
  }
  assert.match(commandsSrc, /handleLegalTextDraftCommand/);
  assert.match(commandsSrc, /refreshed: await refreshed\(/);
  assert.match(commandsSrc, /aggregate_key: 'owner_legal_control_panel_aggregate'/);
  assert.doesNotMatch(commandsSrc, /router\.(patch|put)\(/i);
  assert.doesNotMatch(draftService(), /\.update\([^)]*\)[\s\S]{0,80}original_source_text/);
});

test('create draft uses persisted evidence only and never downloads PDF Storage', () => {
  const service = draftService();
  assert.match(service, /export async function createLegalTextDraftFromCandidate/);
  assert.match(service, /page_text, page_text_items/);
  assert.match(service, /captureExclusiveSourceBody/);
  assert.match(service, /original_source_text: captured\.text/);
  assert.match(service, /draft_legal_text: captured\.text/);
  assert.match(service, /source_candidate_id: candidateId/);
  assert.doesNotMatch(service, /downloadOwnerLegalMaterial/);
  assert.doesNotMatch(service, /createWorkerPdfSourceCache/);
  assert.doesNotMatch(service, /getBytes\(/);
  assert.doesNotMatch(service, /storage\.from\(/);
  assert.doesNotMatch(service, /file_base64/);
  assert.doesNotMatch(commands(), /downloadOwnerLegalMaterial/);
  const createFn = service.slice(service.indexOf('export async function createLegalTextDraftFromCandidate'));
  assert.doesNotMatch(createFn.slice(0, createFn.indexOf('export async function updateLegalTextDraftText')), /downloadOwnerLegalMaterial/);
});

test('create is idempotent per document + source candidate and refuses missing parent drafts', () => {
  const service = draftService();
  assert.match(service, /eq\('source_candidate_id', candidateId\)/);
  assert.match(service, /duplicate: true/);
  assert.match(service, /PARENT_DRAFT_REQUIRED/);
  assert.match(service, /Create the parent legal-text draft first/);
  assert.match(service, /createDraftRequiresParentFirst/);
  assert.equal(createDraftRequiresParentFirst('parent-candidate', null), true);
  assert.equal(createDraftRequiresParentFirst('parent-candidate', 'parent-draft'), false);
  assert.match(draftPure(), /createDraftRequiresParentFirst/);
});

test('Owner can edit draft text, identity, parent, boundary, review; original source stays immutable', () => {
  const service = draftService();
  assert.match(service, /export async function updateLegalTextDraftText/);
  assert.match(service, /update\(\{ draft_legal_text: payload\.draft_legal_text/);
  assert.match(service, /export async function updateLegalTextDraftIdentity/);
  assert.match(service, /parseLegalIdentifier/);
  assert.match(service, /export async function reparentLegalTextDraft/);
  assert.match(service, /parent_draft_id: newParentId/);
  assert.match(service, /export async function setLegalTextDraftBoundary/);
  assert.match(service, /owner_source_page_start/);
  assert.match(service, /text_boundary_status: 'owner_defined'/);
  assert.match(service, /reset_from_boundary === true/);
  assert.match(service, /export async function resetLegalTextDraftToSource/);
  assert.match(service, /export async function setLegalTextDraftReviewStatus/);
  function fnBody(name: string, next: string): string {
    const start = service.indexOf(`export async function ${name}`);
    const end = service.indexOf(`export async function ${next}`);
    return service.slice(start, end < 0 ? undefined : end);
  }
  assert.doesNotMatch(fnBody('updateLegalTextDraftText', 'updateLegalTextDraftIdentity'), /original_source_/);
  assert.doesNotMatch(fnBody('updateLegalTextDraftIdentity', 'reparentLegalTextDraft'), /original_source_/);
  assert.doesNotMatch(fnBody('reparentLegalTextDraft', 'setLegalTextDraftBoundary'), /original_source_/);
  assert.doesNotMatch(fnBody('setLegalTextDraftBoundary', 'resetLegalTextDraftToSource'), /original_source_/);
  const resetFn = fnBody('resetLegalTextDraftToSource', 'setLegalTextDraftReviewStatus');
  assert.match(resetFn, /draft_legal_text: text/);
  assert.doesNotMatch(resetFn, /original_source_text:/);
});

test('exact identifier edit keeps 3(ט1) distinct from 3(ט)(1); same-parent uniqueness only', () => {
  const tet1 = parseLegalIdentifier('3(ט1)');
  const tetThen1 = parseLegalIdentifier('3(ט)(1)');
  assert.ok(tet1 && tetThen1);
  assert.notEqual(tet1.normalized_machine_identifier, tetThen1.normalized_machine_identifier);
  const one = parseLegalIdentifier('2(1)')!;
  assert.equal(
    findDraftIdentityConflict(
      {
        id: 'a',
        parent_draft_id: 'p1',
        kind_label: 'פסקה',
        normalized_machine_identifier: one.normalized_machine_identifier,
      },
      [
        {
          id: 'b',
          parent_draft_id: 'p2',
          kind_label: 'פסקה',
          normalized_machine_identifier: one.normalized_machine_identifier,
        },
      ],
    ),
    null,
  );
  assert.equal(
    findDraftIdentityConflict(
      {
        id: 'a',
        parent_draft_id: 'p1',
        kind_label: 'פסקה',
        normalized_machine_identifier: one.normalized_machine_identifier,
      },
      [
        {
          id: 'c',
          parent_draft_id: 'p1',
          kind_label: 'פסקה',
          normalized_machine_identifier: one.normalized_machine_identifier,
        },
      ],
    )?.id,
    'c',
  );
  assert.match(draftService(), /Exact legal identifier already exists under this parent/);
  assert.match(draftService(), /legal_identifier is not a valid exact legal identifier/);
});

test('reparent rejects cycles, cross-document parents, and does not infer a new citation', () => {
  const rows = [
    { id: 'root', parent_draft_id: null, document_id: 'doc-a', country_code: 'IL', kind_label: 'סעיף' },
    { id: 'child', parent_draft_id: 'root', document_id: 'doc-a', country_code: 'IL', kind_label: 'סעיף קטן' },
    { id: 'other', parent_draft_id: null, document_id: 'doc-b', country_code: 'IL', kind_label: 'סעיף' },
  ];
  assert.equal(draftWouldCycle('root', 'child', rows), true);
  assert.match(reparentScopeError({ id: 'child', document_id: 'doc-a', country_code: 'IL' }, rows[2]) ?? '', /same document/);
  const reparentFn = draftService().slice(draftService().indexOf('export async function reparentLegalTextDraft'));
  assert.match(reparentFn, /draftWouldCycle/);
  assert.match(reparentFn, /reparentScopeError/);
  assert.doesNotMatch(reparentFn.slice(0, 2800), /parseLegalIdentifier/);
  assert.doesNotMatch(reparentFn.slice(0, 2800), /source_display_identifier/);
});

test('uncertain boundary cannot silently become ready; READY is not canonical', () => {
  const blocked = validateDraftReady({
    source_display_identifier: '2',
    kind_label: 'סעיף',
    parent_draft_id: null,
    draft_legal_text: 'body',
    original_source_text: 'body',
    text_boundary_status: 'uncertain',
    identityConflict: false,
    hierarchyCompatible: true,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.message, /Uncertain source boundary/);
  assert.match(draftService(), /review_status must be draft, needs_review, or ready/);
  assert.doesNotMatch(draftService(), /review_status === 'accepted'/);
  assert.doesNotMatch(draftService(), /activate_tax_legal_node/);
  assert.doesNotMatch(draftPure(), /review_status === 'accepted'|published|canonical activation/);
});

test('future structure rebuild cannot own or reset Owner drafts', () => {
  const persistSrc = persist();
  const workerSrc = worker();
  const typesSrc = types();
  assert.doesNotMatch(persistSrc, /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(persistSrc, /resetLegalTextDraftToSource/);
  assert.doesNotMatch(persistSrc, /draft_legal_text/);
  assert.doesNotMatch(workerSrc, /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(typesSrc, /legal_ingestion_legal_text_drafts/);
  assert.doesNotMatch(
    typesSrc,
    /WORKER_ALLOWED_TABLES = \[[\s\S]*legal_ingestion_legal_text_drafts/,
  );
  const updateText = draftService().slice(draftService().indexOf('export async function updateLegalTextDraftText'));
  assert.doesNotMatch(updateText, /active_structure_run_id/);
});

test('source notes are exposed as evidence, not copied into drafts or canonical relationships', () => {
  const service = draftService();
  const readSrc = read();
  assert.match(readSrc, /legal_text_drafts/);
  assert.match(readSrc, /source_notes/);
  assert.match(readSrc, /unresolved_source_note_count/);
  assert.match(readSrc, /notesOverlappingDraftSpan/);
  assert.match(readSrc, /display_identifier/);
  assert.match(readSrc, /parent_display_label/);
  assert.match(readSrc, /original_source_text/);
  assert.match(readSrc, /text_boundary_status/);
  assert.match(readSrc, /provenance/);
  assert.doesNotMatch(service, /from\('legal_ingestion_source_notes'\)\s*\.insert/);
  assert.doesNotMatch(service, /from\('tax_rule_relationships'\)/);
  assert.doesNotMatch(service, /from\('tax_legal_nodes'\)\s*\.insert/);
  assert.doesNotMatch(service, /executeTaxKnowledgeCommand/);
  assert.doesNotMatch(service, /accepted_tax_legal_node_id/);
});

test('TAX-631 does not rebuild, start worker, write canonical law, or touch 620-630 / UI / PROD', () => {
  for (const rel of [
    'supabase/migrations/620_owner_country_legal_access.sql',
    'supabase/migrations/621_country_localization.sql',
    'supabase/migrations/622_tax_legal_library_foundation.sql',
    'supabase/migrations/623_legal_value_version_authorities.sql',
    'supabase/migrations/624_knowledge_trainer_ingestion_foundation.sql',
    'supabase/migrations/625_knowledge_trainer_page_layout_evidence.sql',
    'supabase/migrations/626_exact_legal_identifiers.sql',
    'supabase/migrations/627_legal_ingestion_structure_runs.sql',
    'supabase/migrations/628_legal_identifier_printed_marker.sql',
    'supabase/migrations/629_legal_ingestion_source_evidence.sql',
    'supabase/migrations/630_legal_ingestion_legal_text_drafts.sql',
  ]) {
    assert.equal(existsSync(join(repoRoot, rel)), true);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/631_legal_text_draft_commands.sql')), false);
  const webPanel = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  assert.doesNotMatch(webPanel, /create_legal_text_draft_from_candidate/);
  assert.doesNotMatch(commands(), /runKnowledgeTrainerWorkerTick/);
  assert.doesNotMatch(draftService(), /persistStructureCandidatesForJob/);
});

test('authorization maps draft commands to Owner legal capabilities, not activate', () => {
  assert.equal(capabilityRequiredForOwnerCommand('create_legal_text_draft_from_candidate'), 'legal_knowledge.draft_create');
  assert.equal(capabilityRequiredForOwnerCommand('update_legal_text_draft_text'), 'legal_knowledge.draft_edit');
  assert.equal(capabilityRequiredForOwnerCommand('set_legal_text_draft_review_status'), 'legal_knowledge.review');
  assert.notEqual(capabilityRequiredForOwnerCommand('create_legal_text_draft_from_candidate'), 'legal_knowledge.activate');
  assert.match(access(), /create_legal_text_draft_from_candidate/);
  assert.match(resolve(), /legal_ingestion_legal_text_drafts/);
  assert.match(resolve(), /legal_text_draft_id/);
  assert.match(resolve(), /create_legal_text_draft_from_candidate/);
});
