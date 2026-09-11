import 'dotenv/config';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../../src/shared/errors.js';
import { isSupabaseMissingTableError, isSupabaseMissingColumnError } from '../../src/shared/supabase-errors.js';
import { IL_STARTER_FACT_KEYS, IL_STARTER_FACT_SPECS } from '../../src/domains/tax-fact-dictionary/il-fact-starter-catalog.pure.js';

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function ownerEmail(): string | null {
  return process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || null;
}

function errText(error: { message?: string; details?: string; hint?: string } | null): string {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

test('TAX-F2A IL starter catalog via owner commands', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  const email = ownerEmail();
  if (!email) {
    t.skip('PLATFORM_OWNER_EMAIL not configured');
    return;
  }

  const { supabaseAdmin } = await import('../../src/db/client.js');
  const probe = await supabaseAdmin.from('tax_fact_definitions').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_fact_definitions')) {
    t.skip('Fact Dictionary schema is not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_fact_definitions probe failed: ${errText(probe.error)}`);

  const localeProbe = await supabaseAdmin.from('countries').select('code, default_locale').eq('code', 'IL').maybeSingle();
  if (localeProbe.error && isSupabaseMissingColumnError(localeProbe.error, 'default_locale')) {
    t.skip('migration 621_country_localization.sql is not applied');
    return;
  }
  if (localeProbe.error) throw new Error(`countries locale probe failed: ${errText(localeProbe.error)}`);

  const { publishIsraelStarterFactCatalog } = await import(
    '../../src/domains/tax-fact-dictionary/il-fact-starter-catalog.authoring.service.js'
  );
  const { buildOwnerFactDictionaryAggregate } = await import(
    '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-read-models.service.js'
  );
  const { executeCountryPackCommand } = await import('../../src/domains/country-pack/country-pack-commands.service.js');

  const ownerCtx = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      authUserId: '00000000-0000-0000-0000-000000000001',
      email,
      fullName: null,
      status: 'active' as const,
      uiLanguage: 'en' as const,
    },
    membership: null,
    organizationId: null,
  };

  const { error: countryErr } = await supabaseAdmin.from('countries').upsert(
    [
      { code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' },
      { code: 'US', name: 'United States', status: 'active', default_timezone: 'America/New_York' },
      { code: 'CA', name: 'Canada', status: 'active', default_timezone: 'America/Toronto' },
    ],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  await t.test('tenant professional cannot publish IL facts', async () => {
    const tenantCtx = {
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
    await assert.rejects(
      () => publishIsraelStarterFactCatalog(tenantCtx),
      (err: unknown) => err instanceof AppError && err.statusCode === 403,
    );
  });

  const published = await publishIsraelStarterFactCatalog(ownerCtx);
  assert.equal(published.length, IL_STARTER_FACT_SPECS.length);

  const il = await buildOwnerFactDictionaryAggregate(ownerCtx, { country_code: 'IL' });
  const us = await buildOwnerFactDictionaryAggregate(ownerCtx, { country_code: 'US' });

  await t.test('every created fact belongs to IL with Hebrew presentation and active version', () => {
    assert.equal(il.country_localization.default_locale, 'he');
    for (const spec of IL_STARTER_FACT_SPECS) {
      const row = il.definitions.find((item) => item.fact_key === spec.fact_key);
      assert.ok(row, spec.fact_key);
      assert.equal(row?.country_code, 'IL');
      assert.equal(row?.status, 'active');
      assert.equal(row?.versions.some((version) => version.status === 'active'), true);
      const he = row?.presentations.find((item) => item.locale === 'he');
      assert.ok(he, `${spec.fact_key} hebrew`);
      assert.equal(he?.label, spec.he_label);
      assert.equal(row?.display_label, spec.he_label);
      assert.equal(row?.display_locale, 'he');
      assert.notEqual(row?.fact_key, he?.label);
    }
  });

  await t.test('IL facts do not appear in US workspace', () => {
    for (const key of IL_STARTER_FACT_KEYS) {
      assert.equal(
        us.definitions.some((row) => row.fact_key === key && row.country_code === 'IL'),
        false,
        key,
      );
    }
  });

  await t.test('Canada can keep en+fr without changing fact identity', async () => {
    await executeCountryPackCommand(ownerCtx, {
      command: 'update_country_localization',
      payload: { country_code: 'CA', default_locale: 'en', supported_locales: ['en', 'fr'] },
    });
    const { data, error } = await supabaseAdmin
      .from('countries')
      .select('default_locale, supported_locales')
      .eq('code', 'CA')
      .single();
    if (error) throw error;
    assert.equal(data.default_locale, 'en');
    assert.deepEqual(data.supported_locales, ['en', 'fr']);
    const after = await buildOwnerFactDictionaryAggregate(ownerCtx, { country_code: 'IL' });
    assert.equal(after.definitions.find((row) => row.fact_key === 'date_of_birth')?.fact_key, 'date_of_birth');
  });
});
