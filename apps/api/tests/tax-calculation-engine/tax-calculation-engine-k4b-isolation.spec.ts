import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hasApplicabilityEvaluation,
  hasLatestPinResolver,
} from '../../src/domains/tax-calculation-engine/tax-calculation-engine-context.pure.js';

const SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/tax-calculation-engine');

function k4bFiles(): string[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith('.ts') && name.includes('context'))
    .map((name) => join(SOURCE_DIR, name));
}

test('TAX-K4B 5/21: no applicability evaluation and no successor-pin resolver', () => {
  assert.equal(hasApplicabilityEvaluation(), false);
  assert.equal(hasLatestPinResolver(), false);
  for (const file of k4bFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /evaluateTaxRules/);
    assert.doesNotMatch(text, /evaluateAppliesIf/);
    assert.doesNotMatch(text, /evaluateTaxRulePredicate/);
    assert.doesNotMatch(text, /evaluateDoesNotApplyIf/);
    assert.doesNotMatch(text, /resolveLatest/);
    assert.doesNotMatch(text, /latest_version/);
    assert.doesNotMatch(text, /active_version/);
  }
});

test('TAX-K4B 22: no DB import', () => {
  for (const file of k4bFiles()) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /@supabase\/supabase-js/);
    assert.doesNotMatch(text, /from 'pg'/);
    assert.doesNotMatch(text, /DATABASE_URL/);
    assert.doesNotMatch(text, /\.from\('/);
    assert.doesNotMatch(text, /createClient/);
  }
});

test('TAX-K4B 23: no Accounting Base / Work Engine / Income calculator import', () => {
  const forbidden = [
    'accounting-base',
    'work-engine',
    'income-draft',
    'income-document-draft-totals',
    'income-draft-line-compute',
    'income-draft-vat',
    '../income/',
    '../accounting-base/',
    '../work-engine/',
  ];
  for (const file of k4bFiles()) {
    const text = readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      assert.equal(text.includes(needle), false, `${file} contains ${needle}`);
    }
  }
});
