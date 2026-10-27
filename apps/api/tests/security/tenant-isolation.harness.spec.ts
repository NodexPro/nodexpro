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
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const enabled = process.env.NODEXPRO_ISOLATION_IT === '1';
const apiBase = (process.env.NODEXPRO_ISOLATION_API_BASE ?? '').replace(/\/$/, '');
const postgrestUrl = (process.env.NODEXPRO_IT_POSTGREST_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const postgrestAnon = process.env.NODEXPRO_IT_POSTGREST_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

type OfficeFixture = {
  token: string;
  orgId: string;
  clientId: string;
  documentId?: string;
};

type FileFixtures = {
  officeA?: { orgId?: string; clientId?: string };
  officeB?: { orgId?: string; clientId?: string };
  tokens?: { A?: string; B?: string; employeeA?: string };
};

function loadFileFixtures(): FileFixtures | null {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../.stage6-isolation-fixtures.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as FileFixtures;
}

const fileFixtures = loadFileFixtures();

function fixture(prefix: 'A' | 'B'): OfficeFixture | null {
  const token = process.env[`NODEXPRO_IT_OFFICE_${prefix}_TOKEN`] ?? fileFixtures?.tokens?.[prefix];
  const orgId = process.env[`NODEXPRO_IT_OFFICE_${prefix}_ORG`] ?? fileFixtures?.[prefix === 'A' ? 'officeA' : 'officeB']?.orgId;
  const clientId = process.env[`NODEXPRO_IT_OFFICE_${prefix}_CLIENT`] ?? fileFixtures?.[prefix === 'A' ? 'officeA' : 'officeB']?.clientId;
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
  assert.equal(publicHealth.status, 200, `health ${publicHealth.status}`);

  const allowed = await api(`/api/v1/organizations/${officeA.orgId}/clients/${officeA.clientId}`, {
    token: officeA.token,
    orgId: officeA.orgId,
  });
  assert.equal(
    allowed.status,
    200,
    `authorized read must succeed: ${allowed.status} ${JSON.stringify(allowed.json)}`,
  );
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

  const employeeToken = process.env.NODEXPRO_IT_EMPLOYEE_A_TOKEN ?? fileFixtures?.tokens?.employeeA;
  if (employeeToken) {
    const empCross = await api(`/api/v1/organizations/${officeB.orgId}/clients/${officeB.clientId}`, {
      token: employeeToken,
      orgId: officeB.orgId,
    });
    assert.ok(empCross.status === 401 || empCross.status === 403 || empCross.status === 404);
    const empWrite = await api(
      `/api/v1/organizations/${officeA.orgId}/clients/${officeA.clientId}/commands/update_client`,
      { token: employeeToken, orgId: officeA.orgId, method: 'POST', body: { display_name: 'employee-bypass' } },
    );
    assert.ok(empWrite.status >= 400, 'employee must not update client without write permission');
  }

  const spoofedUser = await api(`/api/v1/organizations/${officeB.orgId}/clients/${officeB.clientId}`, {
    token: officeA.token,
    orgId: officeA.orgId,
  });
  assert.ok(spoofedUser.status === 403 || spoofedUser.status === 404);

  const payrollCross = await api(`/api/v1/m/client-operations/clients/${officeB.clientId}/payroll/commands`, {
    token: officeA.token,
    orgId: officeB.orgId,
    method: 'POST',
    body: { type: 'save_payroll_profile', payload: {} },
  });
  assert.ok(payrollCross.status >= 400);

  const taxCross = await api(`/api/v1/m/client-operations/clients/${officeB.clientId}/tax-settings`, {
    token: officeA.token,
    orgId: officeB.orgId,
  });
  assert.ok(taxCross.status === 401 || taxCross.status === 403 || taxCross.status === 404);

  const incomeCross = await api('/api/v1/income/aggregates/workspace-context', {
    token: officeA.token,
    orgId: officeB.orgId,
  });
  assert.ok(incomeCross.status === 401 || incomeCross.status === 403 || incomeCross.status === 404);

  const paymentCross = await api('/api/v1/accounting-base/commands', {
    token: officeA.token,
    orgId: officeB.orgId,
    method: 'POST',
    body: {
      type: 'record_and_allocate_income_payment',
      payload: { income_document_id: officeB.clientId, organization_id: officeB.orgId },
    },
  });
  assert.ok(paymentCross.status >= 400);

  const unknownDoc = '00000000-0000-4000-8000-000000000099';
  const signedUrlCross = await api(
    `/api/v1/organizations/${officeB.orgId}/documents/${unknownDoc}/open`,
    { token: officeA.token, orgId: officeB.orgId },
  );
  assert.ok(signedUrlCross.status === 401 || signedUrlCross.status === 403 || signedUrlCross.status === 404);

  const annualFileCross = await api(
    `/api/v1/m/client-operations/clients/${officeB.clientId}/annual/files/${unknownDoc}/open`,
    { token: officeA.token, orgId: officeB.orgId },
  );
  assert.ok(annualFileCross.status === 401 || annualFileCross.status === 403 || annualFileCross.status === 404);

  const noAuth = await api(`/api/v1/organizations/${officeA.orgId}/clients/${officeA.clientId}`, {});
  assert.equal(noAuth.status, 401);

  const serviceRoleAsUser = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceRoleAsUser && postgrestUrl && postgrestAnon) {
    const privileged = await postgrest('clients', {
      token: officeA.token,
      query: `?select=id,organization_id&organization_id=eq.${encodeURIComponent(officeB.orgId)}`,
    });
    assert.equal(jsonHasForeignTenant(privileged.json, officeB.orgId, officeB.clientId), false);
  }
});
