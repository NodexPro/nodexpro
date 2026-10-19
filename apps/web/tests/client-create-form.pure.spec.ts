import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beginExclusiveSubmit,
  buildCreateClientCommandPayload,
  CORE_CREATE_CLIENT_CONTACT_REQUIRED,
  endExclusiveSubmit,
  firstInvalidCreateClientFocusField,
  hasCreateClientContactMethod,
  mapCreateClientCommandError,
  validateCreateClientDraft,
  type CreateClientDraft,
} from '../src/pages/client-create-form.pure.ts';
import { canonicalCreatedClientId, clientCardPath } from '../src/pages/client-create-navigation.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const clientsSrc = readFileSync(join(dir, '../src/pages/Clients.tsx'), 'utf8');
const en = JSON.parse(readFileSync(join(dir, '../src/i18n/en.json'), 'utf8')) as {
  clients: { contact: Record<string, string>; errors: Record<string, string> };
};
const he = JSON.parse(readFileSync(join(dir, '../src/i18n/he.json'), 'utf8')) as {
  clients: { contact: Record<string, string>; errors: Record<string, string> };
};

function draft(partial: Partial<CreateClientDraft> = {}): CreateClientDraft {
  return {
    tax_id: '515000000',
    display_name: 'Acme',
    client_type: 'business_customer',
    phone: '',
    email: '',
    website: '',
    country_code: '',
    city: '',
    street: '',
    postal_code: '',
    ...partial,
  };
}

test('missing both phone and email is invalid and must not POST', () => {
  const result = validateCreateClientDraft(draft());
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected invalid');
  assert.equal(result.field, 'contact');
  assert.equal(result.messageKey, 'clients.contact.requiredHint');
  assert.equal(hasCreateClientContactMethod('', ''), false);
  assert.equal(hasCreateClientContactMethod('  ', '  '), false);
  assert.match(clientsSrc, /validateCreateClientDraft/);
  const validateIdx = clientsSrc.indexOf('validateCreateClientDraft');
  const postIdx = clientsSrc.indexOf("method: 'POST'");
  assert.ok(validateIdx >= 0 && postIdx > validateIdx);
});

test('phone-only draft is valid and payload keeps email null', () => {
  const filled = draft({ phone: ' 050-0000000 ' });
  assert.equal(validateCreateClientDraft(filled).ok, true);
  assert.deepEqual(buildCreateClientCommandPayload(filled), {
    tax_id: '515000000',
    display_name: 'Acme',
    client_type: 'business_customer',
    phone: '050-0000000',
    email: null,
    website: null,
    country_code: null,
    city: null,
    street: null,
    postal_code: null,
  });
});

test('email-only draft is valid and payload keeps phone null', () => {
  const filled = draft({ email: ' owner@acme.test ' });
  assert.equal(validateCreateClientDraft(filled).ok, true);
  const payload = buildCreateClientCommandPayload(filled);
  assert.equal(payload.phone, null);
  assert.equal(payload.email, 'owner@acme.test');
});

test('backend 400 contact-method response maps to localized contact validation', () => {
  const mapped = mapCreateClientCommandError({
    status: 400,
    code: 'BAD_REQUEST',
    message: CORE_CREATE_CLIENT_CONTACT_REQUIRED,
  });
  assert.equal(mapped.kind, 'validation');
  assert.equal(mapped.field, 'contact');
  assert.equal(mapped.messageKey, 'clients.contact.requiredHint');
  assert.equal(firstInvalidCreateClientFocusField(mapped.field), 'phone');
  const taxId = mapCreateClientCommandError({ status: 400, code: 'BAD_REQUEST', message: 'tax_id is required' });
  assert.equal(taxId.field, 'tax_id');
  assert.equal(taxId.messageKey, 'clients.errors.taxIdRequired');
});

test('duplicate 409 maps to tax-id conflict, not generic failure', () => {
  const mapped = mapCreateClientCommandError({
    status: 409,
    code: 'CONFLICT',
    message: 'A client with this tax ID (HP) already exists in this organization',
  });
  assert.equal(mapped.kind, 'conflict');
  assert.equal(mapped.field, 'tax_id');
  assert.equal(mapped.messageKey, 'clients.errors.duplicateTaxId');
});

