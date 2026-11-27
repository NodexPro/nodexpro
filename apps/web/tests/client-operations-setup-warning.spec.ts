import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  setupWarningStorageKey,
  shouldShowSetupWarning,
} from '../src/lib/client-operations-setup-warning-session.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const registrySrc = readFileSync(join(dir, '../src/pages/ClientOperationsRegistry.tsx'), 'utf8');
const serviceSrc = readFileSync(
  join(dir, '../../api/src/domains/client-operations/client-operations.service.ts'),
  'utf8',
);
const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8')) as {
  clientOperations: { setupWarning: { title: string } };
};
const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8')) as {
  clientOperations: { setupWarning: { title: string } };
};

test('setup warning does not re-open for the same fingerprint in the current visit', () => {
  assert.equal(
    shouldShowSetupWarning({ count: 2, fingerprint: 'a:business_type', dismissedFingerprint: null }),
    true,
  );
  assert.equal(
    shouldShowSetupWarning({
      count: 2,
      fingerprint: 'a:business_type',
      dismissedFingerprint: 'a:business_type',
    }),
    false,
  );
  assert.equal(
    shouldShowSetupWarning({
      count: 1,
      fingerprint: 'a:vat_applicability',
      dismissedFingerprint: 'a:business_type',
    }),
    true,
  );
  assert.equal(shouldShowSetupWarning({ count: 0, fingerprint: 'x', dismissedFingerprint: null }), false);
  assert.match(setupWarningStorageKey('org-1'), /org-1/);
});

test('Client Operations warning is aggregate-owned Deep Ocean chrome, not a frontend tax check', () => {
  assert.match(serviceSrc, /clients_needing_setup/);
  assert.match(serviceSrc, /TEMPORARY_COUNTRY_PACK_PENDING/);
  assert.match(serviceSrc, /clientReportingSetupGaps/);
  assert.match(registrySrc, /clients_needing_setup/);
  assert.match(registrySrc, /nx-client-create--deep-ocean-glass/);
  assert.match(registrySrc, /client-operations-setup-warning/);
  assert.doesNotMatch(registrySrc, /vat_frequency === ''/);
  assert.equal(he.clientOperations.setupWarning.title, 'נדרשת השלמת הגדרות לקוחות');
  assert.ok(en.clientOperations.setupWarning.title.length > 0);
});
