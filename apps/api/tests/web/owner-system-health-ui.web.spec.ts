/**
 * P11.5C — Owner System Center UI contract.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(dir, '../../../web/src');

function readWeb(relPath: string): string {
  return readFileSync(join(webRoot, relPath), 'utf8');
}

const legalControlSource = readWeb('pages/PlatformOwnerLegalControl.tsx');
const systemSectionSource = readWeb('pages/OwnerSystemHealthSection.tsx');

test('lazy load unchanged — system-health only in OwnerSystemHealthSection', () => {
  assert.doesNotMatch(legalControlSource, /OWNER\.systemHealth/);
  assert.match(systemSectionSource, /OWNER\.systemHealth/);
});

test('system subtabs include platform and customer health', () => {
  assert.match(systemSectionSource, /platform_health/);
  assert.match(systemSectionSource, /customer_health/);
  assert.doesNotMatch(systemSectionSource, /'errors'/);
});

test('platform health table renders backend component fields', () => {
  assert.match(systemSectionSource, /aggregate\?\.platform_health\.rows/);
  assert.match(systemSectionSource, /row\.component_label/);
  assert.match(systemSectionSource, /row\.status/);
  assert.match(systemSectionSource, /row\.problem/);
  assert.match(systemSectionSource, /row\.recommendation/);
  assert.match(systemSectionSource, /row\.last_check_at/);
  assert.match(systemSectionSource, /row\.severity/);
});

test('customer health table renders backend enriched org rows', () => {
  assert.match(systemSectionSource, /aggregate\?\.customer_health\.rows/);
  assert.match(systemSectionSource, /row\.organization_name/);
  assert.match(systemSectionSource, /row\.owner_name/);
  assert.match(systemSectionSource, /row\.primary_email/);
  assert.match(systemSectionSource, /row\.subscription_plan/);
  assert.match(systemSectionSource, /row\.monthly_value/);
  assert.match(systemSectionSource, /row\.recommended_action/);
  assert.doesNotMatch(systemSectionSource, /future_health_score/);
});

test('no frontend health scoring or issue calculation', () => {
  assert.doesNotMatch(systemSectionSource, /\.reduce\(/);
  assert.doesNotMatch(systemSectionSource, /health_score/);
  assert.doesNotMatch(systemSectionSource, /critical_count\s*\+/);
});

test('placeholder subtabs performance and audit have no API', () => {
  const perfBlock = systemSectionSource.slice(
    systemSectionSource.indexOf("subTab === 'performance'"),
    systemSectionSource.indexOf("subTab === 'audit'"),
  );
  assert.doesNotMatch(perfBlock, /apiJson/);
});
