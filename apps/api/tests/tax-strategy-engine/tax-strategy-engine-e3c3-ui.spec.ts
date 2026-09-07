import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const PAGE = 'apps/web/src/pages/PlatformOwnerLegalControl.tsx';
const PANEL = 'apps/web/src/pages/owner-strategy-engine-panel.tsx';
const ENDPOINTS = 'apps/web/src/api/endpoints.ts';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-E3C3: rule pin/unpin named commands remain intact', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);

  assert.match(page, /taxKnowledge=\{taxKnowledge\}/);
  assert.match(panel, /onCommand\(\s*'pin_tax_strategy_rule'/);
  assert.match(panel, /onCommand\(\s*'unpin_tax_strategy_rule'/);
  assert.match(panel, /tax_strategy_version_rule_pin_id/);
  assert.match(panel, /label="Pin rule"/);
  assert.match(panel, /taxKnowledgeRuleVersionPickerRows\(taxKnowledge\)/);
});

test('TAX-E3C3: picker from same-GET tax_knowledge, exact versions, no latest/UUID/JSON', () => {
  const panel = readRepo(PANEL);
  const page = readRepo(PAGE);

  assert.match(panel, /taxKnowledgeRuleVersionPickerRows\(taxKnowledge\)/);
  assert.match(panel, /taxKnowledgeRuleVersionPickerLabel/);
  assert.match(panel, /No tax rule versions are available for this country/);
  assert.match(panel, /<option value="required">Required<\/option>/);
  assert.match(panel, /<option value="prohibited">Prohibited<\/option>/);
  assert.doesNotMatch(panel, /latest/i);
  assert.doesNotMatch(panel, /sort\(.*version_no|newest|defaultToActive/);
  assert.doesNotMatch(panel, /type="text"[\s\S]{0,80}tax_rule_version_id/);
  assert.doesNotMatch(panel, /CommandActionModal|JSON\.stringify|parsePayloadJsonText/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]GET['"]|method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/strategy|apiJson\(`\/owner\/tax/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /ownerLegalControlCountryQueryParams\(taxKnowledgeCountryQuery\)/);
  assert.doesNotMatch(page, /strategyEngineCountryQuery/);
  assert.doesNotMatch(readRepo(ENDPOINTS), /strategy-engine/);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
});

test('TAX-E3C3: gating uses allowed_actions only, no local pin mutation', () => {
  const panel = readRepo(PANEL);
  assert.match(panel, /enabledStrategyAction\([\s\S]{0,80}pin_tax_strategy_rule/);
  assert.match(panel, /enabledStrategyAction\(pendingPin\.allowed_actions, 'unpin_tax_strategy_rule'\)/);
  assert.match(panel, /pin\.rule_title/);
  assert.match(panel, /pin\.rule_code/);
  assert.match(panel, /exactPinnedVersionLabel\(pin\.version_no\)/);
  assert.match(panel, /pin\.pin_role/);
  assert.match(panel, /pin\.status/);
  assert.doesNotMatch(panel, /rule_pins\.push|setRulePins\(/);
  assert.doesNotMatch(panel, /status === ['"]draft['"].*pin_tax_strategy_rule/);
});
