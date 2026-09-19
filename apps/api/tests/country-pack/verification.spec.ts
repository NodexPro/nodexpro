import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { RequestContext } from '../../src/shared/context.js';
import {
  VERIFICATION_RESERVED_COUNTRY_CODES,
  assertCountryPackVerificationAllowed,
  disposableVerificationCountryCodes,
  formatCleanupError,
  isPermanentDevSupabaseUrl,
  nextVerificationCountryCode,
  shouldRunInFilter,
} from './verification-safety.pure.ts';

type LoadedCountryPack = {
  executeCountryPackCommand: (ctx: RequestContext, command: { command: string; payload: Record<string, unknown> }) => Promise<unknown>;
  buildOwnerLegalValuesAggregate: (ctx: RequestContext) => Promise<Record<string, unknown>>;
  buildOrganizationCountrySettingsAggregate: (ctx: RequestContext, organizationId: string) => Promise<Record<string, unknown>>;
  buildCountryPackDiagnosticsAggregate: (ctx: RequestContext, organizationId: string) => Promise<Record<string, unknown>>;
  buildActiveRulesetContextAggregate: (ctx: RequestContext, organizationId: string, date: string) => Promise<Record<string, unknown>>;
};

type SupabaseAdmin = any;

let supabaseAdminCached: SupabaseAdmin | null = null;
async function getSupabaseAdmin(): Promise<SupabaseAdmin> {
  if (supabaseAdminCached) return supabaseAdminCached;
  const db = await import('../../src/db/client.js');
  supabaseAdminCached = db.supabaseAdmin as unknown as SupabaseAdmin;
  return supabaseAdminCached;
}

async function loadCountryPack(): Promise<LoadedCountryPack> {
  process.env.PLATFORM_OWNER_EMAIL = process.env.PLATFORM_OWNER_EMAIL ?? 'platform.owner@test.local';
  const commands = await import('../../src/domains/country-pack/country-pack-commands.service.js');
  const readModels = await import('../../src/domains/country-pack/country-pack-read-models.service.js');
  return {
    executeCountryPackCommand: commands.executeCountryPackCommand,
    buildOwnerLegalValuesAggregate: readModels.buildOwnerLegalValuesAggregate,
    buildOrganizationCountrySettingsAggregate: readModels.buildOrganizationCountrySettingsAggregate,
    buildCountryPackDiagnosticsAggregate: readModels.buildCountryPackDiagnosticsAggregate,
    buildActiveRulesetContextAggregate: readModels.buildActiveRulesetContextAggregate,
  };
}

function mkCtx(params: {
  userId: string;
  email: string;
  organizationId?: string | null;
  roleCode?: string | null;
}): RequestContext {
  return {
    user: {
      id: params.userId,
      authUserId: '',
      email: params.email,
      fullName: null,
      status: 'active',
    },
    membership: params.roleCode
      ? {
          organizationId: params.organizationId ?? '',
          userId: params.userId,
          roleId: 'role-id',
          roleCode: params.roleCode,
          permissions: [],
        }
      : null,
    organizationId: params.organizationId ?? null,
  };
}

type Env = {
  marker: string;
  ownerUserId: string;
  tenantUserId: string;
  orgIl: string;
  orgUs: string;
  createdPackIds: string[];
  createdRulesetIds: string[];
  createdLegalValueIds: string[];
  createdCountryCodes: string[];
};

