import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  moduleBlockReasonKeyFromEntitlement,
  moduleCatalogNameKey,
  modulePlanNameKey,
} from '../../src/domains/modules/module-catalog-copy.pure.js';
import { buildSidebarAccountBlock } from '../../src/domains/auth/sidebar-account-block.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('modules-state emits catalog label keys without changing entitlement logic', () => {
  assert.equal(moduleCatalogNameKey('client-operations'), 'modules.catalogName.client-operations');
  assert.equal(modulePlanNameKey('standard'), 'modules.planName.standard');
  assert.equal(
    moduleBlockReasonKeyFromEntitlement('No subscription or trial for this module', []),
    'modules.blockReason.noSubscription',
  );
  const state = read('../../src/domains/modules/modules-state.service.ts');
  assert.match(state, /nameKey: moduleCatalogNameKey\(m\.code\)/);
  assert.match(state, /blockReasonKey/);
  assert.match(state, /No subscription or trial for this module/);
});

test('requireModuleActive 403s carry entitlement codes', () => {
  const gate = read('../../src/middleware/requireModuleActive.ts');
  assert.match(gate, /MODULE_NOT_ACTIVE/);
  assert.match(gate, /MODULE_NOT_ENTITLED/);
  assert.match(gate, /ORGANIZATION_CONTEXT_REQUIRED/);
  assert.match(gate, /Module not active for this organization/);
});

test('sidebar organization switcher is hidden; organization_name remains from the current aggregate', () => {
  const block = buildSidebarAccountBlock({
    user: { email: 'a@b.c', fullName: 'Dana' },
    organizations: [
      { id: 'org-1', name: 'Office One' },
      { id: 'org-2', name: 'Office Two' },
    ],
    activeOrganizationId: 'org-2',
    shellProfile: 'full_platform',
    uiLanguage: 'en',
    activeOrganizationCountryCode: 'IL',
  });
  assert.equal(block.organization_switcher.visible, false);
  assert.equal(block.organization_name, 'Office Two');
  const authRoutes = read('../../src/domains/auth/auth.routes.ts');
  assert.match(authRoutes, /select_active_organization/);
});

test('PDF renderer reuses a shared Chromium instead of launching per request', () => {
  const renderer = read('../../src/domains/income/income-document-pdf.renderer.ts');
  const pool = read('../../src/domains/income/income-document-pdf-browser-pool.ts');
  const tab = read('../../../web/src/components/ClientAnnualReportTab.tsx');
  assert.match(pool, /getSharedPdfBrowser/);
  assert.match(renderer, /renderHtmlWithSharedPuppeteer/);
  assert.doesNotMatch(tab, /setPdfListOpen\(true\)[\s\S]{0,180}generate_client_document_list_pdf/);
});
