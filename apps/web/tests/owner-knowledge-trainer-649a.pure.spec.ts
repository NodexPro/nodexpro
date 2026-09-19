import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-649A Owner UI selects a trainer document only through the named command', () => {
  const panel = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const owner = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const css = readRepo('apps/web/src/styles/nx-modal.css');

  assert.match(panel, /TrainerDocumentSelector/);
  assert.match(panel, /trainer\.documents/);
  assert.match(panel, /select_legal_training_document/);
  assert.match(panel, /legal_ingestion_document_id/);
  assert.match(panel, /selectAction\.enabled !== true/);
  assert.doesNotMatch(panel, /documents\[0\]/);
  assert.doesNotMatch(panel, /filtered\[0\]/);
  assert.doesNotMatch(panel, /startsWith\('tk648/);
  assert.doesNotMatch(panel, /LegalInformation_kesher/);
  assert.doesNotMatch(panel, /fetch\(/);
  assert.doesNotMatch(panel, /method:\s*['"]PATCH['"]/);
  assert.match(css, /nx-legal-trainer-document-select/);
  assert.match(owner, /LEGAL_TEXT_DRAFT_COMMANDS[\s\S]*select_legal_training_document/);
  assert.match(owner, /setPanel\(out\.refreshed\.aggregate\)/);
  assert.doesNotMatch(owner, /activate_tax_rule_version/);
});
