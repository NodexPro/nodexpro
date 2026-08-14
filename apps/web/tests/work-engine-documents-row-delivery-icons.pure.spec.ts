import assert from 'node:assert/strict';
import test from 'node:test';
import { workEngineDocumentsRowDeliveryVisible } from '../src/components/work-engine/WorkEngineDocumentsRowDeliveryIcons.tsx';

test('row delivery icons follow backend action.enabled only', () => {
  const visible = workEngineDocumentsRowDeliveryVisible({
    document_id: 'doc-1',
    email_delivery: {
      action: { enabled: true },
    },
    docflow_delivery: {
      action: { enabled: false },
    },
  } as Parameters<typeof workEngineDocumentsRowDeliveryVisible>[0]);
  assert.deepEqual(visible, { showEmail: true, showDocflow: false });
});

test('row delivery icons hide when document id is missing', () => {
  const visible = workEngineDocumentsRowDeliveryVisible({
    document_id: null,
    email_delivery: {
      action: { enabled: true },
    },
    docflow_delivery: {
      action: { enabled: true },
    },
  } as Parameters<typeof workEngineDocumentsRowDeliveryVisible>[0]);
  assert.deepEqual(visible, { showEmail: false, showDocflow: false });
});
