import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOwnerPresentationJson,
  detectOwnerPresentationSourceLocale,
  digestOwnerPresentationSource,
  extractOwnerPresentationStatements,
  joinOwnerPresentationStatements,
  ownerPresentationCoversDigest,
  parseOwnerPresentationJson,
} from '../../src/domains/knowledge-trainer/tax-knowledge-proposal-owner-presentation.pure.js';

const STATEMENT =
  'The income of an Israeli citizen that was produced or accrued in the Area is treated as income produced or accrued in Israel.';

test('TAX-644B presentation is derived from extracted statements, not a hardcoded statute', () => {
  const statements = extractOwnerPresentationStatements({
    rules: [{ title: 'unused when statement exists', statement: STATEMENT }],
  });
  assert.deepEqual(statements, [STATEMENT]);
  assert.equal(joinOwnerPresentationStatements(statements), STATEMENT);
  assert.equal(detectOwnerPresentationSourceLocale(STATEMENT), 'en');
  assert.equal(detectOwnerPresentationSourceLocale('הכנסה של אזרח ישראלי'), 'he');
  assert.equal(detectOwnerPresentationSourceLocale('Доход гражданина Израиля'), 'ru');

  const digest = digestOwnerPresentationSource(statements);
  const stored = buildOwnerPresentationJson({
    sourceLocale: 'en',
    sourceDigest: digest,
    sourceExplanation: STATEMENT,
    translations: {
      he: 'תרגום מצגת',
      ru: 'перевод презентации',
    },
  });
  assert.equal(stored?.by_locale.en.explanation, STATEMENT);
  assert.equal(stored?.by_locale.he.explanation, 'תרגום מצגת');
  assert.equal(ownerPresentationCoversDigest(stored, digest), true);
  assert.equal(parseOwnerPresentationJson(stored)?.source_digest, digest);
  assert.equal(parseOwnerPresentationJson({ schema_version: 1 }), null);
});
