import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveOfficeClientGroupKey } from '../../src/domains/income/income-client-document-management-panel.pure.js';

describe('resolveOfficeClientGroupKey', () => {
  it('uses represented_client_id when present', () => {
    assert.equal(
      resolveOfficeClientGroupKey({
        represented_client_id: 'client-a',
        issuer_business_id: 'issuer-a',
        acting_mode: 'office_representative',
      }),
      'client-a',
    );
  });

  it('falls back to issuer_business_id for office mode legacy rows', () => {
    assert.equal(
      resolveOfficeClientGroupKey({
        represented_client_id: null,
        issuer_business_id: 'client-a',
        acting_mode: 'office_representative',
      }),
      'client-a',
    );
  });

  it('excludes self mode documents without represented client', () => {
    assert.equal(
      resolveOfficeClientGroupKey({
        represented_client_id: null,
        issuer_business_id: 'org-issuer',
        acting_mode: 'self',
      }),
      null,
    );
  });
});
