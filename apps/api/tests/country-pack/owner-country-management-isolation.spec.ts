import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../src/shared/errors.js';
import { executeCountryPackCommand } from '../../src/domains/country-pack/country-pack-commands.service.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function tenantCtx() {
  return {
    user: {
      id: '00000000-0000-0000-0000-000000000099',
      authUserId: '00000000-0000-0000-0000-000000000099',
      email: 'tenant@example.com',
      fullName: null,
      status: 'active' as const,
      uiLanguage: 'en' as const,
    },
    membership: {
      organizationId: '00000000-0000-0000-0000-000000000088',
      userId: '00000000-0000-0000-0000-000000000099',
      roleId: 'r',
      roleCode: 'admin',
      permissions: ['*'],
    },
    organizationId: '00000000-0000-0000-0000-000000000088',
  };
}

test('create_country inserts only an empty countries row and does not copy legal data', () => {
  const src = readRepo('apps/api/src/domains/country-pack/country-pack-commands.service.ts');
  const start = src.indexOf('async function handleCreateCountry');
  const end = src.indexOf('async function handleCreateCountryPack');
  assert.ok(start >= 0 && end > start);
  const fn = src.slice(start, end);
  assert.match(fn, /\.from\('countries'\)/);
  assert.match(fn, /\.insert\(insertRow\)/);
  assert.match(fn, /default_timezone: defaultTimezone/);
  assert.match(fn, /default_locale: localization.default_locale/);
  assert.doesNotMatch(fn, /\.from\('country_packs'\)/);
  assert.doesNotMatch(fn, /\.from\('country_pack_rulesets'\)/);
  assert.doesNotMatch(fn, /\.from\('country_legal/);
  assert.doesNotMatch(fn, /\.from\('tax_/);
  assert.doesNotMatch(fn, /copy|clone|duplicate|fromCountry|source_country/i);
  assert.match(fn, /refreshedOwnerLegalControlPanel\(ctx\)/);
});

test('disable_country only flips countries.status and does not delete law or country rows', () => {
  const src = readRepo('apps/api/src/domains/country-pack/country-pack-commands.service.ts');
  const start = src.indexOf('async function handleSetCountryStatus');
  const end = src.indexOf('async function handleCreateCountryPack');
  assert.ok(start >= 0 && end > start);
  const fn = src.slice(start, end);
  assert.match(fn, /\.from\('countries'\)/);
  assert.match(fn, /\.update\(\{ status \}\)/);
  assert.doesNotMatch(fn, /\.delete\(/);
  assert.doesNotMatch(fn, /\.from\('country_packs'\)/);
  assert.doesNotMatch(fn, /\.from\('tax_/);
  assert.doesNotMatch(fn, /\.from\('country_legal/);
  assert.match(fn, /refreshedOwnerLegalControlPanel\(ctx\)/);
});

test('create_country and owner legal-control reads require platform owner, not tenant professionals', async (t) => {
  const commands = readRepo('apps/api/src/domains/country-pack/country-pack-commands.service.ts');
  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  const owner = readRepo('apps/api/src/shared/platform-owner.ts');
  assert.match(commands, /assertPlatformOwner\(ctx\)/);
  assert.match(routes, /assertOwnerOrAuditFailure/);
  assert.match(owner, /PLATFORM_OWNER_REQUIRED/);
  assert.match(owner, /PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN/);

  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  await assert.rejects(
    () =>
      executeCountryPackCommand(tenantCtx(), {
        command: 'create_country',
        payload: { code: 'ZZ', name: 'Denied' },
      }),
    (err: unknown) =>
      err instanceof AppError &&
      err.statusCode === 403 &&
      (err.code === 'PLATFORM_OWNER_REQUIRED' ||
        err.code === 'PLATFORM_OWNER_NOT_CONFIGURED' ||
        err.code === 'PLATFORM_OWNER_TENANT_CONTEXT_FORBIDDEN'),
  );
});

test('country pack legal commands stay country-scoped in source', () => {
  const src = readRepo('apps/api/src/domains/country-pack/country-pack-commands.service.ts');
  const packStart = src.indexOf('async function handleCreateCountryPack');
  const packFn = src.slice(packStart, src.indexOf('async function handleEnableDisablePack'));
  assert.match(packFn, /country_code: countryCode/);
  assert.match(packFn, /assertCountryExists\(countryCode\)/);
  assert.doesNotMatch(packFn, /copyFrom|clonePack|source_pack/i);
});
