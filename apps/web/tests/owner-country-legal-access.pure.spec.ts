import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnerAccessExpertsPanel } from '../src/pages/owner-access-experts-panel.tsx';
import { BUSINESS_SETUP_AI_OWNER_NAV, parseOwnerWorkspaceNavigation } from '../src/pages/owner-business-setup-ai-nav.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('15 professional navigation hides owner administration', () => {
  const app = readRepo('apps/web/src/App.tsx');
  const shell = readRepo('apps/web/src/components/layout/AppShell.tsx');
  const auth = readRepo('apps/api/src/domains/auth/auth.routes.ts');
  const page = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  const navBlockStart = auth.indexOf('const navItems');
  const navBlockEnd = auth.indexOf('moduleAppNavItems.sort');
  const navBlock = auth.slice(navBlockStart, navBlockEnd);
  assert.doesNotMatch(navBlock, /platform-owner|legal-control|Access & Experts|access-experts/);
  assert.doesNotMatch(shell, /platform-owner|legal-control|Access & Experts|access-experts/);
  assert.match(app, /path="\/platform-owner\/legal-control"/);
  assert.match(page, /canShowAccessExperts/);
  assert.match(page, /OwnerAccessExpertsPanel/);
  assert.match(page, /Request submitted/);
  assert.doesNotMatch(
    BUSINESS_SETUP_AI_OWNER_NAV.flatMap((group) => group.items.map((item) => item.id)).join(','),
    /access-experts/,
  );
});

test('Access & Experts is not in default knowledge nav chrome', () => {
  const ids = BUSINESS_SETUP_AI_OWNER_NAV.flatMap((group) => group.items.map((item) => item.id));
  const labels = BUSINESS_SETUP_AI_OWNER_NAV.flatMap((group) => group.items.map((item) => item.label));
  assert.equal(ids.includes('access-experts'), false);
  assert.equal(labels.includes('Access & Experts'), false);
  const workspace = readRepo('apps/web/src/pages/owner-business-setup-ai-workspace.tsx');
  assert.match(workspace, /navGroups = BUSINESS_SETUP_AI_OWNER_NAV/);
});

test('Access & Experts renders from owner aggregate only', () => {
  const html = renderToStaticMarkup(
    createElement(OwnerAccessExpertsPanel, {
      access: {
        capability_catalog: [
          { code: 'legal_knowledge.view', label: 'View knowledge' },
          { code: 'legal_knowledge.activate', label: 'Activate/Publish', is_activation: true },
        ],
        pending_requests: [
          {
            request_id: 'r1',
            email: 'expert@example.com',
            requested_country_codes: ['IL'],
            note: 'reason',
            status: 'pending',
            requested_at: '2026-09-11',
          },
        ],
        experts: [
          {
            email: 'expert@example.com',
            name: 'Dana',
            user_id: null,
            assignments: [
              {
                assignment_id: 'a1',
                email: 'expert@example.com',
                name: 'Dana',
                country_code: 'IL',
                capabilities: ['legal_knowledge.view'],
                status: 'active',
                granted_by: 'owner@example.com',
                granted_at: '2026-09-11',
                last_changed: '2026-09-11',
              },
            ],
          },
        ],
      },
      countries: [{ code: 'IL', name: 'Israel' }],
      busy: false,
      onCommand: async () => undefined,
    }),
  );
  assert.match(html, /Pending Requests/);
  assert.match(html, /expert@example.com/);
  assert.match(html, /Activate\/Publish \(default off\)/);
  assert.match(html, /Country Experts/);
  assert.doesNotMatch(html, /password|token/);
});

test('backend navigation parser does not invent Access & Experts', () => {
  assert.equal(parseOwnerWorkspaceNavigation(null), null);
  const parsed = parseOwnerWorkspaceNavigation([
    { group: 'TAX & LAW', items: [{ id: 'tax-knowledge', label: 'Laws & Sources' }] },
  ]);
  assert.equal(parsed?.[0].items.some((item) => item.id === 'access-experts'), false);
});
