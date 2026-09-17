import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');
const sqlRel = 'supabase/migrations/641_ai_gateway_control_plane.sql';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-641A is the next additive Control Plane migration and does not apply itself', () => {
  assert.equal(existsSync(join(repoRoot, sqlRel)), true);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/641_ai_gateway.sql')), false);
  const sql = readRepo(sqlRel);
  assert.match(sql, /TAX-641A/);
  assert.match(sql, /Do not apply to production/);
  assert.match(sql, /Do not apply in this ticket/);
  assert.match(sql, /jgxezhjctrgfbmmkqqhn/);
  assert.match(sql, /ADDITIVE ONLY/);
  assert.match(sql, /Does not drop, rewrite, or edit migrations 620–640/);
  assert.match(sql, /Does not migrate TAX_KNOWLEDGE_AI_\* env credentials/);
  assert.match(sql, /Env bootstrap remains untouched/);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_tax_knowledge_proposals/i);
  assert.doesNotMatch(sql, /alter table public\.tax_legal_nodes/i);
  assert.doesNotMatch(sql, /alter table public\.tax_rules/i);
  assert.doesNotMatch(sql, /alter table public\.tax_rule_versions/i);
  assert.doesNotMatch(sql, /alter table public\.legal_ingestion_legal_text_drafts/i);
  assert.doesNotMatch(sql, /insert into public\.ai_gateway_providers/i);
  assert.doesNotMatch(sql, /insert into public\.ai_gateway_routing/i);
});

test('TAX-641A provider instances default disabled and keep ciphertext-only secrets', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /create table if not exists public\.ai_gateway_providers/);
  assert.match(sql, /enabled boolean not null default false/);
  assert.match(sql, /new\.enabled := false;/);
  assert.match(sql, /credential_ciphertext text null/);
  assert.match(sql, /credential_updated_at timestamptz null/);
  assert.doesNotMatch(sql, /\bapi_key\b/);
  assert.doesNotMatch(sql, /credential text/);
  assert.doesNotMatch(sql, /password text/);
  assert.doesNotMatch(sql, /masked_api_key/);
  assert.doesNotMatch(sql, /key_fingerprint/);
  assert.match(sql, /AES-256-GCM/);
  assert.match(sql, /CLIENT_DATA_ENCRYPTION_KEY/);
  assert.match(sql, /NEVER plaintext/);
  assert.match(sql, /Aggregates must NOT select credential_ciphertext/);
  assert.match(sql, /credential_configured/);
});

test('TAX-641A adapter_type is a format-constrained code-registry id, not a closed executable enum', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /adapter_type text not null default 'openai_compatible'/);
  assert.match(sql, /ai_gateway_providers_adapter_type_format/);
  assert.match(sql, /\^\[a-z\]\[a-z0-9_\]\{1,63\}\$/);
  assert.match(sql, /Executable adapters live in API code registry, not this database/);
  assert.match(sql, /First shipped adapter: openai_compatible/);
  assert.match(sql, /without redesigning these tables/);
  assert.doesNotMatch(sql, /adapter_type in \('openai_compatible'\)/);
});

test('TAX-641A routing is normalized, FK-backed, ordered, and rejects duplicate providers', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /create table if not exists public\.ai_gateway_routing/);
  assert.match(sql, /position integer not null/);
  assert.match(sql, /provider_id uuid not null references public\.ai_gateway_providers/);
  assert.match(sql, /on delete restrict/);
  assert.match(sql, /constraint ai_gateway_routing_pkey primary key \(position\)/);
  assert.match(sql, /constraint ai_gateway_routing_provider_unique unique \(provider_id\)/);
  assert.match(sql, /ai_gateway_routing_position_positive check \(position >= 1\)/);
  assert.match(sql, /position 1 = Primary/);
  assert.match(sql, /set_ai_provider_routing/);
  assert.doesNotMatch(sql, /routing_json/);
  assert.doesNotMatch(sql, /provider_ids jsonb/);
});

