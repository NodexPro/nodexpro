/**
 * Disposable Office A/B bootstrap against confirmed staging only.
 * Refuses production project ttysmceteiknzputejvc.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const STAGING_HOST = 'kabefnmcyhughnyvoxiw.supabase.co';
const PRODUCTION_HOST = 'ttysmceteiknzputejvc.supabase.co';

const url = (process.env.SUPABASE_URL ?? '').trim();
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const anonKey = (process.env.SUPABASE_ANON_KEY ?? '').trim();
let host = '';
try {
  host = new URL(url).host;
} catch {
  host = '';
}

if (!url || !serviceKey || !anonKey) {
  console.error('BLOCKED: staging SUPABASE_URL / keys missing');
  process.exit(2);
}
if (host === PRODUCTION_HOST) {
  console.error('BLOCKED: refused production Supabase');
  process.exit(2);
}
if (host !== STAGING_HOST) {
  console.error(`BLOCKED: unexpected host ${host}`);
  process.exit(2);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

function requireData<T>(label: string, data: T | null, error: { message?: string } | null): T {
  if (error || !data) throw new Error(`${label}: ${error?.message ?? 'empty'}`);
  return data;
}

async function main() {
  const orgs = await admin.from('organizations').select('id', { count: 'exact', head: true });
  const roles = await admin.from('roles').select('id, code');
  const roleCodes = (roles.data ?? []).map((r) => String((r as { code?: string }).code)).filter(Boolean);
  console.log(
    JSON.stringify({
      host,
      org_count: orgs.count ?? 0,
      roles: roleCodes,
      legal_salt_default: !process.env.LEGAL_IDENTITY_HASH_SALT,
    }),
  );
  if (roles.error) throw new Error(`roles: ${roles.error.message}`);
  if (!roleCodes.includes('owner') && !roleCodes.includes('admin')) {
    throw new Error('staging roles table has no owner/admin — cannot bootstrap offices');
  }

  const stamp = `${Date.now()}`;
  const password = `NxIt!${randomBytes(12).toString('base64url')}`;
  const offices = [
    { key: 'A', email: `stage6.office.a.${stamp}@example.com`, name: `STAGE6-IT Office A ${stamp}` },
    { key: 'B', email: `stage6.office.b.${stamp}@example.com`, name: `STAGE6-IT Office B ${stamp}` },
  ] as const;

  const created: Record<string, { email: string; orgId: string; clientId: string; token: string; userId: string }> = {};

  for (const office of offices) {
    const createdAuth = await admin.auth.admin.createUser({
      email: office.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: office.name },
    });
    const authUser = requireData(`auth ${office.key}`, createdAuth.data.user ?? null, createdAuth.error);
    const { ensureAppUser } = await import('../src/domains/auth/auth.service.js');
    const { createOrganization } = await import('../src/domains/organizations/organizations.service.js');
    const { createClient: createOrgClient } = await import('../src/domains/clients/clients.service.js');

    const appUserId = await ensureAppUser(authUser.id, office.email, office.name);
    if (!appUserId) throw new Error(`ensureAppUser ${office.key} failed`);

    const ctx = {
      user: {
        id: appUserId,
        authUserId: authUser.id,
        email: office.email,
        fullName: office.name,
        status: 'active',
      },
      membership: {
        organizationId: '',
        userId: appUserId,
        roleId: '',
        roleCode: 'owner',
        permissions: ['clients:write', 'edit_clients'],
      },
      organizationId: '',
    };

    const org = await createOrganization(ctx, {
      name: office.name,
      countryCode: 'IL',
      timezone: 'Asia/Jerusalem',
    });
    const orgId = String((org as { organization?: { id?: string }; id?: string }).organization?.id ?? (org as { id?: string }).id ?? '');
    if (!orgId) throw new Error(`createOrganization ${office.key} returned no id`);

    ctx.organizationId = orgId;
    ctx.membership.organizationId = orgId;

    let clientId = '';
    try {
      const client = await createOrgClient(ctx, orgId, {
        tax_id: `${stamp}${office.key === 'A' ? '01' : '02'}`.slice(0, 15),
        client_type: 'business_customer',
        display_name: `STAGE6-IT Client ${office.key} ${stamp}`,
        email: `client.${office.key}.${stamp}@example.com`,
      });
      clientId = String((client as { id?: string }).id ?? '');
    } catch (err) {
      const inserted = await admin
        .from('clients')
        .insert({
          organization_id: orgId,
          tax_id: `${stamp}${office.key === 'A' ? '01' : '02'}`.slice(0, 15),
          client_type: 'business_customer',
          display_name: `STAGE6-IT Client ${office.key} ${stamp}`,
          email: `client.${office.key}.${stamp}@example.com`,
          created_by: appUserId,
          status: 'active',
          lifecycle_state: 'lead',
        })
        .select('id')
        .single();
      if (inserted.error || !inserted.data) {
        throw new Error(`client ${office.key}: ${String(err)} / ${inserted.error?.message ?? 'insert failed'}`);
      }
      clientId = String(inserted.data.id);
    }

    const signed = await anon.auth.signInWithPassword({ email: office.email, password });
    const token = signed.data.session?.access_token;
    if (signed.error || !token) throw new Error(`login ${office.key}: ${signed.error?.message ?? 'no token'}`);

    created[office.key] = { email: office.email, orgId, clientId, token, userId: appUserId };
  }

  const employeeEmail = `stage6.emp.a.${stamp}@example.com`;
  const empAuth = await admin.auth.admin.createUser({
    email: employeeEmail,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'STAGE6-IT Employee A' },
  });
  const empUser = requireData('auth employee', empAuth.data.user ?? null, empAuth.error);
  const { ensureAppUser } = await import('../src/domains/auth/auth.service.js');
  const empAppUserId = await ensureAppUser(empUser.id, employeeEmail, 'STAGE6-IT Employee A');
  if (!empAppUserId) throw new Error('employee ensureAppUser failed');
  const now = new Date().toISOString();
  const empRole = (roles.data ?? []).find((r) => String((r as { code?: string }).code) === 'employee') as { id?: string } | undefined;
  await admin.from('organization_memberships').insert({
    organization_id: created.A.orgId,
    user_id: empAppUserId,
    role_code: 'employee',
    status: 'active',
    joined_at: now,
    created_at: now,
    updated_at: now,
  });
  if (empRole?.id) {
    await admin.from('organization_users').insert({
      organization_id: created.A.orgId,
      user_id: empAppUserId,
      role_id: empRole.id,
      membership_status: 'active',
    });
  }
  const empSigned = await anon.auth.signInWithPassword({ email: employeeEmail, password });
  const empToken = empSigned.data.session?.access_token ?? '';

  const out = {
    host,
    stamp,
    officeA: { orgId: created.A.orgId, clientId: created.A.clientId, userId: created.A.userId, email: created.A.email },
    officeB: { orgId: created.B.orgId, clientId: created.B.clientId, userId: created.B.userId, email: created.B.email },
    employeeA: { userId: empAppUserId, email: employeeEmail, hasToken: Boolean(empToken) },
  };

  const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '..', '.stage6-isolation-fixtures.json');
  writeFileSync(
    fixturePath,
    JSON.stringify(
      {
        ...out,
        tokens: {
          A: created.A.token,
          B: created.B.token,
          employeeA: empToken,
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(JSON.stringify({ ok: true, fixture: '.stage6-isolation-fixtures.json', ...out }));
}

main().catch((error) => {
  console.error(String(error?.stack ?? error));
  process.exit(1);
});