async function setupEnv(prefix: string): Promise<Env> {
  assertCountryPackVerificationAllowed(process.env.SUPABASE_URL);
  const supabaseAdmin = await getSupabaseAdmin();
  const marker = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const ownerUserId = randomUUID();
  const tenantUserId = randomUUID();
  const orgIl = randomUUID();
  const orgUs = randomUUID();

  await supabaseAdmin.from('users').insert([
    { id: ownerUserId, email: process.env.PLATFORM_OWNER_EMAIL!, status: 'active' },
    { id: tenantUserId, email: `${marker}-tenant@test.local`, status: 'active' },
  ]);
  await supabaseAdmin.from('organizations').insert([
    { id: orgIl, name: `${marker}-org-il`, country_code: 'IL', timezone: 'UTC', status: 'active' },
    { id: orgUs, name: `${marker}-org-us`, country_code: 'US', timezone: 'UTC', status: 'active' },
  ]);

  await supabaseAdmin.from('countries').upsert(
    [
      { code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' },
      { code: 'US', name: 'United States', status: 'active', default_timezone: 'America/New_York' },
    ],
    { onConflict: 'code' }
  );

  return {
    marker,
    ownerUserId,
    tenantUserId,
    orgIl,
    orgUs,
    createdPackIds: [],
    createdRulesetIds: [],
    createdLegalValueIds: [],
    createdCountryCodes: [],
  };
}

async function cleanupEnv(env: Env): Promise<void> {
  const supabaseAdmin = await getSupabaseAdmin();
  const errors: Error[] = [];

  async function step(
    label: string,
    run: () => Promise<{ error?: { message?: string } | null } | null | undefined>,
  ): Promise<void> {
    try {
      const result = await run();
      const formatted = formatCleanupError(label, result?.error);
      if (formatted) errors.push(formatted);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(`${label}: ${String(error)}`));
    }
  }

  if (shouldRunInFilter(env.createdLegalValueIds)) {
    await step('country_legal_value_versions', () =>
      supabaseAdmin.from('country_legal_value_versions').delete().in('legal_value_id', env.createdLegalValueIds),
    );
    await step('country_legal_values', () =>
      supabaseAdmin.from('country_legal_values').delete().in('id', env.createdLegalValueIds),
    );
  }
  if (shouldRunInFilter([env.orgIl, env.orgUs])) {
    await step('organization_country_settings', () =>
      supabaseAdmin.from('organization_country_settings').delete().in('organization_id', [env.orgIl, env.orgUs]),
    );
  }
  if (shouldRunInFilter(env.createdRulesetIds)) {
    await step('country_pack_rulesets', () =>
      supabaseAdmin.from('country_pack_rulesets').delete().in('id', env.createdRulesetIds),
    );
  }
  if (shouldRunInFilter(env.createdPackIds)) {
    await step('country_packs', () => supabaseAdmin.from('country_packs').delete().in('id', env.createdPackIds));
  }

  const disposableCountries = disposableVerificationCountryCodes(env.createdCountryCodes);
  if (shouldRunInFilter(disposableCountries)) {
    await step('countries.delete', async () => {
      const deleted = await supabaseAdmin.from('countries').delete().in('code', disposableCountries).select('code');
      if (deleted.error) return deleted;
      const remaining = await supabaseAdmin.from('countries').select('code').in('code', disposableCountries);
      if (remaining.error) return remaining;
      const leftover = (remaining.data ?? []).map((row: { code?: string }) => String(row.code ?? '')).filter(Boolean);
      if (leftover.length) {
        throw new Error(`countries still present after cleanup: ${leftover.join(',')}`);
      }
      return deleted;
    });
  }

  if (shouldRunInFilter([env.ownerUserId, env.tenantUserId])) {
    await step('audit_log', () =>
      supabaseAdmin.from('audit_log').delete().in('actor_user_id', [env.ownerUserId, env.tenantUserId]),
    );
  }
  if (shouldRunInFilter([env.orgIl, env.orgUs])) {
    await step('organizations', () => supabaseAdmin.from('organizations').delete().in('id', [env.orgIl, env.orgUs]));
  }
  if (shouldRunInFilter([env.ownerUserId, env.tenantUserId])) {
    await step('users', () => supabaseAdmin.from('users').delete().in('id', [env.ownerUserId, env.tenantUserId]));
  }

  if (errors.length) {
    throw new AggregateError(errors, 'cleanupEnv failed');
  }
}

function extractIdFromAdminAggregate(result: unknown, tableKey: 'country_packs' | 'rulesets'): string {
  const aggregate = (result as { refreshed: { aggregate: Record<string, unknown> } }).refreshed.aggregate;
  const admin = aggregate.country_packs_admin as { tables?: Record<string, Array<{ id: string }>> } | undefined;
  assert.ok(admin?.tables);
  const rows = admin.tables[tableKey];
  assert.ok(rows && rows.length > 0);
  return rows[0].id;
}

async function allocateVerificationCountryCode(unavailable: readonly string[]): Promise<string> {
  assertCountryPackVerificationAllowed(process.env.SUPABASE_URL);
  const supabaseAdmin = await getSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from('countries')
    .select('code')
    .in('code', [...VERIFICATION_RESERVED_COUNTRY_CODES]);
  if (error) throw error;
  return nextVerificationCountryCode([
    ...unavailable,
    ...((data ?? []) as Array<{ code?: string }>).map((row) => String(row.code ?? '')),
  ]);
}

