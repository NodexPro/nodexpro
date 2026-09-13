import assert from 'node:assert/strict';
import test from 'node:test';
import {
  displayLegalIdentifier,
  findCanonicalIdentityConflict,
  identifierPayloadForCanonicalCreate,
  parseLegalIdentifier,
  sameCanonicalLegalIdentity,
  sameStagingLegalIdentity,
} from '../../src/domains/tax-knowledge/legal-identifier.pure.js';

const cases = [
  ['2', { base: '2', letter: null, nested: [], source: '2', machine: '2' }],
  ['2(1)', { base: '2', letter: null, nested: ['1'], source: '2(1)', machine: '2(1)' }],
  ['2(2)', { base: '2', letter: null, nested: ['2'], source: '2(2)', machine: '2(2)' }],
  ['4א', { base: '4', letter: 'א', nested: [], source: '4א', machine: '4א' }],
  ['4א(א)', { base: '4', letter: 'א', nested: ['א'], source: '4א(א)', machine: '4א(א)' }],
  ['4א(א)(1)', { base: '4', letter: 'א', nested: ['א', '1'], source: '4א(א)(1)', machine: '4א(א)(1)' }],
  ['3(ט1)', { base: '3', letter: null, nested: ['ט1'], source: '3(ט1)', machine: '3(ט1)' }],
  ['3(ט)(1)', { base: '3', letter: null, nested: ['ט', '1'], source: '3(ט)(1)', machine: '3(ט)(1)' }],
] as const;

for (const [raw, expected] of cases) {
  test(`parses ${raw}`, () => {
    const parsed = parseLegalIdentifier(raw);
    assert.ok(parsed);
    assert.equal(parsed.base_number, expected.base);
    assert.equal(parsed.letter_suffix, expected.letter);
    assert.deepEqual(parsed.nested_components, [...expected.nested]);
    assert.equal(parsed.source_display_identifier, expected.source);
    assert.equal(parsed.normalized_machine_identifier, expected.machine);
  });
}

test('3(ט1) remains distinct from 3(ט)(1)', () => {
  const a = parseLegalIdentifier('3(ט1)');
  const b = parseLegalIdentifier('3(ט)(1)');
  assert.ok(a && b);
  assert.notEqual(a.normalized_machine_identifier, b.normalized_machine_identifier);
  assert.notDeepEqual(a.nested_components, b.nested_components);
  assert.equal(a.source_display_identifier, '3(ט1)');
  assert.equal(b.source_display_identifier, '3(ט)(1)');
});

test('source_display_identifier is preserved exactly and machine id is deterministic', () => {
  const first = parseLegalIdentifier('4א(א)(1)');
  const second = parseLegalIdentifier('4א(א)(1)');
  assert.ok(first && second);
  assert.equal(first.source_display_identifier, '4א(א)(1)');
  assert.equal(first.normalized_machine_identifier, second.normalized_machine_identifier);
  assert.equal(parseLegalIdentifier(' 2(1) ')?.source_display_identifier, '2(1)');
  assert.equal(parseLegalIdentifier('2 (1)')?.normalized_machine_identifier, '2(1)');
  assert.equal(parseLegalIdentifier('2 (1)')?.source_display_identifier, '2 (1)');
});

test('sibling identifiers under different parents are allowed', () => {
  const left = {
    country_code: 'IL',
    tax_source_id: 'src',
    parent_id: 'parent-a',
    kind_id: 'katan',
    normalized_machine_identifier: '1',
  };
  const right = { ...left, parent_id: 'parent-b' };
  assert.equal(sameCanonicalLegalIdentity(left, right), false);
  assert.equal(findCanonicalIdentityConflict(right, [left]), null);
});

test('duplicate exact identifier under the same parent is rejected', () => {
  const row = {
    country_code: 'IL',
    tax_source_id: 'src',
    parent_id: 'parent-a',
    kind_id: 'katan',
    normalized_machine_identifier: '2(1)',
  };
  assert.equal(sameCanonicalLegalIdentity(row, { ...row }), true);
  assert.ok(findCanonicalIdentityConflict(row, [{ ...row }]));
});

