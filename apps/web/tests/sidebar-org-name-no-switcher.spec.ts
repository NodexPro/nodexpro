import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('right-panel account block shows organization name as text, never a select', () => {
  const block = read('../src/templates/template-1/components/SidebarAccountBlock.tsx');
  assert.match(block, /data-testid="sidebar-organization-name"/);
  assert.match(block, /block\.organization_name/);
  assert.doesNotMatch(block, /t1-sidebar-org-select/);
  assert.doesNotMatch(block, /<select/);
  assert.match(block, /language_selector/);
  assert.match(block, /logout_action/);
});

test('login keeps select_active_organization off the dashboard switcher path', () => {
  const layout = read('../src/templates/template-1/TemplateLayout.tsx');
  assert.match(layout, /selectActiveOrg|onSelectOrganization/);
  const login = read('../src/pages/Login.tsx');
  assert.doesNotMatch(login, /AUTH\.selectActiveOrgCommand/);
});