test('authorization 401/403 maps to session/permission, not validation', () => {
  const unauthorized = mapCreateClientCommandError({ status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' });
  const forbidden = mapCreateClientCommandError({ status: 403, code: 'FORBIDDEN', message: 'Insufficient permission' });
  assert.equal(unauthorized.kind, 'unauthorized');
  assert.equal(forbidden.kind, 'unauthorized');
  assert.equal(unauthorized.messageKey, 'clients.errors.unauthorized');
  assert.notEqual(unauthorized.messageKey, 'clients.errors.validation');
});

test('network and 5xx map to retryable without exposing internals', () => {
  const network = mapCreateClientCommandError(new TypeError('Failed to fetch'));
  const server = mapCreateClientCommandError({ status: 500, message: 'relation "clients" does not exist' });
  assert.equal(network.kind, 'retryable');
  assert.equal(server.kind, 'retryable');
  assert.equal(network.messageKey, 'clients.errors.retryable');
  assert.equal(server.messageKey, 'clients.errors.retryable');
  const createFn = clientsSrc.slice(
    clientsSrc.indexOf('const createClient'),
    clientsSrc.indexOf('const handleImportFile'),
  );
  assert.doesNotMatch(createFn, /err\.message|e\.message/);
  assert.match(createFn, /setCreateError\(t\(mapped\.messageKey\)\)/);
});

test('double-click Create is rejected while a request is pending', () => {
  const lock = { current: false };
  assert.equal(beginExclusiveSubmit(lock), true);
  assert.equal(beginExclusiveSubmit(lock), false);
  assert.equal(lock.current, true);
  endExclusiveSubmit(lock);
  assert.equal(beginExclusiveSubmit(lock), true);
  assert.match(clientsSrc, /beginExclusiveSubmit/);
  assert.match(clientsSrc, /disabled=\{createSubmitting\}/);
});

test('successful create still navigates with the canonical returned client id', () => {
  assert.match(clientsSrc, /canonicalCreatedClientId/);
  assert.match(clientsSrc, /clientCardPath\(clientId\)/);
  assert.equal(canonicalCreatedClientId({ id: '  abc-123  ' }), 'abc-123');
  assert.equal(clientCardPath('abc-123'), '/clients/abc-123');
  assert.doesNotMatch(clientsSrc, /setTimeout|sleep\(/);
});

test('EN/HE contact and create-error copy exist; modal is RTL/LTR', () => {
  assert.ok(en.clients.contact.requiredHint.length > 0);
  assert.ok(he.clients.contact.requiredHint.length > 0);
  assert.ok(en.clients.errors.duplicateTaxId.length > 0);
  assert.ok(he.clients.errors.duplicateTaxId.length > 0);
  assert.ok(en.clients.errors.unauthorized.length > 0);
  assert.ok(he.clients.errors.unauthorized.length > 0);
  assert.ok(en.clients.errors.retryable.length > 0);
  assert.ok(he.clients.errors.retryable.length > 0);
  assert.match(clientsSrc, /dir=\{lang === 'he' \? 'rtl' : 'ltr'\}/);
  assert.match(clientsSrc, /createError/);
  assert.match(clientsSrc, /nx-clients-field-error/);
});

test('royal-glass Create Client experiment is modal-scoped and one-step rollback', () => {
  const css = readFileSync(join(dir, '../src/styles/nx-client-create-royal-glass.css'), 'utf8');
  const productionCss = readFileSync(join(dir, '../src/styles/nx-clients.css'), 'utf8');
  assert.match(clientsSrc, /CREATE_CLIENT_MODAL_APPEARANCE: 'current' \| 'royal-glass'/);
  assert.match(clientsSrc, /nx-client-create--royal-glass/);
  assert.match(css, /\.nx-client-create--royal-glass/);
  assert.match(css, /grid-template-columns: 1fr 1fr/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(css, /(?:^|\n)\.nx-clients-overlay\s*\{/);
  assert.doesNotMatch(clientsSrc.split('showImport')[1] ?? '', /nx-client-create--royal-glass/);
  assert.match(productionCss, /\.nx-clients-modal \{/);
  assert.match(clientsSrc, /validateCreateClientDraft/);
  assert.match(clientsSrc, /buildCreateClientCommandPayload/);
});
