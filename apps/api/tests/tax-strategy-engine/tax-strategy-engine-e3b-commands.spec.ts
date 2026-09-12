import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTaxKnowledgeCommand } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import {
  TAX_STRATEGY_ENGINE_COMMANDS,
  isTaxStrategyEngineCommand,
} from '../../src/domains/tax-strategy-engine/tax-strategy-engine-commands.types.js';
import { taxStrategyChecksumFromDraftState } from '../../src/domains/tax-strategy-engine/tax-strategy-engine-checksum.pure.js';
import { AppError } from '../../src/shared/errors.js';
import { isSupabaseMissingTableError } from '../../src/shared/supabase-errors.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const E3B_COMMANDS = [
  'create_tax_strategy',
  'update_tax_strategy_metadata',
  'create_tax_strategy_exclusive_group',
  'update_tax_strategy_exclusive_group',
  'create_tax_strategy_version',
  'update_tax_strategy_version_draft',
  'activate_tax_strategy_version',
  'retire_tax_strategy_version',
  'close_tax_strategy_version_effective_to',
  'supersede_tax_strategy_version',
  'pin_tax_strategy_rule',
  'unpin_tax_strategy_rule',
  'pin_tax_strategy_calculation',
  'unpin_tax_strategy_calculation',
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function ownerEmail(): string | null {
  return process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || null;
}

function errText(error: { message?: string; code?: string; details?: string; hint?: string } | null): string {
  return [error?.code, error?.message, error?.details, error?.hint].filter(Boolean).join(' | ');
}

function strategySlice(aggregate: Record<string, unknown>): Record<string, unknown> {
  const slice = aggregate.strategy_engine;
  assert.ok(slice && typeof slice === 'object' && !Array.isArray(slice));
  return slice as Record<string, unknown>;
}

