import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('Legal Control failed aggregate does not render panel or fabricate empty legal data', () => {
  const page = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const readModels = readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');

  assert.match(page, /OWNER\.legalControl/);
  assert.match(page, /if \(error && !panel\)/);
  assert.match(page, /Legal Control could not be loaded from the server/);
  assert.match(page, /Legal data was not replaced with empty defaults/);
  assert.doesNotMatch(page, /setPanel\(\{\s*\}/);
  assert.doesNotMatch(page, /setPanel\(null\)/);

  assert.match(readModels, /throwIfOwnerLegalControlReadError\(oErr, 'ownerLegalControl\.organizations'\)/);
  assert.match(readModels, /throwIfOwnerLegalControlReadError\(plansError, 'ownerLegalControl\.module_plans'\)/);
  assert.match(readModels, /throwIfOwnerLegalControlReadError\(error, 'ownerLegalControl\.audit_log'\)/);
  assert.match(readModels, /618_owner_legal_control_service_role_privileges\.sql/);
});
