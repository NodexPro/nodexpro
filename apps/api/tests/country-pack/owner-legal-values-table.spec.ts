import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  buildOwnerLegalValuesTableModel,
  formatLegalValueCurrentDisplay,
} from '../../src/domains/country-pack/owner-legal-values-table.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));

test('formatLegalValueCurrentDisplay returns backend null label', () => {
  assert.equal(formatLegalValueCurrentDisplay(null, 'json'), 'No active version');
});

test('formatLegalValueCurrentDisplay compacts json payloads', () => {
  const display = formatLegalValueCurrentDisplay({ months_back: 1, months_ahead: 3 }, 'json');
  assert.equal(display, '{"months_back":1,"months_ahead":3}');
});

test('buildOwnerLegalValuesTableModel exposes prepared columns rows and row actions', () => {
  const model = buildOwnerLegalValuesTableModel(
    [
      {
        country_code: 'IL',
        value_key: 'il_income_issue_month_window',
        label: 'Income issue month window',
        category: 'VAT',
        module_scope: 'income',
        value_type: 'json',
        status_badge: { label: 'Active' },
        current_active_value: null,
        versions: [],
      },
    ],
    [{ action_key: 'create_legal_value_version', enabled: true }],
  );

  assert.equal(model.columns.length, 9);
  assert.equal(model.rows.length, 1);
  assert.equal(model.rows[0]?.cells.current_value, 'Issue month window\nBack: 1 month\nForward: 3 months');
  assert.equal(model.rows[0]?.version_status_display, 'Active');
  assert.equal(model.rows[0]?.effective_from_display, 'No active version');
  assert.ok(model.rows[0]?.actions.some((a) => a.action_key === 'create_legal_value_version'));
  const activate = model.rows[0]?.actions.find((a) => a.action_key === 'activate_legal_value_version');
  assert.equal(activate?.enabled, false);
  assert.match(String(activate?.disabled_reason ?? ''), /draft/i);
});

test('owner legal values aggregate includes legal_values_table model', () => {
  const source = readFileSync(
    join(dir, '../../src/domains/country-pack/country-pack-read-models.service.ts'),
    'utf8',
  );
  assert.ok(source.includes('legal_values_table: legalValuesTableModel'));
  assert.ok(source.includes('buildOwnerLegalValuesTableModel'));
});

test('frontend legal values modal stacks child command dialog above parent', () => {
  const pageSource = readFileSync(
    join(dir, '../../../web/src/pages/PlatformOwnerLegalControl.tsx'),
    'utf8',
  );
  const actionsSource = readFileSync(
    join(dir, '../../../web/src/pages/owner-legal-control-panel-actions.tsx'),
    'utf8',
  );
  const cssSource = readFileSync(
    join(dir, '../../../web/src/styles/nx-owner-legal-control.css'),
    'utf8',
  );

  assert.ok(pageSource.includes('nx-modal-overlay--blocked'));
  assert.ok(pageSource.includes('OwnerLegalValuesTable'));
  assert.ok(pageSource.includes('ownerLegalValuesTableFromPanel'));
  assert.ok(actionsSource.includes('nx-modal-overlay--nested'));
  assert.ok(cssSource.includes('.nx-modal-overlay--nested'));
  assert.ok(cssSource.includes('z-index: 1100'));
});

test('frontend legal values table renders backend cells without JSON.stringify', () => {
  const tableSource = readFileSync(
    join(dir, '../../../web/src/pages/OwnerLegalValuesTable.tsx'),
    'utf8',
  );
  assert.ok(tableSource.includes('row.cells[column.key]'));
  assert.equal(tableSource.includes('JSON.stringify'), false);
  assert.equal(tableSource.includes('statusToUi'), false);
});
