import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  assembleLegalValuePayloadFromOwnerEditorInput,
  buildOwnerLegalValueEditorDescriptor,
  formatOwnerLegalValueHumanSummary,
  IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY,
} from '../../src/domains/country-pack/owner-legal-value-editor.pure.js';
import { buildOwnerLegalValuesTableModel } from '../../src/domains/country-pack/owner-legal-values-table.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('issue month window editor descriptor exposes business fields only', () => {
  const editor = buildOwnerLegalValueEditorDescriptor({
    value_key: IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY,
    value_type: 'json',
    current_payload: { months_back: 1, months_ahead: 3 },
    country_code: 'IL',
    country_catalog: {
      countries: [{ code: 'IL', name: 'Israel' }],
      country_packs: [{ id: 'pack-1', country_code: 'IL', name: 'Israel Default Pack', status: 'enabled' }],
      rulesets: [
        {
          id: 'ruleset-1',
          country_pack_id: 'pack-1',
          ruleset_code: 'default',
          ruleset_version: '1.0',
          status: 'active',
          effective_from: '2020-01-01',
          effective_to: null,
        },
      ],
    },
  });
  assert.ok(editor);
  assert.equal(editor?.editor_key, 'issue_month_window');
  assert.equal(editor?.value_fields.length, 2);
  assert.equal(editor?.value_fields[0]?.key, 'months_back');
  assert.equal(editor?.value_fields[1]?.key, 'months_ahead');
  assert.equal(editor?.version_fields.some((f) => f.key === 'country_pack_ruleset_id'), false);
});

test('backend assembles issue month window JSON from owner field input', () => {
  const payload = assembleLegalValuePayloadFromOwnerEditorInput(
    IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY,
    'json',
    { months_back: 2, months_ahead: 4 },
  );
  assert.deepEqual(payload, { months_back: 2, months_ahead: 4 });
});

test('human summary for issue month window is readable', () => {
  const summary = formatOwnerLegalValueHumanSummary(
    IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY,
    'json',
    { months_back: 1, months_ahead: 3 },
  );
  assert.ok(summary);
  assert.match(summary!.display, /Issue month window/);
  assert.match(summary!.display, /Back: 1 month/);
  assert.match(summary!.display, /Forward: 3 months/);
});

test('table row includes editor on create version action', () => {
  const catalog = {
    countries: [{ code: 'IL', name: 'Israel' }],
    country_packs: [{ id: 'pack-1', country_code: 'IL', name: 'Israel Default Pack', status: 'enabled' }],
    rulesets: [
      {
        id: 'ruleset-1',
        country_pack_id: 'pack-1',
        ruleset_code: 'default',
        ruleset_version: '1.0',
        status: 'active',
        effective_from: '2020-01-01',
        effective_to: null,
      },
    ],
  };
  const model = buildOwnerLegalValuesTableModel(
    [
      {
        country_code: 'IL',
        value_key: IL_INCOME_ISSUE_MONTH_WINDOW_VALUE_KEY,
        label: 'Income issue month window',
        category: 'VAT',
        module_scope: 'income',
        value_type: 'json',
        current_active_value: { months_back: 1, months_ahead: 3 },
        versions: [],
      },
    ],
    [{ action_key: 'create_legal_value_version', enabled: true }],
    catalog,
  );
  const createAction = model.rows[0]?.actions.find((a) => a.action_key === 'create_legal_value_version');
  assert.ok(createAction?.editor);
  assert.equal(createAction?.editor?.editor_key, 'issue_month_window');
  assert.ok(model.rows[0]?.current_value_summary_lines.includes('Back: 1 month'));
});

test('frontend uses specialized editor instead of JSON textarea for known editors', () => {
  const actionsSource = readFileSync(
    join(dir, '../../../web/src/pages/owner-legal-control-panel-actions.tsx'),
    'utf8',
  );
  const editorSource = readFileSync(
    join(dir, '../../../web/src/pages/OwnerLegalValueEditorForm.tsx'),
    'utf8',
  );
  assert.ok(actionsSource.includes('OwnerLegalValueEditorForm'));
  assert.ok(actionsSource.includes('buildOwnerLegalEditorSubmitPayload'));
  assert.ok(actionsSource.includes('Save version'));
  assert.ok(editorSource.includes('Months back') || editorSource.includes('value_fields'));
  assert.equal(editorSource.includes('JSON.stringify'), false);
});

test('command service assembles owner editor payload before storing version', () => {
  const source = readFileSync(
    join(dir, '../../src/domains/country-pack/country-pack-commands.service.ts'),
    'utf8',
  );
  assert.ok(source.includes('resolveLegalValueVersionPayloadForCommand'));
  assert.ok(source.includes('assembleLegalValuePayloadFromOwnerEditorInput'));
});
