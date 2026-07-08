/**
 * P11.5B — Owner System UI contract (lazy load, render-only).
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
const endpointsSource = readWeb('api/endpoints.ts');

test('legal-control initial load does not fetch system-health', () => {
  assert.match(legalControlSource, /OWNER\.legalControl/);
  assert.doesNotMatch(legalControlSource, /OWNER\.systemHealth/);
});

test('system-health fetch happens only inside OwnerSystemHealthSection', () => {
  assert.match(systemSectionSource, /OWNER\.systemHealth/);
  assert.match(systemSectionSource, /useEffect\(/);
});

test('OwnerSystemHealthSection mounts only when System top tab is active', () => {
  assert.match(legalControlSource, /ownerTopSection === 'system' \? <OwnerSystemHealthSection/);
});

test('overview cards render backend summary fields only', () => {
  assert.match(systemSectionSource, /aggregate\.summary\.total_open_issues/);
  assert.match(systemSectionSource, /aggregate\.summary\.critical_count/);
  assert.match(systemSectionSource, /aggregate\.summary\.warning_count/);
  assert.match(systemSectionSource, /aggregate\.summary\.info_count/);
  assert.match(systemSectionSource, /aggregate\.summary\.last_checked_at/);
  assert.doesNotMatch(systemSectionSource, /critical_count\s*\+/);
});

test('errors table renders backend row fields without client grouping', () => {
  assert.match(systemSectionSource, /row\.module_key/);
  assert.match(systemSectionSource, /row\.issue_label/);
  assert.match(systemSectionSource, /row\.possible_reason/);
  assert.match(systemSectionSource, /row\.recommended_action/);
  assert.match(systemSectionSource, /row\.severity/);
  assert.match(systemSectionSource, /row\.status/);
  assert.match(systemSectionSource, /row\.count/);
  assert.match(systemSectionSource, /row\.last_seen_at/);
  assert.doesNotMatch(systemSectionSource, /\.filter\(\(row\).*severity/);
  assert.doesNotMatch(systemSectionSource, /\.reduce\(/);
});

test('placeholder subtabs have no API calls', () => {
  assert.match(systemSectionSource, /Coming in next phase/);
  const healthBlock = systemSectionSource.slice(
    systemSectionSource.indexOf("subTab === 'health'"),
    systemSectionSource.indexOf("subTab === 'performance'"),
  );
  assert.doesNotMatch(healthBlock, /apiJson/);
});

test('empty state uses backend rows length', () => {
  assert.match(systemSectionSource, /No platform issues detected/);
  assert.match(systemSectionSource, /sortedRows\.length === 0/);
});

test('endpoints expose reused backend route', () => {
  assert.match(endpointsSource, /systemHealth:\s*'\/owner\/system-health'/);
});

test('no new owner route or page created outside legal-control', () => {
  const appSource = readWeb('App.tsx');
  assert.doesNotMatch(appSource, /platform-owner\/system/);
  assert.match(appSource, /platform-owner\/legal-control/);
});
