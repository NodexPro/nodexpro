import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/domains/tax-calculation-engine');

function k4cFiles(): string[] {
  return readdirSync(SOURCE_DIR)
    .filter(
      (name) =>
        name.endsWith('.ts') && (name.includes('commands') || name.includes('result') || name.includes('calculate')),
    )
    .map((name) => join(SOURCE_DIR, name));
}

function isCommandBoundaryValidationFile(file: string): boolean {
  return basename(file) === 'tax-calculation-engine-calculate.pure.ts';
}

test('TAX-K4C 18-23: no hidden resolution and no AB/WE/Income/DB imports', () => {
  for (const file of k4cFiles()) {
    const text = readFileSync(file, 'utf8');
    if (isCommandBoundaryValidationFile(file)) {
      assert.match(text, /'organization_id'/);
      assert.match(text, /'client_id'/);
      assert.match(text, /does not accept/);
      assert.doesNotMatch(text, /organization_id\s*[?:]/);
      assert.doesNotMatch(text, /client_id\s*[?:]/);
    } else {
      assert.doesNotMatch(text, /organization_id/);
      assert.doesNotMatch(text, /client_id/);
    }
    assert.doesNotMatch(text, /evaluateTaxRules/);
    assert.doesNotMatch(text, /evaluateAppliesIf/);
    assert.doesNotMatch(text, /evaluateTaxRulePredicate/);
    assert.doesNotMatch(text, /resolveLegalValue/);
    assert.doesNotMatch(text, /resolveCountryContext/);
    assert.doesNotMatch(text, /resolveLatest/);
    assert.doesNotMatch(text, /latest_version/);
    assert.doesNotMatch(text, /@supabase\/supabase-js/);
    assert.doesNotMatch(text, /from 'pg'/);
    assert.doesNotMatch(text, /createClient/);
    assert.doesNotMatch(text, /\.from\('/);
    assert.doesNotMatch(text, /accounting-base/);
    assert.doesNotMatch(text, /work-engine/);
    assert.doesNotMatch(text, /income-draft/);
    assert.doesNotMatch(text, /income-document-draft-totals/);
    assert.doesNotMatch(text, /\.\.\/income\//);
    assert.doesNotMatch(text, /\.\.\/accounting-base\//);
    assert.doesNotMatch(text, /\.\.\/work-engine\//);
  }
});
