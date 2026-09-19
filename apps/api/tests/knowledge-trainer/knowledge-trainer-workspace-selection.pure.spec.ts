import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKnowledgeTrainerSelectedDocumentId } from '../../src/domains/knowledge-trainer/knowledge-trainer-workspace-selection.pure.js';

test('TAX-649A requested document wins when it is in inventory', () => {
  assert.equal(
    resolveKnowledgeTrainerSelectedDocumentId({
      requestedDocumentId: 'doc-b',
      persistedDocumentId: 'doc-a',
      inventoryIds: ['doc-a', 'doc-b', 'doc-newest'],
    }),
    'doc-b',
  );
});

test('TAX-649A persisted pin is used when request is absent', () => {
  assert.equal(
    resolveKnowledgeTrainerSelectedDocumentId({
      requestedDocumentId: null,
      persistedDocumentId: 'doc-a',
      inventoryIds: ['doc-newest', 'doc-a'],
    }),
    'doc-a',
  );
});

test('TAX-649A no selection is null and never newest/first inventory id', () => {
  assert.equal(
    resolveKnowledgeTrainerSelectedDocumentId({
      requestedDocumentId: '',
      persistedDocumentId: null,
      inventoryIds: ['doc-newest', 'doc-older'],
    }),
    null,
  );
  assert.equal(
    resolveKnowledgeTrainerSelectedDocumentId({
      requestedDocumentId: 'missing',
      persistedDocumentId: 'also-missing',
      inventoryIds: ['doc-newest'],
    }),
    null,
  );
});
