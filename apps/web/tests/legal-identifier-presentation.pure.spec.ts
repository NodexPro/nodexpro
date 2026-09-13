import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  legalIdentifierCodepoints,
  legalIdentifierPresentation,
} from '../src/lib/legal-identifier-presentation.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const visuals = ['1(א)', '4א', '4א(א)(1)', '3(ט1)', '3(ט)(1)'] as const;

for (const value of visuals) {
  test(`presents ${value} without mutating codepoints`, () => {
    const presented = legalIdentifierPresentation(value);
    assert.equal(presented.text, value);
    assert.deepEqual(legalIdentifierCodepoints(presented.text), legalIdentifierCodepoints(value));
    assert.equal(presented.dir, 'ltr');
    assert.equal(presented.unicodeBidi, 'isolate');
  });
}

test('1(א) keeps digit then parenthesis then alef', () => {
  assert.deepEqual(legalIdentifierCodepoints('1(א)'), ['1', '(', 'א', ')']);
});

test('frontend helper and screens do not reverse or reconstruct identifiers', () => {
  const helper = readRepo('apps/web/src/lib/legal-identifier-presentation.ts');
  const component = readRepo('apps/web/src/lib/legal-identifier-text.tsx');
  const trainer = readRepo('apps/web/src/pages/owner-knowledge-trainer-panel.tsx');
  const library = readRepo('apps/web/src/pages/owner-legal-library-panel.tsx');
  assert.match(component, /<bdi/);
  assert.match(component, /dir=\{presented\.dir\}/);
  assert.match(component, /unicodeBidi/);
  assert.match(trainer, /LegalIdentifierText/);
  assert.match(trainer, /Printed marker/);
  assert.match(library, /LegalIdentifierText/);
  assert.match(library, /Printed marker/);
  for (const source of [helper, component, trainer, library]) {
    assert.doesNotMatch(source, /parseLegalIdentifier/);
    assert.doesNotMatch(source, /\.reverse\(/);
    assert.doesNotMatch(source, /split\(['"]['"]\)\.reverse/);
    assert.doesNotMatch(source, /identifier_nested_components\.join/);
    assert.doesNotMatch(source, /base_number.*letter_suffix/);
  }
});
