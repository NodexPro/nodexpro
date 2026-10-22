/**
 * Two-office isolation harness.
 * Executes only when NODEXPRO_ISOLATION_IT=1 and a disposable API + synthetic fixtures exist.
 * Default: NOT EXECUTED (skip). Mock-only tests elsewhere do not certify isolation.
 *
 * Required env (disposable API only — never production):
 *   NODEXPRO_ISOLATION_IT=1
 *   NODEXPRO_ISOLATION_API_BASE=https://…  (or http://127.0.0.1:…)
 *   NODEXPRO_IT_OFFICE_A_TOKEN / _ORG / _CLIENT
 *   NODEXPRO_IT_OFFICE_B_TOKEN / _ORG / _CLIENT
 * Optional:
 *   NODEXPRO_IT_OFFICE_A_DOCUMENT / NODEXPRO_IT_OFFICE_B_DOCUMENT
 *   NODEXPRO_IT_SUSPENDED_TOKEN
 *   NODEXPRO_IT_REVOKED_TOKEN
 *   NODEXPRO_IT_POSTGREST_URL / NODEXPRO_IT_POSTGREST_ANON_KEY
 *
 * Blocker when skipped: apps/api/.env is absent, SUPABASE_URL is unset,
 * and no synthetic office JWTs exist in this workspace.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.NODEXPRO_ISOLATION_IT === '1';
const apiBase = (process.env.NODEXPRO_ISOLATION_API_BASE ?? '').replace(/\/$/, '');
const postgrestUrl = (process.env.NODEXPRO_IT_POSTGREST_URL ?? '').replace(/\/$/, '');
const postgrestAnon = process.env.NODEXPRO_IT_POSTGREST_ANON_KEY ?? '';

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

function jsonHasForeignTenant(body: unknown, foreignOrgId: string, foreignClientId: string): boolean {
  const raw = JSON.stringify(body ?? {});
  return raw.includes(foreignOrgId) || raw.includes(foreignClientId);
}

async function api(
  path: string,
  opts: { token?: string; orgId?: string; method?: string; body?: unknown },
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
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

async function postgrest(
  table: string,
  opts: { token: string; query?: string },
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {
    apikey: postgrestAnon,
    Authorization: `Bearer ${opts.token}`,
  };
  const res = await fetch(`${postgrestUrl}/rest/v1/${table}${opts.query ?? ''}`, { headers });
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
    t.skip(
      'NOT EXECUTED: NODEXPRO_ISOLATION_IT / disposable API / synthetic office fixtures are unset. apps/api/.env is absent.',
    );
    return;
  }
  const officeA = fixture('A');
  const officeB = fixture('B');
  const suspended = process.env.NODEXPRO_IT_SUSPENDED_TOKEN;
  const revoked = process.env.NODEXPRO_IT_REVOKED_TOKEN;
  assert.ok(officeA && officeB, 'synthetic office fixtures required');

  const publicHealth = await api('/api/v1/health', {});
  assert.equal(publicHealth.status, 200);

  const allowed = await api(`/api/v1/organizations/${officeA.orgId}/clients/${officeA.clientId}`, {
    token: officeA.token,
    orgId: officeA.orgId,
  });
  assert.equal(allowed.status, 200, 'active user in authorized org must keep existing read behavior');
  assert.equal(jsonHasForeignTenant(allowed.json, officeB.orgId, officeB.clientId), false);

  const session = await api('/api/v1/auth/session', { token: officeA.token, orgId: officeA.orgId });
  assert.equal(session.status, 200);

  const crossRead = await api(`/api/v1/organizations/${officeB.orgId}/clients/${officeB.clientId}`, {
    token: officeA.token,
    orgId: officeB.orgId,
  });
  assert.ok(crossRead.status === 403 || crossRead.status === 404, 'Office A must not read Office B');
  assert.equal(jsonHasForeignTenant(crossRead.json, officeB.orgId, officeB.clientId), false);

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

  const arCross = await api('/api/v1/accounting-base/aggregates/accounts-receivable', {
    token: officeA.token,
    orgId: officeB.orgId,
  });
  assert.ok(arCross.status === 401 || arCross.status === 403 || arCross.status === 404);

  const weCross = await api('/api/v1/work-engine/aggregates/foundation', {
    token: officeA.token,
    orgId: officeB.orgId,
  });
  assert.ok(weCross.status === 401 || weCross.status === 403 || weCross.status === 404);

  if (officeB.documentId) {
    const docCross = await api(
      `/api/v1/organizations/${officeB.orgId}/documents/${officeB.documentId}/open`,
      { token: officeA.token, orgId: officeB.orgId },
    );
    assert.ok(docCross.status === 401 || docCross.status === 403 || docCross.status === 404);
  }

  if (suspended) {
    const denied = await api(`/api/v1/auth/session`, { token: suspended, orgId: officeA.orgId });
    assert.equal(denied.status, 401);
    const deniedAgg = await api(`/api/v1/organizations/${officeA.orgId}/clients/${officeA.clientId}`, {
      token: suspended,
      orgId: officeA.orgId,
    });
    assert.equal(deniedAgg.status, 401);
  }

  if (revoked) {
    const deniedRevoked = await api(`/api/v1/organizations/${officeA.orgId}/clients/${officeA.clientId}`, {
      token: revoked,
      orgId: officeA.orgId,
    });
    assert.ok(deniedRevoked.status === 401 || deniedRevoked.status === 403 || deniedRevoked.status === 404);
  }

  if (postgrestUrl && postgrestAnon) {
    const restClients = await postgrest('clients', {
      token: officeA.token,
      query: `?organization_id=eq.${encodeURIComponent(officeB.orgId)}&select=id,organization_id`,
    });
    assert.ok(
      restClients.status === 401 || restClients.status === 403 || restClients.status === 404,
      'browser JWT must not SELECT Office B clients via PostgREST',
    );
    if (Array.isArray(restClients.json)) {
      assert.equal(restClients.json.length, 0);
    }
  }
});
