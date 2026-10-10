/**
 * Stage 5.7 — workspace UI polish (sidebar, employee workspace, Client Operations employee view).
 * Presentation only: no access semantics, command or schema change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSidebarAccountBlock,
  resolveEmployeeFirstName,
  type SidebarAccountBlockInput,
} from '../../src/domains/auth/sidebar-account-block.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const repo = (rel: string): string => readFileSync(join(root, rel), 'utf8');
const web = (rel: string): string => repo(`apps/web/src/${rel}`);

const base: SidebarAccountBlockInput = {
  user: { email: 'dana@example.com', fullName: 'דנה כהן' },
  organizations: [{ id: 'org-1', name: 'משרד רואה חשבון לוי' }],
  activeOrganizationId: 'org-1',
  shellProfile: 'worker',
  uiLanguage: 'en',
  activeOrganizationCountryCode: 'IL',
};

test('1. language selector is hidden for everyone (capability kept in the payload)', () => {
  for (const shellProfile of ['worker', 'full_platform', 'income_only'] as const) {
    const block = buildSidebarAccountBlock({ ...base, shellProfile });
    assert.equal(block.language_selector.visible, false);
    assert.equal(block.language_selector.options.length, 2);
    assert.equal(block.language_selector.current_value, 'en');
  }
});

test('2. employee: no sign-out in the sidebar, office context + greeting from backend identity (Hebrew for IL)', () => {
  const block = buildSidebarAccountBlock(base);
  assert.equal(block.logout_action.visible, false);
  assert.equal(block.logout_action.command_key, 'logout'); // capability untouched
  assert.deepEqual(block.office_context, { visible: true, label: 'משרד', name: 'משרד רואה חשבון לוי' });
  assert.deepEqual(block.workspace_greeting, { text: 'היי, דנה', direction: 'rtl' });
});

test('3. owner / admin keep the existing office identity behaviour (sign-out, no employee blocks)', () => {
  const block = buildSidebarAccountBlock({ ...base, shellProfile: 'full_platform' });
  assert.equal(block.logout_action.visible, true);
  assert.equal(block.office_context.visible, false);
  assert.equal(block.workspace_greeting, null);
  assert.equal(block.organization_name, 'משרד רואה חשבון לוי');
});

test('4. non-IL organization renders English office / greeting text', () => {
  const block = buildSidebarAccountBlock({
    ...base,
    user: { email: 'a@b.c', fullName: 'Dana Cohen' },
    activeOrganizationCountryCode: 'US',
  });
  assert.equal(block.office_context.label, 'Office');
  assert.deepEqual(block.workspace_greeting, { text: 'Hi, Dana', direction: 'ltr' });
});

test('5. first name comes from the authenticated full name only (no hardcoding, no fallback invention)', () => {
  assert.equal(resolveEmployeeFirstName('  דנה   כהן '), 'דנה');
  assert.equal(resolveEmployeeFirstName(null), null);
  assert.equal(resolveEmployeeFirstName('   '), null);
  const block = buildSidebarAccountBlock({ ...base, user: { email: 'x@y.z', fullName: null } });
  assert.equal(block.workspace_greeting, null);
});

test('6. Client Operations workspace contract hides the handler (presentation) for employees only', () => {
  const svc = repo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  assert.match(svc, /show_handler: workspace\.allowed_scopes\.some\(\(s\) => s\.scope_kind === 'OFFICE'\),/);
  // Assigned-handler truth is not removed from the registry presentation.
  const presentation = repo('apps/api/src/domains/client-operations/client-operations-registry-presentation.pure.ts');
  assert.match(presentation, /key: 'handler',/);
});

test('7. registry view hides handler column/filter and the empty-state sentence (no aggregate change)', () => {
  const view = web('components/client-operations/ClientOperationsRegistryView.tsx');
  assert.match(view, /const showHandler = workspace\?\.show_handler !== false;/);
  assert.match(view, /showHandler \? all : all\.filter\(\(c\) => c\.key !== 'handler'\)/);
  assert.match(view, /\.filter\(\(def\) => showHandler \|\| def\.id !== 'handler'\)/);
  assert.doesNotMatch(view, /nx-co-sheet__empty/);
  assert.doesNotMatch(view, /לא נמצאו לקוחות/);
});

test('8. sidebar: no internal scrollbar, language hidden by backend flag, sign-out + office context rendered from the block', () => {
  const css = web('templates/template-1/t1-sidebar-account.css');
  assert.match(css, /\.t1-sidebar__nav\s*\{[^}]*scrollbar-width: none;/);
  assert.match(css, /\.t1-sidebar__nav::-webkit-scrollbar\s*\{\s*display: none;/);
  const block = web('templates/template-1/components/SidebarAccountBlock.tsx');
  assert.match(block, /block\.language_selector\?\.visible === true/);
  assert.match(block, /block\.logout_action\?\.visible !== false/);
  assert.match(block, /block\.office_context\?\.visible/);
});

test('9. employee greeting is the CO header top line; header + shell typography is Arial', () => {
  const header = web('templates/template-1/components/ClientOperationsAppHeader.tsx');
  assert.match(header, /\{greetingText \? \(\s*<h1 className="nx-co-app-header__title" data-testid="client-operations-greeting">\s*\{greetingText\}/);
  assert.match(header, /<h1 className="nx-co-app-header__title">\{CLIENT_OPERATIONS_HEADER_TITLE_HE\}<\/h1>/);
  const layout = web('templates/template-1/TemplateLayout.tsx');
  assert.match(layout, /greetingText=\{sidebarAccountBlock\.workspace_greeting\?\.text \?\? null\}/);
  const shell = web('styles/nx-client-operations-shell.css');
  assert.match(shell, /\.t1-appShell--client-operations \{\s*\/\*[^*]*\*\/\s*font-family: Arial, sans-serif;/);
  const todo = web('styles/nx-client-operations-todo.css');
  assert.match(todo, /font-family: Arial, sans-serif !important;/);
});
