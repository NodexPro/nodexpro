import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchClientOperationsRegistrySuggestions,
  moveClientOperationsSearchSuggestionIndex,
} from '../src/lib/client-operations-search-suggestions.pure.ts';

const rows = [
  {
    client_id: 'c-test',
    client_name: 'Test Client',
    tax_id: '514000001',
    cells: { client_name: 'Test Client', tax_id: '514000001', phone: '050-100' },
  },
  {
    client_id: 'c-team',
    client_name: 'Team Ledger',
    tax_id: '558000222',
    cells: { client_name: 'Team Ledger', tax_id: '558000222' },
  },
  {
    client_id: 'c-he',
    client_name: 'משה כהן',
    tax_id: '032000333',
    cells: { client_name: 'משה כהן', tax_id: '032000333' },
  },
  {
    client_id: 'c-other',
    client_name: 'Other Office',
    tax_id: '999',
    cells: { client_name: 'Other Office', tax_id: '999' },
  },
];

test('typing narrows suggestions without inventing clients', () => {
  const t = matchClientOperationsRegistrySuggestions(rows, 't').map((row) => row.client_id);
  const te = matchClientOperationsRegistrySuggestions(rows, 'te').map((row) => row.client_id);
  const tes = matchClientOperationsRegistrySuggestions(rows, 'tes').map((row) => row.client_id);
  assert.deepEqual(t.sort(), ['c-other', 'c-team', 'c-test']);
  assert.deepEqual(te.sort(), ['c-team', 'c-test']);
  assert.deepEqual(tes, ['c-test']);
  assert.equal(matchClientOperationsRegistrySuggestions(rows, '   ').length, 0);
});

test('matching is case-insensitive for English and works for Hebrew and numbers', () => {
  assert.deepEqual(
    matchClientOperationsRegistrySuggestions(rows, 'TEST').map((row) => row.client_id),
    ['c-test'],
  );
  assert.deepEqual(
    matchClientOperationsRegistrySuggestions(rows, 'כהן').map((row) => row.client_id),
    ['c-he'],
  );
  const numeric = matchClientOperationsRegistrySuggestions(rows, '514000001');
  assert.equal(numeric.length, 1);
  assert.equal(numeric[0]?.client_id, 'c-test');
  assert.equal(numeric[0]?.identifier, '514000001');
  assert.equal(numeric[0]?.query, 'Test Client');
});

test('no match stays empty and arrow keys stay inside the list', () => {
  assert.deepEqual(matchClientOperationsRegistrySuggestions(rows, 'zzzz-none'), []);
  assert.equal(moveClientOperationsSearchSuggestionIndex(-1, 1, 3), 0);
  assert.equal(moveClientOperationsSearchSuggestionIndex(0, -1, 3), -1);
  assert.equal(moveClientOperationsSearchSuggestionIndex(2, 1, 3), 2);
  assert.equal(moveClientOperationsSearchSuggestionIndex(0, 1, 0), -1);
});