test('TAX-641A invalidates stale tests on configuration change and bounds health snapshots', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /last_test_configuration_digest/);
  assert.match(sql, /\^\[0-9a-f\]\{64\}\$/);
  assert.match(sql, /adapter_type is distinct from old\.adapter_type/);
  assert.match(sql, /base_url is distinct from old\.base_url/);
  assert.match(sql, /pinned_model is distinct from old\.pinned_model/);
  assert.match(sql, /credential_ciphertext is distinct from old\.credential_ciphertext/);
  assert.match(sql, /new\.structured_output_certified := false;/);
  assert.match(sql, /new\.compatibility_status := 'stale';/);
  assert.match(sql, /new\.last_test_configuration_digest := null;/);
  assert.match(sql, /compatibility_status in \('not_tested', 'compatible', 'incompatible', 'stale'\)/);
  assert.match(sql, /ai_gateway_providers_enabled_requires_gate/);
  assert.match(sql, /Does not perform network calls/);
  assert.match(sql, /last_success_at timestamptz null/);
  assert.match(sql, /last_failure_at timestamptz null/);
  assert.match(sql, /last_failure_category text null/);
  assert.match(sql, /last_test_at timestamptz null/);
  assert.match(sql, /last_test_outcome text null/);
  assert.match(sql, /Not a per-request health log/);
  assert.doesNotMatch(sql, /create table if not exists public\.ai_gateway_health/);
  assert.doesNotMatch(sql, /circuit_open/);
  assert.doesNotMatch(sql, /consecutive_failures/);
  assert.doesNotMatch(sql, /half_open/);
});

test('TAX-641A is Platform Owner / service_role only with no tenant path', () => {
  const sql = readRepo(sqlRel);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /force row level security/);
  assert.match(sql, /revoke all on table public\.ai_gateway_providers from anon, authenticated, public/);
  assert.match(sql, /revoke all on table public\.ai_gateway_routing from anon, authenticated, public/);
  assert.match(sql, /grant select, insert, update on table public\.ai_gateway_providers to service_role/);
  assert.match(sql, /grant select, insert, update, delete on table public\.ai_gateway_routing to service_role/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.doesNotMatch(sql, /organization_id/);
  assert.doesNotMatch(sql, /org_id/);
  assert.doesNotMatch(sql, /grant .* to authenticated/);
  assert.doesNotMatch(sql, /grant .* to anon/);
});

test('TAX-641A does not touch Tax Knowledge, B2, commands, UI, gateway failover, or env bootstrap', () => {
  const sql = readRepo(sqlRel);
  const generate = readRepo(
    'apps/api/src/domains/knowledge-trainer/knowledge-trainer-generate-tax-knowledge-proposal.service.ts',
  );
  const gateway = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.service.ts');
  const types = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer.types.ts');
  const sql640 = readRepo('supabase/migrations/640_legal_ingestion_ai_generation_metadata.sql');

  assert.match(sql, /Canonical audit_log remains the only configuration audit system/);
  assert.match(sql, /base_url is configuration only/);
  assert.match(sql, /private \/ localhost \/ link-local \/ metadata/);
  assert.doesNotMatch(sql, /create table if not exists public\.audit_log/);
  assert.doesNotMatch(sql, /references public\.tax_sources/);
  assert.doesNotMatch(sql, /references public\.legal_ingestion_tax_knowledge_proposals/);
  assert.doesNotMatch(sql, /generate_tax_knowledge_proposal/);
  assert.doesNotMatch(sql, /completeStructuredJson/);
  assert.doesNotMatch(sql, /create_ai_provider/);
  assert.doesNotMatch(sql, /TAX_KNOWLEDGE_AI_API_KEY/);
  assert.match(generate, /createGenerateTaxKnowledgeProposal/);
  assert.match(gateway, /buildOpenAiCompatibleStructuredRequest/);
  assert.match(types, /'generate_tax_knowledge_proposal'/);
  assert.match(sql640, /generation_metadata_json jsonb null/);
});
