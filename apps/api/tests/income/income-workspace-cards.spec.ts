import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIncomeWorkspaceCards } from '../../src/domains/income/income-workspace-cards.builders.js';
import { buildAllowedActingModes } from '../../src/domains/income/income-workspace-context.builders.js';

test('workspace cards include non-empty allowed_acting_modes via separate builder', () => {
  const modes = buildAllowedActingModes({
    view: true,
    edit: true,
    issue: true,
    issue_on_behalf: true,
  });
  assert.equal(modes.length, 2);
});

test('workspace cards never use empty arrays for customers/items/drafts counts', () => {
  const cards = buildIncomeWorkspaceCards(
    { view: true, edit: true, issue: true, issue_on_behalf: true },
    { customers: 3, items: 2, drafts: 1 },
  );
  assert.equal(cards.length, 11);
  const customers = cards.find((c) => c.key === 'customers');
  const drafts = cards.find((c) => c.key === 'drafts');
  assert.equal(customers?.count, 3);
  assert.equal(drafts?.count, 1);
  assert.ok((customers?.allowed_actions?.length ?? 0) > 0);
});
