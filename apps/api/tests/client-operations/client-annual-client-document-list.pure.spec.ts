import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildClientDocumentListPdfHtml,
  buildClientDocumentListPdfSnapshot,
  clientDocumentListPdfContainsForbiddenClientContent,
  defaultIncludeInClientList,
  overlayClientListSelection,
  projectClientDocumentListItems,
  selectedClientDocumentListItems,
} from '../../src/domains/client-operations/client-annual-client-document-list.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('custom rows are included by default; annual catalog is opt-in; capital required rows start included', () => {
  assert.equal(defaultIncludeInClientList({ sourceType: 'custom' }), true);
  assert.equal(defaultIncludeInClientList({ sourceType: 'system', tabScope: 'annual_report', required: true }), false);
  assert.equal(defaultIncludeInClientList({ sourceType: 'system', tabScope: 'capital_declaration', required: true }), true);
  assert.equal(defaultIncludeInClientList({ sourceType: 'system', tabScope: 'capital_declaration', required: false }), false);
});

test('client PDF snapshot omits internal codes, statuses and accountant notes', () => {
  const items = projectClientDocumentListItems([
    {
      row_id: 'r1',
      source_type: 'system',
      system_key: 'form_106_owner_all_jobs',
      document_name_he: 'טופס 106 בעל מכל מקומות עבודה',
      description_he: 'internal accountant hint',
      include_in_client_list: true,
      client_facing_name_he: 'טופס 106',
      client_facing_description_he: 'נא לצרף טופס 106 מכל מקומות העבודה',
      received: false,
      row_note: 'wait for client',
      status: 'missing',
    },
    {
      row_id: 'r2',
      source_type: 'custom',
      system_key: null,
      document_name_he: 'מסמך מותאם',
      description_he: null,
      include_in_client_list: false,
      client_facing_name_he: null,
      client_facing_description_he: null,
    },
  ]);
  assert.equal(items[0]?.internal_name, 'form_106_owner_all_jobs');
  assert.equal(selectedClientDocumentListItems(items).length, 1);
  const snapshot = buildClientDocumentListPdfSnapshot({
    tabScope: 'annual_report',
    officeName: 'Office Name',
    clientName: 'Client Name',
    periodLabel: 'שנת מס 2025',
    generatedAt: '2026-11-20T00:00:00.000Z',
    items,
  });
  const html = buildClientDocumentListPdfHtml(snapshot);
  assert.match(html, /dir="rtl"/);
  assert.match(html, /font-family: Arial/);
  assert.match(html, /Office Name/);
  assert.match(html, /Client Name/);
  assert.match(html, /שנת מס 2025/);
  assert.match(html, /טופס 106/);
  assert.match(html, /נא לצרף טופס 106 מכל מקומות העבודה/);
  assert.doesNotMatch(html, /form_106_owner_all_jobs/);
  assert.doesNotMatch(html, /wait for client/);
  assert.doesNotMatch(html, /missing/);
  assert.equal(clientDocumentListPdfContainsForbiddenClientContent(html), false);
});

test('PDF include overlay does not reorder or rename checklist items', () => {
  const items = projectClientDocumentListItems([
    {
      row_id: 'a',
      source_type: 'system',
      system_key: 'form_1301',
      document_name_he: 'דוח 1301',
      description_he: null,
      include_in_client_list: false,
      client_facing_name_he: 'דוח 1301',
      client_facing_description_he: null,
    },
    {
      row_id: 'b',
      source_type: 'custom',
      system_key: null,
      document_name_he: 'נספח',
      description_he: null,
      include_in_client_list: true,
      client_facing_name_he: 'נספח',
      client_facing_description_he: null,
    },
  ]);
  const overlaid = overlayClientListSelection(items, ['a']);
  assert.equal(overlaid[0]?.row_id, 'a');
  assert.equal(overlaid[1]?.row_id, 'b');
  assert.equal(overlaid[0]?.client_facing_name, 'דוח 1301');
  assert.equal(overlaid[1]?.client_facing_name, 'נספח');
  assert.equal(overlaid[0]?.include_in_client_list, true);
  assert.equal(overlaid[1]?.include_in_client_list, false);
});

test('sent PDF snapshot is frozen; send only records DocFlow message id', () => {
  const service = readFileSync(
    join(dir, '../../src/domains/client-operations/client-annual-client-document-list.service.ts'),
    'utf8',
  );
  const migration = readFileSync(
    join(dir, '../../../../supabase/migrations/222_annual_client_document_list.sql'),
    'utf8',
  );
  assert.match(service, /requireGuardedUpload/);
  assert.match(service, /send_office_message_with_attachment/);
  const sendFn = service.slice(service.indexOf('export async function sendAnnualClientDocumentListViaDocflow'));
  assert.match(sendFn, /idempotency_key: idempotencyKey/);
  assert.match(sendFn, /\.update\(\{ docflow_message_id: messageId \}\)/);
  assert.doesNotMatch(sendFn, /\.update\([\s\S]*snapshot_json/);
  assert.match(migration, /client_annual_document_list_sends_freeze/);
  assert.match(migration, /snapshot_json is distinct from old\.snapshot_json/);
  assert.match(migration, /file_asset_id is distinct from old\.file_asset_id/);
  assert.match(service, /sendAnnualClientDocumentListViaEmail/);
  assert.match(service, /applyAnnualDocumentClientListSelection/);
  assert.doesNotMatch(service, /received:/);
});
