import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildEndCustomerQuickCard,
  buildOfficeClientDocflowInviteAction,
  buildOfficeClientQuickCard,
  resolveClientQuickCardDocflowInviteStatus,
} from '../../src/domains/income/income-client-quick-card.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const panelServiceSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);
const quickCardPureSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-quick-card.pure.ts'),
  'utf8',
);
const invoicesTabSource = readFileSync(
  join(dir, '../../src/domains/work-engine/work-engine-invoices-tab.read-model.service.ts'),
  'utf8',
);

describe('client quick card — office vs end customer contract', () => {
  it('office quick card includes DocFlow invite when available', () => {
    const card = buildOfficeClientQuickCard({
      clientId: 'client-1',
      identity: {
        display_name: 'Test3',
        tax_id: '123',
        email: 'a@b.com',
        phone: '050',
        business_type: 'עוסק מורשה',
        contact_person: 'Dana',
      },
      docflow: { module_entitled: true, invite_status: 'not_invited' },
    });
    assert.equal(card.enabled, true);
    assert.equal(card.population_key, 'office_client');
    assert.ok(card.rows.some((r) => r.key === 'email' && r.copy_value === 'a@b.com'));
    assert.ok(card.rows.some((r) => r.key === 'tax_id' && r.copy_enabled));
    const invite = card.actions.find((a) => a.action_key === 'invite_to_docflow');
    assert.ok(invite);
    assert.equal(invite!.enabled, true);
    assert.equal(invite!.state_key, 'available');
    assert.equal(invite!.command, 'invite_client_to_docflow');
    assert.deepEqual(invite!.command_payload, { client_id: 'client-1' });
  });

  it('end-customer quick card has same identity rows and NO DocFlow invite', () => {
    const card = buildEndCustomerQuickCard({
      incomeCustomerId: 'cust-1',
      identity: {
        display_name: 'Chicago',
        tax_id: '999',
        email: 'c@d.com',
        phone: null,
        business_type: null,
        contact_person: null,
      },
    });
    assert.equal(card.population_key, 'office_client_customer');
    assert.ok(card.rows.some((r) => r.key === 'client_name'));
    assert.ok(card.rows.some((r) => r.key === 'email' && r.copy_value === 'c@d.com'));
    assert.equal(card.actions.length, 0);
    assert.equal(
      card.actions.find((a) => a.action_key === 'invite_to_docflow'),
      undefined,
    );
  });

  it('RBAC / module entitlement disables office DocFlow invite', () => {
    const action = buildOfficeClientDocflowInviteAction({
      clientId: 'client-1',
      email: 'a@b.com',
      phone: null,
      docflow: { module_entitled: false, invite_status: 'not_invited' },
    });
    assert.equal(action.enabled, false);
    assert.equal(action.state_key, 'permission_denied');
    assert.equal(action.command, null);
  });

  it('invitation_sent / connected states disable invite without inventing lifecycle', () => {
    const sent = buildOfficeClientDocflowInviteAction({
      clientId: 'c',
      email: 'a@b.com',
      phone: null,
      docflow: { module_entitled: true, invite_status: 'invited' },
    });
    assert.equal(sent.state_key, 'invitation_sent');
    assert.equal(sent.enabled, false);

    const joined = buildOfficeClientDocflowInviteAction({
      clientId: 'c',
      email: 'a@b.com',
      phone: null,
      docflow: { module_entitled: true, invite_status: 'joined' },
    });
    assert.equal(joined.state_key, 'connected');
    assert.equal(joined.enabled, false);
  });

  it('resolves invite status from portal + invitation rows (existing DocFlow semantics)', () => {
    assert.equal(
      resolveClientQuickCardDocflowInviteStatus({
        portalStatus: 'active',
        inviteStatus: 'pending',
        tokenExpiresAt: null,
      }),
      'joined',
    );
    assert.equal(
      resolveClientQuickCardDocflowInviteStatus({
        portalStatus: null,
        inviteStatus: 'pending',
        tokenExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      'invited',
    );
  });
});

describe('client quick card — panel wiring / no N+1', () => {
  it('WE invoices tab enables includeClientQuickCard', () => {
    assert.match(invoicesTabSource, /includeClientQuickCard:\s*true/);
  });

  it('panel batches quick-card enrichment (profiles, contacts, portal) with .in(', () => {
    assert.match(panelServiceSource, /includeClientQuickCard/);
    assert.match(panelServiceSource, /buildOfficeClientQuickCard/);
    assert.match(panelServiceSource, /buildEndCustomerQuickCard/);
    assert.match(panelServiceSource, /client_operational_profiles[\s\S]*\.in\('client_id'/);
    assert.match(panelServiceSource, /client_portal_invitations[\s\S]*\.in\('client_id'/);
    assert.doesNotMatch(
      panelServiceSource,
      /for\s*\([^)]*officeClientIds[\s\S]{0,80}await supabaseAdmin/,
    );
  });

  it('reuses invite_client_to_docflow command key', () => {
    assert.match(quickCardPureSource, /invite_client_to_docflow/);
  });
});
