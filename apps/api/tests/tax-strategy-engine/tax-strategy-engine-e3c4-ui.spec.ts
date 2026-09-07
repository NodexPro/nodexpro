import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const PAGE = 'apps/web/src/pages/PlatformOwnerLegalControl.tsx';
const PANEL = 'apps/web/src/pages/owner-strategy-engine-panel.tsx';
const TYPES = 'apps/web/src/pages/owner-legal-control-types.ts';
const ENDPOINTS = 'apps/web/src/api/endpoints.ts';

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('TAX-E3C4: calc pin/unpin named commands, E3C3 rule pins remain', () => {
  const panel = readRepo(PANEL);
  const types = readRepo(TYPES);

  assert.match(types, /pin_catalog: OwnerTaxStrategyPinCatalog/);
  assert.match(types, /calculation_definition_versions: OwnerTaxStrategyCalculationDefinitionVersionCatalogRow/);
  assert.match(panel, /onCommand\(\s*'pin_tax_strategy_calculation'/);
  assert.match(panel, /onCommand\(\s*'unpin_tax_strategy_calculation'/);
  assert.match(panel, /tax_strategy_version_calculation_pin_id/);
  assert.match(panel, /calculation_definition_version_id/);
  assert.match(panel, /label="Pin calculation"/);
  assert.match(panel, /onCommand\(\s*'pin_tax_strategy_rule'/);
  assert.match(panel, /onCommand\(\s*'unpin_tax_strategy_rule'/);
  assert.match(panel, /label="Pin rule"/);
});

test('TAX-E3C4: picker from same-GET pin_catalog, no latest/UUID/JSON/second GET', () => {
  const panel = readRepo(PANEL);
  const page = readRepo(PAGE);

  assert.match(panel, /strategyCalculationVersionPickerRows\(strategyEngine\.pin_catalog\)/);
  assert.match(panel, /strategyCalculationVersionPickerLabel/);
  assert.match(panel, /No calculation definition versions are available for this country/);
  assert.doesNotMatch(panel, /latest/i);
  assert.doesNotMatch(panel, /sort\(.*version_no|newest|defaultToActive/);
  assert.doesNotMatch(panel, /type="text"[\s\S]{0,80}calculation_definition_version_id/);
  assert.doesNotMatch(panel, /CommandActionModal|JSON\.stringify|parsePayloadJsonText/);
  assert.doesNotMatch(panel, /apiJson\(|fetch\(|method:\s*['"]GET['"]|method:\s*['"]PATCH['"]/);
  assert.doesNotMatch(page, /apiJson\(`\/owner\/strategy|apiJson\(`\/owner\/calculat/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /ownerLegalControlCountryQueryParams\(taxKnowledgeCountryQuery\)/);
  assert.doesNotMatch(readRepo(ENDPOINTS), /strategy-engine|\/calculations/);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
});

test('TAX-E3C4: gating uses allowed_actions only, display uses exact pinned version', () => {
  const panel = readRepo(PANEL);
  assert.match(panel, /enabledStrategyAction\([\s\S]{0,80}pin_tax_strategy_calculation/);
  assert.match(panel, /enabledStrategyAction\(pendingCalcPin\.allowed_actions, 'unpin_tax_strategy_calculation'\)/);
  assert.match(panel, /pin\.calculation_title/);
  assert.match(panel, /pin\.calculation_code/);
  assert.match(panel, /exactPinnedVersionLabel\(pin\.version_no\)/);
  assert.match(panel, /pin\.status/);
  assert.doesNotMatch(panel, /calculation_pins\.push|setCalculationPins\(/);
  assert.doesNotMatch(panel, /status === ['"]draft['"].*pin_tax_strategy_calculation/);
});
