import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLIENT_OPERATIONS_SETUP_WARNING_DISMISSED_COMMAND,
  shouldShowSetupWarning,
} from '../src/lib/client-operations-setup-warning-session.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const registrySrc = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const viewSrc = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const serviceSrc = readFileSync(
  join(dir, '../../api/src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const gapsSrc = readFileSync(
  join(dir, '../../api/src/domains/client-operations/client-operations-reporting-setup-gaps.pure.ts'),
  'utf8',
);
const layoutServiceSrc = readFileSync(
  join(dir, '../../api/src/domains/client-operations/client-operations-user-sheet-layout.service.ts'),
  'utf8',
);
const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8')) as {
  clientOperations: { setupWarning: { title: string; dontShowUntilNewClient: string } };
};
const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8')) as {
  clientOperations: { setupWarning: { title: string; dontShowUntilNewClient: string } };
};

test('setup warning stays hidden until a newer clients-added generation, not when gaps change', () => {
  assert.equal(
    shouldShowSetupWarning({
      count: 2,
      clientsAddedToken: '2',
      dismissedClientsAddedToken: null,
    }),
    true,
  );
  assert.equal(
    shouldShowSetupWarning({
      count: 2,
      clientsAddedToken: '2',
      dismissedClientsAddedToken: '2',
    }),
    false,
  );
  assert.equal(
    shouldShowSetupWarning({
      count: 1,
      clientsAddedToken: '2',
      dismissedClientsAddedToken: '2',
    }),
    false,
  );
  assert.equal(
    shouldShowSetupWarning({
      count: 3,
      clientsAddedToken: '10',
      dismissedClientsAddedToken: '9',
    }),
    true,
  );
  assert.equal(
    shouldShowSetupWarning({
      count: 1,
      clientsAddedToken: '9',
      dismissedClientsAddedToken: '9',
    }),
    false,
  );
  assert.equal(
    shouldShowSetupWarning({ count: 0, clientsAddedToken: '2', dismissedClientsAddedToken: null }),
    false,
  );
});

test('Client Operations warning is aggregate-owned Deep Ocean table and opens the folder modal', () => {
  assert.equal(
    CLIENT_OPERATIONS_SETUP_WARNING_DISMISSED_COMMAND,
    'set_client_operations_setup_warning_dismissed',
  );
  assert.match(serviceSrc, /clients_needing_setup/);
  assert.match(serviceSrc, /TEMPORARY_COUNTRY_PACK_PENDING/);
  assert.match(serviceSrc, /clientReportingSetupGaps/);
  assert.match(serviceSrc, /loadOrganizationClientsAddedGeneration/);
  assert.doesNotMatch(serviceSrc, /clientsAddedToken\(activeSafe\)/);
  assert.match(gapsSrc, /clients_added_token/);
  assert.match(gapsSrc, /formatClientsAddedGeneration/);
  assert.match(gapsSrc, /setupWarningVisible/);
  assert.doesNotMatch(gapsSrc, /missing.push\('vat_due_type'\)/);
  assert.match(layoutServiceSrc, /apply_client_operations_setup_warning_dismissed/);
  assert.match(registrySrc, /clients_needing_setup/);
  assert.match(registrySrc, /CLIENT_OPERATIONS_SETUP_WARNING_DISMISSED_COMMAND/);
  assert.match(registrySrc, /nx-client-create--deep-ocean-glass/);
  assert.match(registrySrc, /client-operations-setup-warning/);
  assert.match(registrySrc, /nx-co-setup-warning-table/);
  assert.match(registrySrc, /dont_show_again_key/);
  assert.match(registrySrc, /setup\?\.visible/);
  assert.match(registrySrc, /applySetupWarning/);
  assert.match(gapsSrc, /income_tax_advance_applicability/);
  assert.match(gapsSrc, /national_insurance_applicability/);
  assert.doesNotMatch(gapsSrc, /fee_agreement/);
  assert.match(registrySrc, /setSetupFolderRequest/);
  assert.match(registrySrc, /tab: 'taxes'/);
  assert.doesNotMatch(registrySrc, /navigate\(client\.settings_href\)/);
  assert.doesNotMatch(registrySrc, /localStorage/);
  assert.doesNotMatch(registrySrc, /sessionStorage/);
  assert.doesNotMatch(registrySrc, /vat_frequency === ''/);
  assert.match(viewSrc, /pendingOpenTab/);
  assert.match(viewSrc, /initialTab=\{modalInitialTab\}/);
  assert.equal(he.clientOperations.setupWarning.title, 'נדרשת השלמת הגדרות לקוחות');
  assert.equal(
    he.clientOperations.setupWarning.dontShowUntilNewClient,
    'אל תציג שוב עד להוספת לקוח חדש',
  );
  assert.equal(
    en.clientOperations.setupWarning.dontShowUntilNewClient,
    "Don't show again until a new client is added",
  );
});
