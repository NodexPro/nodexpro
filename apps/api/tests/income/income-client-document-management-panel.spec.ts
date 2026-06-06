import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  belongsToOfficeClientRow,
  resolveOfficeClientGroupKey,
} from '../../src/domains/income/income-client-document-management-panel.pure.js';

describe('resolveOfficeClientGroupKey', () => {
  it('uses represented_client_id when issuer matches in office mode', () => {
    assert.equal(
      resolveOfficeClientGroupKey({
        represented_client_id: 'client-a',
        issuer_business_id: 'client-a',
        acting_mode: 'office_representative',
      }),
      'client-a',
    );
  });

  it('rejects office rows where issuer_business_id belongs to another client', () => {
    assert.equal(
      resolveOfficeClientGroupKey({
        represented_client_id: 'client-a',
        issuer_business_id: 'issuer-a',
        acting_mode: 'office_representative',
      }),
      null,
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

  it('excludes self mode even when represented_client_id is populated', () => {
    assert.equal(
      resolveOfficeClientGroupKey({
        represented_client_id: 'client-a',
        issuer_business_id: 'client-a',
        acting_mode: 'self',
      }),
      null,
    );
  });

  it('includes legacy office rows with null acting_mode when ids match', () => {
    assert.equal(
      resolveOfficeClientGroupKey({
        represented_client_id: 'client-a',
        issuer_business_id: 'client-a',
        acting_mode: '',
      }),
      'client-a',
    );
  });
});

describe('belongsToOfficeClientRow', () => {
  it('matches only the requested office client row', () => {
    const row = {
      represented_client_id: 'test4',
      issuer_business_id: 'test4',
      acting_mode: 'office_representative',
    };
    assert.equal(belongsToOfficeClientRow(row, 'test4'), true);
    assert.equal(belongsToOfficeClientRow(row, 'other-client'), false);
  });
});