test('staging dedup is job/parent/kind/machine, not kind+number globally', () => {
  assert.equal(
    sameStagingLegalIdentity(
      { job_id: 'job', parent_id: 'p1', kind_label: 'סעיף קטן', normalized_machine_identifier: '1' },
      { job_id: 'job', parent_id: 'p2', kind_label: 'סעיף קטן', normalized_machine_identifier: '1' },
    ),
    false,
  );
  assert.equal(
    sameStagingLegalIdentity(
      { job_id: 'job', parent_id: 'p1', kind_label: 'סעיף קטן', normalized_machine_identifier: '1' },
      { job_id: 'job', parent_id: 'p1', kind_label: 'סעיף קטן', normalized_machine_identifier: '1' },
    ),
    true,
  );
});

test('accept payload copies identifier fields without inventing values', () => {
  const parsed = parseLegalIdentifier('4א(א)(1)');
  assert.ok(parsed);
  assert.deepEqual(identifierPayloadForCanonicalCreate(parsed), {
    source_display_identifier: '4א(א)(1)',
    normalized_machine_identifier: '4א(א)(1)',
    identifier_base_number: '4',
    identifier_letter_suffix: 'א',
    identifier_nested_components: ['א', '1'],
    printed_marker: '(1)',
  });
  assert.deepEqual(identifierPayloadForCanonicalCreate({
    source_display_identifier: null,
    normalized_machine_identifier: null,
    identifier_base_number: null,
    identifier_letter_suffix: null,
    identifier_nested_components: [],
    printed_marker: null,
  }), {
    source_display_identifier: null,
    normalized_machine_identifier: null,
    identifier_base_number: null,
    identifier_letter_suffix: null,
    identifier_nested_components: [],
    printed_marker: null,
  });
});

test('opaque catalog identifiers such as Hebrew letters stay exact and unparsed', () => {
  const parsed = parseLegalIdentifier('א');
  assert.ok(parsed);
  assert.equal(parsed.source_display_identifier, 'א');
  assert.equal(parsed.normalized_machine_identifier, 'א');
  assert.deepEqual(parsed.nested_components, []);
});

test('legacy display falls back to node_number without inventing nested citations', () => {
  assert.equal(displayLegalIdentifier(null, '2'), '2');
  assert.equal(displayLegalIdentifier('2(1)', '2'), '2(1)');
  assert.equal(displayLegalIdentifier(null, null), null);
  assert.equal(parseLegalIdentifier(''), null);
  assert.equal(parseLegalIdentifier('(1)'), null);
});

test('printed_marker is stored separately from the full identifier and is not identity', () => {
  const seifKatan = parseLegalIdentifier('1(א)');
  const paragraph = parseLegalIdentifier('1(א)(1)');
  const letterSeif = parseLegalIdentifier('4א');
  const tetOne = parseLegalIdentifier('3(ט1)');
  const tetThenOne = parseLegalIdentifier('3(ט)(1)');
  assert.equal(seifKatan?.printed_marker, '(א)');
  assert.equal(seifKatan?.source_display_identifier, '1(א)');
  assert.equal(paragraph?.printed_marker, '(1)');
  assert.equal(letterSeif?.printed_marker, '4א');
  assert.equal(tetOne?.printed_marker, '(ט1)');
  assert.equal(tetThenOne?.printed_marker, '(1)');
  assert.notEqual(tetOne?.normalized_machine_identifier, tetThenOne?.normalized_machine_identifier);
  const left = {
    country_code: 'IL',
    tax_source_id: 'src',
    parent_id: 'p',
    kind_id: 'k',
    normalized_machine_identifier: '1(א)',
  };
  assert.equal(sameCanonicalLegalIdentity(left, { ...left }), true);
  assert.equal(
    sameStagingLegalIdentity(
      { job_id: 'job', parent_id: 'p', kind_label: 'סעיף קטן', normalized_machine_identifier: '1(א)' },
      { job_id: 'job', parent_id: 'p', kind_label: 'סעיף קטן', normalized_machine_identifier: '1(א)' },
    ),
    true,
  );
});

test('legacy null printed_marker remains valid on stored identifier fields', () => {
  const stored = identifierPayloadForCanonicalCreate({
    source_display_identifier: '1(א)',
    normalized_machine_identifier: '1(א)',
    identifier_base_number: '1',
    identifier_letter_suffix: null,
    identifier_nested_components: ['א'],
    printed_marker: null,
  });
  assert.equal(stored.printed_marker, null);
  assert.equal(stored.source_display_identifier, '1(א)');
});