test('country-pack verification suite: security, isolation, overlap, audit, resolution', async (t) => {
  if (isPermanentDevSupabaseUrl(process.env.SUPABASE_URL)) {
    t.skip('TAX-646A: refuse destructive country-pack verification against permanent DEV');
    return;
  }
  assertCountryPackVerificationAllowed(process.env.SUPABASE_URL);

  const cp = await loadCountryPack();
  const supabaseAdmin = await getSupabaseAdmin();
  const env = await setupEnv('cp-verify');

  const ownerCtx = mkCtx({ userId: env.ownerUserId, email: process.env.PLATFORM_OWNER_EMAIL! });
  const tenantOwnerCtx = mkCtx({
    userId: env.tenantUserId,
    email: process.env.PLATFORM_OWNER_EMAIL!,
    organizationId: env.orgIl,
    roleCode: 'owner',
  });
  const tenantAdminCtx = mkCtx({
    userId: env.tenantUserId,
    email: process.env.PLATFORM_OWNER_EMAIL!,
    organizationId: env.orgIl,
    roleCode: 'admin',
  });
  const tenantStaffCtx = mkCtx({
    userId: env.tenantUserId,
    email: process.env.PLATFORM_OWNER_EMAIL!,
    organizationId: env.orgIl,
    roleCode: 'staff',
  });
  const tenantViewerCtx = mkCtx({
    userId: env.tenantUserId,
    email: process.env.PLATFORM_OWNER_EMAIL!,
    organizationId: env.orgIl,
    roleCode: 'viewer',
  });
  const tenantOrgIlCtx = mkCtx({
    userId: env.tenantUserId,
    email: `${env.marker}-tenant@test.local`,
    organizationId: env.orgIl,
    roleCode: 'owner',
  });
  const tenantOrgUsCtx = mkCtx({
    userId: env.tenantUserId,
    email: `${env.marker}-tenant@test.local`,
    organizationId: env.orgUs,
    roleCode: 'owner',
  });

  try {
    // 1) Platform owner access + denied tenant roles
    const ownerCreateCountryCode = await allocateVerificationCountryCode(env.createdCountryCodes);
    env.createdCountryCodes.push(ownerCreateCountryCode);
    await assert.doesNotReject(() =>
      cp.executeCountryPackCommand(ownerCtx, {
        command: 'create_country',
        payload: { code: ownerCreateCountryCode, name: `${env.marker}-country`, status: 'active' },
      })
    );

    await assert.rejects(
      () =>
        cp.executeCountryPackCommand(tenantOwnerCtx, {
          command: 'create_legal_value',
          payload: {
            country_code: 'IL',
            value_key: `${env.marker}_vat_rate`,
            label: 'VAT',
            category: 'VAT',
            module_scope: 'module:tax',
            value_type: 'percentage',
            status: 'draft',
          },
        }),
      /Platform owner/i
    );
    await assert.rejects(() => cp.buildOwnerLegalValuesAggregate(tenantAdminCtx), /Platform owner/i);
    await assert.rejects(() => cp.buildOwnerLegalValuesAggregate(tenantStaffCtx), /Platform owner/i);
    await assert.rejects(() => cp.buildOwnerLegalValuesAggregate(tenantViewerCtx), /Platform owner/i);

    // 2) Owner aggregate isolation
    const ownerLegalAggregate = await cp.buildOwnerLegalValuesAggregate(ownerCtx);
    assert.equal(ownerLegalAggregate.aggregate_key, 'owner_legal_values_aggregate');
    assert.ok(!JSON.stringify(ownerLegalAggregate).includes('client_id'));
    assert.ok(!JSON.stringify(ownerLegalAggregate).includes('tax_id'));

    // 3) Country eligibility + disabled pack
    const packCreateRes = await cp.executeCountryPackCommand(ownerCtx, {
      command: 'create_country_pack',
      payload: {
        country_code: 'IL',
        pack_code: `${env.marker}_il_pack`,
        name: `${env.marker} IL Pack`,
        status: 'enabled',
        framework_version: '1.0.0',
        code_version: '1.0.0',
      },
    });
    const ilPackId = extractIdFromAdminAggregate(packCreateRes, 'country_packs');
    env.createdPackIds.push(ilPackId);

    const disabledPackRes = await cp.executeCountryPackCommand(ownerCtx, {
      command: 'create_country_pack',
      payload: {
        country_code: 'IL',
        pack_code: `${env.marker}_il_pack_disabled`,
        name: `${env.marker} IL Disabled`,
        status: 'disabled',
        framework_version: '1.0.0',
        code_version: '1.0.0',
      },
    });
    const disabledPackId = extractIdFromAdminAggregate(disabledPackRes, 'country_packs');
    env.createdPackIds.push(disabledPackId);

    // assign requires an active ruleset for effective date
    await assert.rejects(
      () =>
        cp.executeCountryPackCommand(ownerCtx, {
          command: 'assign_country_pack_to_organization',
          payload: { organization_id: env.orgIl, country_pack_id: ilPackId, effective_date: '2025-01-01' },
        }),
      /active ruleset/i
    );

    await assert.rejects(
      () =>
        cp.executeCountryPackCommand(ownerCtx, {
          command: 'assign_country_pack_to_organization',
          payload: { organization_id: env.orgIl, country_pack_id: ilPackId, effective_date: '2026-07-01' },
        }),
      /active ruleset/i
    );

    await assert.rejects(
      () =>
        cp.executeCountryPackCommand(ownerCtx, {
          command: 'assign_country_pack_to_organization',
          payload: { organization_id: env.orgUs, country_pack_id: ilPackId, effective_date: '2026-07-01' },
        }),
      /eligible/i
    );

    await assert.rejects(
      () =>
        cp.executeCountryPackCommand(ownerCtx, {
          command: 'assign_country_pack_to_organization',
          payload: { organization_id: env.orgIl, country_pack_id: disabledPackId, effective_date: '2026-07-01' },
        }),
      /Disabled pack/i
    );

    // 4) Ruleset overlap
    const firstRuleset = await cp.executeCountryPackCommand(ownerCtx, {
      command: 'create_ruleset',
      payload: {
        country_pack_id: ilPackId,
        ruleset_code: `${env.marker}_rs_1`,
        ruleset_version: '1',
        effective_from: '2026-01-01',
        effective_to: '2026-12-31',
        status: 'active',
      },
    });
    const ruleset1Id = extractIdFromAdminAggregate(firstRuleset, 'rulesets');
    env.createdRulesetIds.push(ruleset1Id);

    await assert.rejects(
      () =>
        cp.executeCountryPackCommand(ownerCtx, {
          command: 'create_ruleset',
          payload: {
            country_pack_id: ilPackId,
            ruleset_code: `${env.marker}_rs_overlap`,
            ruleset_version: '2',
            effective_from: '2026-06-01',
            effective_to: '2027-01-01',
            status: 'active',
          },
        }),
      /overlap/i
    );

    const nonOverlapRuleset = await cp.executeCountryPackCommand(ownerCtx, {
      command: 'create_ruleset',
      payload: {
        country_pack_id: ilPackId,
        ruleset_code: `${env.marker}_rs_2`,
        ruleset_version: '3',
        effective_from: '2027-01-01',
        effective_to: null,
        status: 'active',
      },
    });
    const ruleset2Id = extractIdFromAdminAggregate(nonOverlapRuleset, 'rulesets');
    env.createdRulesetIds.push(ruleset2Id);

    await assert.doesNotReject(() =>
      cp.executeCountryPackCommand(ownerCtx, {
        command: 'assign_country_pack_to_organization',
        payload: { organization_id: env.orgIl, country_pack_id: ilPackId, effective_date: '2026-07-01' },
      })
    );

    // 5) Legal value version overlap
    const createLv = await cp.executeCountryPackCommand(ownerCtx, {
      command: 'create_legal_value',
      payload: {
        country_code: 'IL',
        value_key: `${env.marker}_vat_rate`,
        label: 'VAT Rate',
        category: 'VAT',
        module_scope: 'module:tax',
        value_type: 'percentage',
        status: 'active',
      },
    });
    const panelAgg = (createLv as { refreshed: { aggregate: Record<string, unknown> } }).refreshed.aggregate;
    const lvNested = panelAgg.legal_values as { table?: Array<{ id: string; value_key: string }> } | undefined;
    const legalValue = (lvNested?.table ?? []).find((x) => x.value_key === `${env.marker}_vat_rate`);
    assert.ok(legalValue?.id);
    env.createdLegalValueIds.push(legalValue!.id);

    await assert.doesNotReject(() =>
      cp.executeCountryPackCommand(ownerCtx, {
        command: 'create_legal_value_version',
        payload: {
          country_code: 'IL',
          value_key: `${env.marker}_vat_rate`,
          country_pack_ruleset_id: ruleset1Id,
          value_payload_json: { rate: 17 },
          effective_from: '2026-01-01',
          effective_to: '2026-12-31',
          status: 'active',
        },
      })
    );

    await assert.rejects(
      () =>
        cp.executeCountryPackCommand(ownerCtx, {
          command: 'create_legal_value_version',
          payload: {
            country_code: 'IL',
            value_key: `${env.marker}_vat_rate`,
            country_pack_ruleset_id: ruleset1Id,
            value_payload_json: { rate: 18 },
            effective_from: '2026-06-01',
            effective_to: '2026-12-31',
            status: 'active',
          },
        }),
      /overlap/i
    );

    await assert.doesNotReject(() =>
      cp.executeCountryPackCommand(ownerCtx, {
        command: 'create_legal_value_version',
        payload: {
          country_code: 'IL',
          value_key: `${env.marker}_vat_rate`,
          country_pack_ruleset_id: ruleset2Id,
          value_payload_json: { rate: 19 },
          effective_from: '2027-01-01',
          effective_to: null,
          status: 'active',
        },
      })
    );

    // 6) Active ruleset resolution + controlled warning on missing ruleset
    const ctx2026 = await cp.buildActiveRulesetContextAggregate(tenantOrgIlCtx, env.orgIl, '2026-07-01');
    assert.equal(ctx2026.active_ruleset, ruleset1Id);

    const ctxNoRuleset = await cp.buildActiveRulesetContextAggregate(tenantOrgIlCtx, env.orgIl, '2025-01-01');
    assert.equal(ctxNoRuleset.active_ruleset, null);
    assert.ok(Array.isArray(ctxNoRuleset.warnings));
    assert.ok((ctxNoRuleset.warnings as unknown[]).length > 0);

    // 7) Tenant isolation across org
    await assert.rejects(
      () => cp.buildOrganizationCountrySettingsAggregate(tenantOrgUsCtx, env.orgIl),
      /denied/i
    );
    await assert.rejects(
      () => cp.buildCountryPackDiagnosticsAggregate(tenantOrgUsCtx, env.orgIl),
      /denied/i
    );
    await assert.rejects(
      () => cp.buildActiveRulesetContextAggregate(tenantOrgUsCtx, env.orgIl, '2026-07-01'),
      /denied/i
    );

    // 8) Audit verification
    await cp.executeCountryPackCommand(ownerCtx, {
      command: 'activate_ruleset',
      payload: { ruleset_id: ruleset2Id },
    });
    await cp.executeCountryPackCommand(ownerCtx, {
      command: 'update_owner_note',
      payload: { country_code: 'IL', value_key: `${env.marker}_vat_rate`, owner_note: 'owner note test' },
    });
    await cp.executeCountryPackCommand(ownerCtx, {
      command: 'activate_legal_value_version',
      payload: { legal_value_version_id: (await supabaseAdmin.from('country_legal_value_versions').select('id').eq('legal_value_id', legalValue!.id).order('created_at', { ascending: false }).limit(1).single()).data?.id },
    });

    // failed owner security check
    await assert.rejects(
      () =>
        cp.executeCountryPackCommand(tenantOrgIlCtx, {
          command: 'create_country',
          payload: { code: 'ZY', name: 'Denied country', status: 'active' },
        }),
      /Platform owner/i
    );

    const { data: auditRows, error: auditError } = await supabaseAdmin
      .from('audit_log')
      .select('action')
      .in('actor_user_id', [env.ownerUserId, env.tenantUserId]);
    if (auditError) throw auditError;
    const actions = new Set((auditRows ?? []).map((r) => r.action));
    assert.ok(actions.has('organization_country_pack_assigned'));
    assert.ok(actions.has('ruleset_activated'));
    assert.ok(actions.has('legal_value_created'));
    assert.ok(actions.has('legal_value_version_activated'));
    assert.ok(actions.has('owner_note_updated'));
    assert.ok(actions.has('owner_security_check_failed'));
  } finally {
    await cleanupEnv(env);
  }
});

