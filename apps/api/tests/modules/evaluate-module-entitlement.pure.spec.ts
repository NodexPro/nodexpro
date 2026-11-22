import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateModuleEntitlement } from '../../src/domains/modules/evaluate-module-entitlement.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('system modules are entitled without a subscription row', () => {
  assert.equal(
    evaluateModuleEntitlement({
      moduleFound: true,
      isSystem: true,
      subscription: null,
      trialValid: false,
    }).status,
    'entitled',
  );
});

test('active subscription is entitled; org trial covers missing commercial subscription', () => {
  assert.equal(
    evaluateModuleEntitlement({
      moduleFound: true,
      isSystem: false,
      subscription: { status: 'active', ends_at: null, trial_ends_at: null },
      trialValid: false,
    }).status,
    'entitled',
  );
  assert.equal(
    evaluateModuleEntitlement({
      moduleFound: true,
      isSystem: false,
      subscription: null,
      trialValid: true,
    }).status,
    'trial',
  );
  assert.equal(
    evaluateModuleEntitlement({
      moduleFound: true,
      isSystem: false,
      subscription: null,
      trialValid: false,
    }).status,
    'not_entitled',
  );
});

test('dashboard overview loads providers in parallel', () => {
  const src = readFileSync(
    join(dir, '../../src/domains/dashboard/dashboard-aggregator.service.ts'),
    'utf8',
  );
  assert.match(src, /Promise\.all\(\s*providers\.map/);
  assert.doesNotMatch(src, /for \(const provider of providers\) \{/);
});
