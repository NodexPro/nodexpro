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

test('TAX-E3C2: named lifecycle commands only, no pin authoring', () => {
  const panel = readRepo(PANEL);
  for (const command of [
    'create_tax_strategy',
    'update_tax_strategy_metadata',
    'create_tax_strategy_exclusive_group',
    'update_tax_strategy_exclusive_group',
    'create_tax_strategy_version',
    'update_tax_strategy_version_draft',
    'activate_tax_strategy_version',
    'retire_tax_strategy_version',
    'close_tax_strategy_version_effective_to',
    'supersede_tax_strategy_version',
  ]) {
    assert.match(panel, new RegExp(`onCommand\\(\\s*'${command}'`));
  }
});

test('TAX-E3C2: allowed_actions gating, human authored form, exact supersede ids', () => {
  const panel = readRepo(PANEL);
  assert.match(panel, /enabledStrategyAction\(/);
  assert.match(panel, /if \(!enabledStrategyAction\(/);
  assert.match(panel, /buildStrategyAuthoredMetadataJson/);
  assert.match(panel, /newlineListToStrings/);
  assert.match(panel, /one per line/);
  assert.doesNotMatch(panel, /CommandActionModal/);
  assert.doesNotMatch(panel, /JSON\.stringify/);
  assert.doesNotMatch(panel, /parsePayloadJsonText/);
  assert.match(panel, /supersedePairsFromStrategyAction/);
  assert.match(
    panel,
    /new_tax_strategy_version_id: pair\.new_tax_strategy_version_id/,
  );
  assert.match(
    panel,
    /old_tax_strategy_version_id: pair\.old_tax_strategy_version_id/,
  );
  assert.doesNotMatch(panel, /eligibleStrategySupersessionPairs|status === ['"]draft['"]/);
  assert.doesNotMatch(panel, /latest/i);
});

test('TAX-E3C2: full panel replace, no hidden GET / PATCH, shared country remains', () => {
  const page = readRepo(PAGE);
  const panel = readRepo(PANEL);
  const endpoints = readRepo(ENDPOINTS);

  assert.match(page, /OwnerStrategyEnginePanel/);
  assert.match(page, /await sendOwnerCommand\(command, payload\)/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /ownerLegalControlCountryQueryParams\(taxKnowledgeCountryQuery\)/);
  assert.doesNotMatch(page, /strategyEngineCountryQuery/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]GET['"]|method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(panel, /setStrategies\(|strategies\.push/);
  assert.doesNotMatch(panel, /selectedStrategy\.versions\.push|strategyEngine\.strategies\.push|setVersions\(/);
  assert.doesNotMatch(endpoints, /strategy-engine/);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
});
