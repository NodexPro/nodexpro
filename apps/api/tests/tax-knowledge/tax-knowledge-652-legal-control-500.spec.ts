import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../src/shared/errors.js';
import { throwIfSupabaseError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const POST_652_PIN_PERMISSION_DENIED = {
  code: '42501',
  message: 'permission denied for table legal_ingestion_draft_legal_references',
  hint: 'Grant the required privileges to the current role with: GRANT SELECT ON public.legal_ingestion_draft_legal_references TO service_role;',
};

test('TAX-652 post-migration Legal Control 500 is pin-table 42501, mapped to AppError not a raw throw', () => {
  let caught: unknown;
  try {
    throwIfSupabaseError(POST_652_PIN_PERMISSION_DENIED, 'regulationRegistry.draft_references', {
      migrationHint: 'Apply supabase/migrations/653_tax_regulation_registry_service_role_grants.sql on DEV only.',
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof AppError, 'raw PostgREST 42501 must not escape as a non-AppError');
  assert.equal(caught.statusCode, 503);
  assert.equal(caught.code, 'DB_PERMISSION');
  assert.match(caught.message, /legal_ingestion_draft_legal_references/);
  assert.match(String(caught.details?.migration_hint ?? ''), /653_tax_regulation_registry_service_role_grants/);
});

test('TAX-652 trainer aggregate attaches pins through throwIfSupabaseError, not throw pins.error', () => {
  const read = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-read.service.ts');
  const trainer = readRepo('apps/api/src/domains/knowledge-trainer/knowledge-trainer-read.service.ts');
  const countryPack = readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');
  const commands = readRepo('apps/api/src/domains/tax-knowledge/tax-regulation-registry-commands.service.ts');
  const grant = readRepo('supabase/migrations/653_tax_regulation_registry_service_role_grants.sql');
  const original = readRepo('supabase/migrations/652_tax_regulation_registry_owner_catalog.sql');
  assert.match(trainer, /regulation_references = await loadDraftReferences/);
  assert.match(countryPack, /buildRegulationRegistrySlice/);
  assert.match(read, /throwIfSupabaseError\(pins\.error, 'regulationRegistry\.draft_references'/);
  assert.doesNotMatch(read, /throw pins\.error/);
  assert.match(commands, /throwIfSupabaseError\(existingPins\.error/);
  assert.match(grant, /grant select, insert, update, delete/i);
  assert.match(grant, /to service_role/);
  assert.doesNotMatch(grant, /to anon|to authenticated/);
  assert.match(original, /revoke all on table public.legal_ingestion_draft_legal_references from anon, authenticated/);
  assert.doesNotMatch(original, /to service_role/);
});