test('TAX-E3B contract: every command is recognized on the Strategy Engine dispatcher', () => {
  assert.deepEqual([...TAX_STRATEGY_ENGINE_COMMANDS], [...E3B_COMMANDS]);
  for (const command of E3B_COMMANDS) {
    assert.equal(isTaxStrategyEngineCommand(command), true, command);
    assert.equal(isTaxKnowledgeCommand(command), false, command);
  }
  assert.equal(isTaxStrategyEngineCommand('evaluate_tax_strategies'), false);
  assert.equal(isTaxStrategyEngineCommand('create_tax_rule'), false);

  const commandsSrc = readRepo(
    'apps/api/src/domains/tax-strategy-engine/owner-write/tax-strategy-engine-commands.service.ts',
  );
  assert.match(commandsSrc, /export async function executeTaxStrategyEngineCommand/);
  assert.match(commandsSrc, /assertOwnerLegalCommandAccess\(ctx, command, payload\)/);
  for (const command of E3B_COMMANDS) {
    assert.match(commandsSrc, new RegExp(`case '${command}':`));
  }

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /router\.post\('\/command'/);
  assert.match(routes, /isTaxStrategyEngineCommand\(commandName\)/);
  assert.match(routes, /executeTaxStrategyEngineCommand/);
  assert.doesNotMatch(routes, /router\.get\('\/strategy-engine'/);
  assert.doesNotMatch(routes, /router\.post\('\/strategy/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);

  const tkTypes = readRepo('apps/api/src/domains/tax-knowledge/tax-knowledge.types.ts');
  assert.doesNotMatch(tkTypes, /create_tax_strategy|pin_tax_strategy_rule/);
});

test('TAX-E3B contract: checksum, RPC, audit, and full aggregate refresh', () => {
  const commandsSrc = readRepo(
    'apps/api/src/domains/tax-strategy-engine/owner-write/tax-strategy-engine-commands.service.ts',
  );
  assert.match(commandsSrc, /taxStrategyChecksumFromDraftState/);
  assert.doesNotMatch(commandsSrc, /taxRulePayloadChecksum/);
  assert.match(commandsSrc, /persistDraftChecksum/);
  assert.match(commandsSrc, /rpc\('tax_strategy_engine_supersede_tax_strategy_version'/);
  assert.match(commandsSrc, /p_new_tax_strategy_version_id/);
  assert.match(commandsSrc, /p_old_tax_strategy_version_id/);
  const supersedeSrc = commandsSrc.slice(commandsSrc.indexOf('async function handleSupersedeTaxStrategyVersion'));
  assert.match(supersedeSrc, /rpc\('tax_strategy_engine_supersede_tax_strategy_version'/);
  assert.doesNotMatch(supersedeSrc.slice(0, 3500), /\.update\(/);
  assert.match(commandsSrc, /buildOwnerLegalControlPanelAggregate/);
  assert.match(commandsSrc, /strategy_engine_country_code/);
  assert.match(commandsSrc, /organizationId:\s*null/);
  assert.match(commandsSrc, /writeAudit/);
  assert.match(commandsSrc, /'tax_strategy'/);
  assert.match(commandsSrc, /'tax_strategy_exclusive_group'/);
  assert.match(commandsSrc, /'tax_strategy_version'/);
  assert.match(commandsSrc, /'tax_strategy_version_rule_pin'/);
  assert.match(commandsSrc, /'tax_strategy_version_calculation_pin'/);
  assert.doesNotMatch(commandsSrc, /latest_version|resolveLatest|current_active/);
  assert.doesNotMatch(commandsSrc, /evaluateTaxStrategies|evaluateTaxRules|evaluateTaxCalculation/);
  assert.doesNotMatch(commandsSrc, /work-engine|accounting-base|income-document-draft/);
  assert.doesNotMatch(commandsSrc, /organization_id|client_id|case_id/);

  const auditSrc = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(auditSrc, /TAX_STRATEGY_CREATED:\s*'tax_strategy_created'/);
  assert.match(auditSrc, /TAX_STRATEGY_VERSION_SUPERSEDED:\s*'tax_strategy_version_superseded'/);
  assert.match(auditSrc, /TAX_STRATEGY_RULE_PINNED:\s*'tax_strategy_rule_pinned'/);
});

test('TAX-E3B isolation: no 613, 612 untouched, no new endpoint, no tenant fields', () => {
  const frozen = execSync('git diff -- supabase/migrations/612_tax_strategy_engine_foundation.sql', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  assert.equal(frozen, '', 'migration 612 must remain unchanged');
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_foundation.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/613_tax_strategy_engine_commands.sql')), false);

  const extra = execSync('git diff --name-only -- supabase/migrations', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => !name.includes('624_knowledge_trainer_ingestion_foundation.sql'));
  assert.deepEqual(extra, []);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /router\.get\('\/legal-control'/);
  assert.equal((routes.match(/router\.get\(/g) ?? []).length >= 1, true);

  const writeSrc = readRepo(
    'apps/api/src/domains/tax-strategy-engine/owner-write/tax-strategy-engine-commands.service.ts',
  );
  assert.doesNotMatch(writeSrc, /organization_id/);
  assert.doesNotMatch(writeSrc, /client_id/);
  assert.doesNotMatch(writeSrc, /case_id/);
});

test('TAX-E3B checksum helper recomputes from persisted pin roles', () => {
  const empty = taxStrategyChecksumFromDraftState({
    country_code: 'IL',
    title: 'Draft',
    requires_professional_judgment: false,
    exclusive_group_id: null,
    authored_metadata_json: { explanation: 'x' },
    rule_pins: [],
    calculation_pins: [],
  });
  const withRule = taxStrategyChecksumFromDraftState({
    country_code: 'IL',
    title: 'Draft',
    requires_professional_judgment: false,
    exclusive_group_id: null,
    authored_metadata_json: { explanation: 'x' },
    rule_pins: [{ pin_role: 'required', tax_rule_version_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    calculation_pins: [],
  });
  const withCalc = taxStrategyChecksumFromDraftState({
    country_code: 'IL',
    title: 'Draft',
    requires_professional_judgment: false,
    exclusive_group_id: null,
    authored_metadata_json: { explanation: 'x' },
    rule_pins: [],
    calculation_pins: [{ calculation_definition_version_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }],
  });
  assert.match(empty, /^[0-9a-f]{64}$/);
  assert.notEqual(empty, withRule);
  assert.notEqual(empty, withCalc);
  assert.notEqual(withRule, withCalc);
});

test('TAX-E3B allowed_actions map only to implemented handlers', () => {
  const helpers = readRepo('apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-read-models.pure.ts');
  const writeSrc = readRepo(
    'apps/api/src/domains/tax-strategy-engine/owner-write/tax-strategy-engine-commands.service.ts',
  );
  for (const command of E3B_COMMANDS) {
    assert.match(helpers, new RegExp(`'${command}'`));
    assert.match(writeSrc, new RegExp(`case '${command}':`));
  }
  assert.doesNotMatch(helpers, /pin_tax_strategy_version_rule|unpin_tax_strategy_version_rule/);
  assert.doesNotMatch(helpers, /allowed_actions:\s*\[\]/);
});

test('TAX-E3B commands require Platform Owner', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }

  const { executeTaxStrategyEngineCommand } = await import(
    '../../src/domains/tax-strategy-engine/owner-write/tax-strategy-engine-commands.service.js'
  );

  const tenantCtx = {
    user: {
      id: '00000000-0000-0000-0000-000000000099',
      authUserId: '00000000-0000-0000-0000-000000000099',
      email: 'tenant@example.com',
      fullName: null,
      status: 'active',
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
    () =>
      executeTaxStrategyEngineCommand(tenantCtx, 'create_tax_strategy', {
        country_code: 'IL',
        strategy_code: 'blocked',
      }),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );

  const email = ownerEmail();
  if (!email) {
    return;
  }
  const ownerCtx = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      authUserId: '00000000-0000-0000-0000-000000000001',
      email,
      fullName: null,
      status: 'active',
      uiLanguage: 'en' as const,
    },
    membership: null,
    organizationId: null,
  };
  await assert.rejects(
    () => executeTaxStrategyEngineCommand(ownerCtx, 'evaluate_tax_strategies', { country_code: 'IL' }),
    (err: unknown) => err instanceof AppError && err.statusCode === 400,
  );
});

test('TAX-E3B live: identity, group, draft, checksum, activate, close, retire, supersede, pins', async (t) => {
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
  const probe = await supabaseAdmin.from('tax_strategies').select('id').limit(1);
  if (probe.error && isSupabaseMissingTableError(probe.error, 'tax_strategies')) {
    t.skip('migration 612 not applied');
    return;
  }
  if (probe.error) throw new Error(`tax_strategies probe failed: ${errText(probe.error)}`);

  const { executeTaxStrategyEngineCommand } = await import(
    '../../src/domains/tax-strategy-engine/owner-write/tax-strategy-engine-commands.service.js'
  );

  const marker = `e3b-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ownerCtx = {
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      authUserId: '00000000-0000-0000-0000-000000000001',
      email,
      fullName: null,
      status: 'active',
      uiLanguage: 'en' as const,
    },
    membership: null,
    organizationId: null,
  };

  const { error: countryErr } = await supabaseAdmin.from('countries').upsert(
    [{ code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem' }],
    { onConflict: 'code' },
  );
  if (countryErr) throw new Error(`countries upsert failed: ${errText(countryErr)}`);

  const created = await executeTaxStrategyEngineCommand(ownerCtx, 'create_tax_strategy', {
    country_code: 'IL',
    strategy_code: marker,
    admin_label: 'E3B probe',
    owner_note: 'create',
  });
  assert.equal(created.ok, true);
  assert.equal(created.command, 'create_tax_strategy');
  assert.equal(created.refreshed.aggregate_key, 'owner_legal_control_panel_aggregate');
  const createdSlice = strategySlice(created.refreshed.aggregate);
  assert.equal('organization_id' in createdSlice, false);
  assert.equal('client_id' in createdSlice, false);
  assert.equal('case_id' in createdSlice, false);
  const strategies = createdSlice.strategies as Array<Record<string, unknown>>;
  const identity = strategies.find((row) => row.strategy_code === marker);
  assert.ok(identity);
  const strategyId = String(identity.id);
  assert.deepEqual(
    (identity.allowed_actions as Array<{ action_key: string }>).map((row) => row.action_key),
    ['update_tax_strategy_metadata', 'create_tax_strategy_version'],
  );

  const { data: createAudit } = await supabaseAdmin
    .from('audit_log')
    .select('entity_type, action')
    .eq('entity_id', strategyId)
    .eq('action', 'tax_strategy_created')
    .order('created_at', { ascending: false })
    .limit(1);
  assert.equal(createAudit?.[0]?.entity_type, 'tax_strategy');

  const updated = await executeTaxStrategyEngineCommand(ownerCtx, 'update_tax_strategy_metadata', {
    tax_strategy_id: strategyId,
    admin_label: 'E3B renamed',
    owner_note: 'updated',
  });
  const updatedIdentity = (strategySlice(updated.refreshed.aggregate).strategies as Array<Record<string, unknown>>).find(
    (row) => row.id === strategyId,
  );
  assert.equal(updatedIdentity?.admin_label, 'E3B renamed');

  const groupOut = await executeTaxStrategyEngineCommand(ownerCtx, 'create_tax_strategy_exclusive_group', {
    country_code: 'IL',
    group_code: marker,
    title: 'E3B group',
    owner_note: 'group create',
  });
  const groups = strategySlice(groupOut.refreshed.aggregate).exclusive_groups as Array<Record<string, unknown>>;
  const group = groups.find((row) => row.group_code === marker);
  assert.ok(group);
  const groupId = String(group.id);
  await executeTaxStrategyEngineCommand(ownerCtx, 'update_tax_strategy_exclusive_group', {
    tax_strategy_exclusive_group_id: groupId,
    title: 'E3B group updated',
  });

  const versionOut = await executeTaxStrategyEngineCommand(ownerCtx, 'create_tax_strategy_version', {
    tax_strategy_id: strategyId,
    effective_from: '2020-01-01',
    title: 'E3B draft v1',
    requires_professional_judgment: false,
    exclusive_group_id: groupId,
    authored_metadata_json: { explanation: 'first draft' },
  });
  const versions = strategySlice(versionOut.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>;
  const draft = versions.find((row) => row.tax_strategy_id === strategyId && row.version_no === 1);
  assert.ok(draft);
  assert.equal(draft.status, 'draft');
  const versionId = String(draft.id);
  const initialChecksum = String(draft.strategy_checksum);
  assert.match(initialChecksum, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    (draft.allowed_actions as Array<{ action_key: string }>).map((row) => row.action_key),
    [
      'update_tax_strategy_version_draft',
      'pin_tax_strategy_rule',
      'pin_tax_strategy_calculation',
      'activate_tax_strategy_version',
      'retire_tax_strategy_version',
    ],
  );

  const windowOnly = await executeTaxStrategyEngineCommand(ownerCtx, 'update_tax_strategy_version_draft', {
    tax_strategy_version_id: versionId,
    effective_from: '2020-02-01',
  });
  const afterWindow = (
    strategySlice(windowOnly.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
  ).find((row) => row.id === versionId);
  assert.equal(afterWindow?.strategy_checksum, initialChecksum);
  assert.equal(afterWindow?.effective_from, '2020-02-01');

  const titleUpdate = await executeTaxStrategyEngineCommand(ownerCtx, 'update_tax_strategy_version_draft', {
    tax_strategy_version_id: versionId,
    title: 'E3B draft v1 retitled',
  });
  const afterTitle = (
    strategySlice(titleUpdate.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
  ).find((row) => row.id === versionId);
  const afterTitleChecksum = String(afterTitle?.strategy_checksum);
  assert.notEqual(afterTitleChecksum, initialChecksum);

  const { data: activeRule } = await supabaseAdmin
    .from('tax_rule_versions')
    .select('id, country_code, status')
    .eq('country_code', 'IL')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (activeRule?.id) {
    const pinned = await executeTaxStrategyEngineCommand(ownerCtx, 'pin_tax_strategy_rule', {
      tax_strategy_version_id: versionId,
      tax_rule_version_id: activeRule.id,
      pin_role: 'required',
    });
    const afterPin = (
      strategySlice(pinned.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
    ).find((row) => row.id === versionId);
    const pin = (afterPin?.rule_pins as Array<Record<string, unknown>> | undefined)?.[0];
    assert.ok(pin);
    assert.notEqual(afterPin?.strategy_checksum, afterTitleChecksum);
    assert.deepEqual(
      (pin.allowed_actions as Array<{ action_key: string }>).map((row) => row.action_key),
      ['unpin_tax_strategy_rule'],
    );
    const unpinned = await executeTaxStrategyEngineCommand(ownerCtx, 'unpin_tax_strategy_rule', {
      tax_strategy_version_rule_pin_id: String(pin.id),
    });
    const afterUnpin = (
      strategySlice(unpinned.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
    ).find((row) => row.id === versionId);
    assert.equal(afterUnpin?.strategy_checksum, afterTitleChecksum);
    assert.equal(((afterUnpin?.rule_pins as unknown[]) ?? []).length, 0);
  }

  const { data: activeCalc } = await supabaseAdmin
    .from('tax_calculation_definition_versions')
    .select('id, country_code, status')
    .eq('country_code', 'IL')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (activeCalc?.id) {
    const pinnedCalc = await executeTaxStrategyEngineCommand(ownerCtx, 'pin_tax_strategy_calculation', {
      tax_strategy_version_id: versionId,
      calculation_definition_version_id: activeCalc.id,
    });
    const afterCalcPin = (
      strategySlice(pinnedCalc.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
    ).find((row) => row.id === versionId);
    const calcPin = (afterCalcPin?.calculation_pins as Array<Record<string, unknown>> | undefined)?.[0];
    assert.ok(calcPin);
    assert.notEqual(afterCalcPin?.strategy_checksum, afterTitleChecksum);
    const unpinnedCalc = await executeTaxStrategyEngineCommand(ownerCtx, 'unpin_tax_strategy_calculation', {
      tax_strategy_version_calculation_pin_id: String(calcPin.id),
    });
    const afterCalcUnpin = (
      strategySlice(unpinnedCalc.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
    ).find((row) => row.id === versionId);
    assert.equal(afterCalcUnpin?.strategy_checksum, afterTitleChecksum);
  }

  const { data: inactiveRule } = await supabaseAdmin
    .from('tax_rule_versions')
    .select('id, country_code, status')
    .eq('country_code', 'IL')
    .neq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (inactiveRule?.id) {
    const invalidDraft = await executeTaxStrategyEngineCommand(ownerCtx, 'create_tax_strategy_version', {
      tax_strategy_id: strategyId,
      effective_from: '2021-01-01',
      title: 'E3B invalid publication',
      requires_professional_judgment: false,
      authored_metadata_json: {},
    });
    const invalidVersion = (
      strategySlice(invalidDraft.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
    ).find((row) => row.tax_strategy_id === strategyId && row.title === 'E3B invalid publication');
    assert.ok(invalidVersion);
    await executeTaxStrategyEngineCommand(ownerCtx, 'pin_tax_strategy_rule', {
      tax_strategy_version_id: String(invalidVersion.id),
      tax_rule_version_id: inactiveRule.id,
      pin_role: 'required',
    });
    await assert.rejects(
      () =>
        executeTaxStrategyEngineCommand(ownerCtx, 'activate_tax_strategy_version', {
          tax_strategy_version_id: String(invalidVersion.id),
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.statusCode === 409 &&
        /cannot activate while a rule pin points at a non-active/i.test(err.message),
    );
    await executeTaxStrategyEngineCommand(ownerCtx, 'retire_tax_strategy_version', {
      tax_strategy_version_id: String(invalidVersion.id),
      retired_reason: 'invalid publication probe',
    });
  }

  const activated = await executeTaxStrategyEngineCommand(ownerCtx, 'activate_tax_strategy_version', {
    tax_strategy_version_id: versionId,
  });
  const active = (
    strategySlice(activated.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
  ).find((row) => row.id === versionId);
  assert.equal(active?.status, 'active');
  assert.ok(
    (active?.allowed_actions as Array<{ action_key: string }>).some(
      (row) => row.action_key === 'close_tax_strategy_version_effective_to',
    ),
  );

  const closed = await executeTaxStrategyEngineCommand(ownerCtx, 'close_tax_strategy_version_effective_to', {
    tax_strategy_version_id: versionId,
    effective_to: '2030-12-31',
  });
  const afterClose = (
    strategySlice(closed.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
  ).find((row) => row.id === versionId);
  assert.equal(afterClose?.effective_to, '2030-12-31');
  await assert.rejects(
    () =>
      executeTaxStrategyEngineCommand(ownerCtx, 'close_tax_strategy_version_effective_to', {
        tax_strategy_version_id: versionId,
        effective_to: '2031-01-01',
      }),
    (err: unknown) => err instanceof AppError && err.statusCode === 409,
  );

  const draft2 = await executeTaxStrategyEngineCommand(ownerCtx, 'create_tax_strategy_version', {
    tax_strategy_id: strategyId,
    effective_from: '2022-01-01',
    title: 'E3B draft v2',
    requires_professional_judgment: true,
    authored_metadata_json: { explanation: 'successor' },
  });
  const successor = (
    strategySlice(draft2.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>
  ).find((row) => row.title === 'E3B draft v2' && row.tax_strategy_id === strategyId);
  assert.ok(successor);
  const successorId = String(successor.id);
  const successorActions = (successor.allowed_actions as Array<{ action_key: string }>).map((row) => row.action_key);
  assert.ok(successorActions.includes('supersede_tax_strategy_version'));

  const superseded = await executeTaxStrategyEngineCommand(ownerCtx, 'supersede_tax_strategy_version', {
    old_tax_strategy_version_id: versionId,
    new_tax_strategy_version_id: successorId,
  });
  const afterSupersede = strategySlice(superseded.refreshed.aggregate).strategy_versions as Array<Record<string, unknown>>;
  const oldAfter = afterSupersede.find((row) => row.id === versionId);
  const newAfter = afterSupersede.find((row) => row.id === successorId);
  assert.equal(oldAfter?.status, 'retired');
  assert.deepEqual(oldAfter?.allowed_actions, []);
  assert.equal(newAfter?.status, 'active');
  assert.equal(newAfter?.supersedes_version_id, versionId);

  await executeTaxStrategyEngineCommand(ownerCtx, 'retire_tax_strategy_version', {
    tax_strategy_version_id: successorId,
    retired_reason: 'e3b complete',
  });
  const retired = (
    strategySlice(
      (
        await executeTaxStrategyEngineCommand(ownerCtx, 'update_tax_strategy_metadata', {
          tax_strategy_id: strategyId,
          owner_note: 'done',
        })
      ).refreshed.aggregate,
    ).strategy_versions as Array<Record<string, unknown>>
  ).find((row) => row.id === successorId);
  assert.equal(retired?.status, 'retired');
  assert.deepEqual(retired?.allowed_actions, []);
});
