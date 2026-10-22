/**
 * Two-office isolation harness.
 * Executes only when NODEXPRO_ISOLATION_IT=1 and a disposable API + synthetic fixtures exist.
 * Default: NOT EXECUTED (skip). Mock-only tests elsewhere do not certify isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.NODEXPRO_ISOLATION_IT === '1';
const apiBase = (process.env.NODEXPRO_ISOLATION_API_BASE ?? '').replace(/\/$/, '');

type OfficeFixture = {
  token: string;
  orgId: string;
  clientId: string;
  documentId?: string;
};

function fixture(prefix: 'A' | 'B'): OfficeFixture | null {
  const token = process.env[`NODEXPRO_IT_OFFICE_${prefix}_TOKEN`];
  const orgId = process.env[`NODEXPRO_IT_OFFICE_${prefix}_ORG`];
  const clientId = process.env[`NODEXPRO_IT_OFFICE_${prefix}_CLIENT`];
  if (!token || !orgId || !clientId) return null;
  return {
    token,
    orgId,
    clientId,
    documentId: process.env[`NODEXPRO_IT_OFFICE_${prefix}_DOCUMENT`],
  };
}

async function api(
  path: string,
  opts: { token: string; orgId?: string; method?: string; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.token}`,
    'Content-Type': 'application/json',
  };
  if (opts.orgId) headers['X-Organization-Id'] = opts.orgId;
  const res = await fetch(`${apiBase}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

test('Office A/B HTTP isolation (skipped unless NODEXPRO_ISOLATION_IT=1)', async (t) => {
  if (!enabled || !apiBase) {
    t.skip('NOT EXECUTED: set NODEXPRO_ISOLATION_IT=1 and synthetic office env on a disposable API');
    return;
  }
  const officeA = fixture('A');
  const officeB = fixture('B');
  const suspended = process.env.NODEXPRO_IT_SUSPENDED_TOKEN;
  assert.ok(officeA && officeB, 'synthetic office fixtures required');

  const allowed = await api(`/api/v1/organizations/${officeA.orgId}/clients/${officeA.clientId}`, {
    token: officeA.token,
    orgId: officeA.orgId,
  });
  assert.equal(allowed.status, 200, 'active user in authorized org must keep existing read behavior');

  const crossRead = await api(`/api/v1/organizations/${officeB.orgId}/clients/${officeB.clientId}`, {
    token: officeA.token,
    orgId: officeB.orgId,
  });
  assert.ok(crossRead.status === 403 || crossRead.status === 404, 'Office A must not read Office B');

  const spoofHeader = await api(`/api/v1/organizations/${officeA.orgId}/clients/${officeB.clientId}`, {
    token: officeA.token,
    orgId: officeB.orgId,
  });
  assert.ok(spoofHeader.status === 403 || spoofHeader.status === 404);

  const crossCommand = await api(
    `/api/v1/organizations/${officeB.orgId}/clients/${officeB.clientId}/commands/update_client`,
    {
      token: officeA.token,
      orgId: officeB.orgId,
      method: 'POST',
      body: { display_name: 'x' },
    },
  );
  assert.ok(crossCommand.status >= 400);

  if (suspended) {
    const denied = await api(`/api/v1/auth/session`, { token: suspended, orgId: officeA.orgId });
    assert.equal(denied.status, 401);
    const deniedAgg = await api(`/api/v1/organizations/${officeA.orgId}/clients/${officeA.clientId}`, {
      token: suspended,
      orgId: officeA.orgId,
    });
    assert.equal(deniedAgg.status, 401);
  }
});
