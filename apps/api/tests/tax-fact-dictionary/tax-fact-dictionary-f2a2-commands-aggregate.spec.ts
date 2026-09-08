import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../src/shared/errors.js';
import { taxFactDefinitionChecksum } from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-checksum.pure.js';
import {
  assertCurrencyPolicy,
  assertEnumReadyForActivation,
  assertFactKey,
  assertValidationJson,
  assertValueType,
} from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-validation.pure.js';
import {
  TAX_FACT_DICTIONARY_COMMANDS,
  isTaxFactDictionaryCommand,
} from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary.types.js';
import { isTaxKnowledgeCommand } from '../../src/domains/tax-knowledge/tax-knowledge.types.js';
import { isTaxStrategyEngineCommand } from '../../src/domains/tax-strategy-engine/tax-strategy-engine-commands.types.js';
import { isTaxRuleEngineCommand } from '../../src/domains/tax-rule-engine/tax-rule-engine.types.js';
import { isTaxCalculationEngineCommand } from '../../src/domains/tax-calculation-engine/tax-calculation-engine-commands.types.js';
import {
  definitionAllowedActions,
  factDictionaryCatalogAllowedActions,
  presentationAllowedActions,
  versionAllowedActions,
} from '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-read-models.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

const F2A2_COMMANDS = [
  'create_tax_fact_definition',
  'update_tax_fact_definition_metadata',
  'activate_tax_fact_definition',
  'retire_tax_fact_definition',
  'create_tax_fact_definition_version',
  'update_tax_fact_definition_version_draft',
  'activate_tax_fact_definition_version',
  'retire_tax_fact_definition_version',
  'close_tax_fact_definition_version_effective_to',
  'add_tax_fact_enum_option',
  'update_tax_fact_enum_option',
  'remove_tax_fact_enum_option',
  'create_tax_fact_presentation',
  'update_tax_fact_presentation',
  'delete_tax_fact_presentation',
] as const;

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

const baseChecksumInput = {
  fact_key: 'employee_count',
  country_code: 'IL' as string | null,
  value_type: 'integer',
  unit_code: null as string | null,
  currency_policy: null as Record<string, unknown> | null,
  validation_json: {} as Record<string, unknown>,
  enum_codes: [] as string[],
};

test('TAX-F2A2 1-6: checksum is dedicated, deterministic, and presentation-blind', () => {
  const a = taxFactDefinitionChecksum(baseChecksumInput);
  const b = taxFactDefinitionChecksum({
    ...baseChecksumInput,
    validation_json: {},
    enum_codes: [],
  });
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b);

  const changedKey = taxFactDefinitionChecksum({ ...baseChecksumInput, fact_key: 'headcount' });
  const changedType = taxFactDefinitionChecksum({ ...baseChecksumInput, value_type: 'decimal' });
  const changedCountry = taxFactDefinitionChecksum({ ...baseChecksumInput, country_code: 'US' });
  assert.notEqual(a, changedKey);
  assert.notEqual(a, changedType);
  assert.notEqual(a, changedCountry);

  const withTitleIgnored = taxFactDefinitionChecksum({
    ...baseChecksumInput,
    // @ts-expect-error semantic_title is not a checksum input
    semantic_title: 'Employees',
    owner_note: 'ignored',
  });
  assert.equal(a, withTitleIgnored);

  const withPresentationIgnored = taxFactDefinitionChecksum({
    ...baseChecksumInput,
    // @ts-expect-error presentation is not a checksum input
    presentations: [{ locale: 'he', label: 'עובדים' }],
    aliases: ['staff'],
  });
  assert.equal(a, withPresentationIgnored);

  const enumA = taxFactDefinitionChecksum({
    ...baseChecksumInput,
    value_type: 'enum',
    enum_codes: ['resident', 'non_resident'],
  });
  const enumB = taxFactDefinitionChecksum({
    ...baseChecksumInput,
    value_type: 'enum',
    enum_codes: ['non_resident', 'resident'],
  });
  assert.equal(enumA, enumB);

  const enumChanged = taxFactDefinitionChecksum({
    ...baseChecksumInput,
    value_type: 'enum',
    enum_codes: ['resident', 'non_resident', 'new_immigrant'],
  });
  assert.notEqual(enumA, enumChanged);

  const helper = readRepo('apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-checksum.pure.ts');
  assert.match(helper, /export function taxFactDefinitionChecksum/);
  assert.doesNotMatch(helper, /taxRulePayloadChecksum|taxStrategyChecksum|taxCalculation/);
  const commandsSrc = readRepo(
    'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-commands.service.ts',
  );
  assert.match(commandsSrc, /taxFactDefinitionChecksum/);
  assert.doesNotMatch(commandsSrc, /taxRulePayloadChecksum|taxStrategyChecksum/);
});

test('TAX-F2A2 7-10: reserved key, money empty currencies, enum zero options, presentation excluded', () => {
  assert.throws(() => assertFactKey('evaluation_as_of'), (err: unknown) => {
    return err instanceof AppError && /reserved/.test(err.message);
  });
  assert.throws(() => assertFactKey('EmployeeCount'), (err: unknown) => {
    return err instanceof AppError && /snake_case/.test(err.message);
  });
  assert.equal(assertFactKey('employee_count'), 'employee_count');
  assert.equal(assertValueType('money'), 'money');

  assert.throws(
    () => assertCurrencyPolicy({ required: true, allowed_currencies: [] }, 'money'),
    (err: unknown) => err instanceof AppError && /cannot be empty/.test((err as AppError).message),
  );
  const omitted = assertCurrencyPolicy({ required: false }, 'money');
  assert.deepEqual(omitted, { required: false });
  assert.equal(assertCurrencyPolicy(null, 'integer'), null);
  assert.throws(() => assertCurrencyPolicy({ required: true }, 'integer'));

  assert.throws(
    () => assertEnumReadyForActivation('enum', []),
    (err: unknown) => err instanceof AppError && /at least one enum option/.test((err as AppError).message),
  );
  assert.doesNotThrow(() => assertEnumReadyForActivation('enum', ['resident']));
  assert.throws(() => assertValidationJson({ enum_codes: ['a'] }, 'enum'));

  const checksum = taxFactDefinitionChecksum(baseChecksumInput);
  const afterPresentationShape = taxFactDefinitionChecksum(baseChecksumInput);
  assert.equal(checksum, afterPresentationShape);
});

test('TAX-F2A2 11-15: Owner-only commands on existing bus, no dedicated GET, no PATCH', async () => {
  assert.deepEqual([...TAX_FACT_DICTIONARY_COMMANDS], [...F2A2_COMMANDS]);
  for (const command of F2A2_COMMANDS) {
    assert.equal(isTaxFactDictionaryCommand(command), true, command);
    assert.equal(isTaxKnowledgeCommand(command), false, command);
    assert.equal(isTaxStrategyEngineCommand(command), false, command);
    assert.equal(isTaxRuleEngineCommand(command), false, command);
    assert.equal(isTaxCalculationEngineCommand(command), false, command);
  }
  assert.equal(isTaxFactDictionaryCommand('evaluate_tax_rules'), false);
  assert.equal(isTaxFactDictionaryCommand('calculate_tax'), false);
  assert.equal(isTaxFactDictionaryCommand('ingest_fact_from_llm'), false);

  const commandsSrc = readRepo(
    'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-commands.service.ts',
  );
  assert.match(commandsSrc, /export async function executeTaxFactDictionaryCommand/);
  assert.match(commandsSrc, /assertPlatformOwner\(ctx\)/);
  for (const command of F2A2_COMMANDS) {
    assert.match(commandsSrc, new RegExp(`case '${command}':`));
  }
  assert.match(commandsSrc, /buildOwnerLegalControlPanelAggregate/);
  assert.doesNotMatch(commandsSrc, /fact_dictionary_country_code/);
  assert.match(commandsSrc, /aggregate_key: 'owner_legal_control_panel_aggregate'/);
  assert.match(commandsSrc, /organizationId:\s*null/);
  assert.match(commandsSrc, /writeAudit/);
  assert.doesNotMatch(commandsSrc, /evaluate_tax_rules|calculate_tax|evaluateTaxStrategies/);
  assert.doesNotMatch(commandsSrc, /supersede_tax_fact/);
  assert.doesNotMatch(commandsSrc, /organization_id|client_id|case_id/);

  const routes = readRepo('apps/api/src/routes/owner-country-pack.routes.ts');
  assert.match(routes, /router\.post\('\/command'/);
  assert.match(routes, /isTaxFactDictionaryCommand\(commandName\)/);
  assert.match(routes, /executeTaxFactDictionaryCommand/);
  assert.match(routes, /router\.get\('\/legal-control'/);
  assert.doesNotMatch(routes, /router\.get\('\/fact-dictionary'/);
  assert.doesNotMatch(routes, /router\.(patch|put)\(/i);

  const { executeTaxFactDictionaryCommand } = await import(
    '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-commands.service.js'
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
      executeTaxFactDictionaryCommand(tenantCtx, 'create_tax_fact_definition', {
        fact_key: 'employee_count',
        semantic_title: 'blocked',
      }),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});

test('TAX-F2A2 12: allowed_actions advertise only implemented commands', () => {
  const helpers = readRepo('apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-read-models.pure.ts');
  const writeSrc = readRepo(
    'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-commands.service.ts',
  );
  const advertised = [
    ...factDictionaryCatalogAllowedActions(),
    ...definitionAllowedActions('draft'),
    ...definitionAllowedActions('active'),
    ...versionAllowedActions({
      status: 'draft',
      identity_status: 'active',
      value_type: 'enum',
      enum_option_count: 1,
      effective_from: '2026-01-01',
      effective_to: null,
    }),
    ...versionAllowedActions({
      status: 'active',
      identity_status: 'active',
      value_type: 'integer',
      enum_option_count: 0,
      effective_from: '2026-01-01',
      effective_to: null,
    }),
    ...presentationAllowedActions(),
  ].map((action) => action.action_key);
  for (const actionKey of advertised) {
    assert.equal(isTaxFactDictionaryCommand(actionKey), true, actionKey);
    assert.match(writeSrc, new RegExp(`case '${actionKey}':`));
    assert.match(helpers, new RegExp(`'${actionKey}'`));
  }
  assert.doesNotMatch(helpers, /ingest_fact|missing_fact|tax_advisory|trainer/);
  assert.doesNotMatch(helpers, /supersede_tax_fact/);
});

test('TAX-F2A2 16-19: no tenant fields, 600-613 frozen, K3/K4/Strategy isolation', () => {
  const frozen = [
    'supabase/migrations/600_tax_knowledge_core_foundation.sql',
    'supabase/migrations/612_tax_strategy_engine_foundation.sql',
    'supabase/migrations/613_tax_fact_dictionary_foundation.sql',
  ];
  for (const file of frozen) {
    const diff = execSync(`git diff -- ${file}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
    assert.equal(diff, '', `${file} must remain unchanged`);
  }
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/614_tax_fact_dictionary_owner.sql')), false);
  assert.equal(existsSync(join(repoRoot, 'supabase/migrations/614_tax_fact_dictionary_foundation.sql')), false);
  assert.equal(
    existsSync(join(repoRoot, 'supabase/migrations/614_tax_fact_dictionary_atomic_activation.sql')),
    true,
  );

  const extra = execSync('git diff --name-only -- supabase/migrations', {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((name) => !name.includes('614_tax_fact_dictionary_atomic_activation.sql'));
  assert.deepEqual(extra, [], 'tracked Tax Brain migrations 600–613 must not change');

  const web = execSync('git diff --name-only -- apps/web', { cwd: repoRoot, encoding: 'utf8' }).trim();
  assert.equal(web, '', 'F2A2 must not change the web client');

  const k3 = execSync('git diff --name-only -- apps/api/src/domains/tax-rule-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const k4 = execSync('git diff --name-only -- apps/api/src/domains/tax-calculation-engine', {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  assert.equal(k3, '', 'K3 sources must remain unchanged');
  assert.equal(k4, '', 'K4 sources must remain unchanged');

  const evaluate = readRepo('apps/api/src/domains/tax-strategy-engine/tax-strategy-engine-evaluate.pure.ts');
  assert.doesNotMatch(evaluate, /taxFactDefinitionChecksum|fact_dictionary/);

  const domainFiles = [
    'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary.types.ts',
    'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-commands.service.ts',
    'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-read-models.service.ts',
  ];
  for (const file of domainFiles) {
    const text = readRepo(file);
    assert.doesNotMatch(text, /organization_id|org_id|client_id|case_id/, file);
  }

  const panel = readRepo('apps/api/src/domains/country-pack/country-pack-read-models.service.ts');
  assert.match(panel, /fact_dictionary: factDictionary/);
  assert.match(panel, /buildOwnerFactDictionaryAggregate/);
});

test('TAX-F2A2 20: audit actions exist and activation uses the atomic RPC', () => {
  const auditSrc = readRepo('apps/api/src/shared/audit-events.ts');
  assert.match(auditSrc, /TAX_FACT_DEFINITION_CREATED:\s*'tax_fact_definition_created'/);
  assert.match(auditSrc, /TAX_FACT_DEFINITION_VERSION_ACTIVATED:\s*'tax_fact_definition_version_activated'/);
  assert.match(auditSrc, /TAX_FACT_ENUM_OPTION_ADDED:\s*'tax_fact_enum_option_added'/);
  assert.match(auditSrc, /TAX_FACT_PRESENTATION_CREATED:\s*'tax_fact_presentation_created'/);

  const commandsSrc = readRepo(
    'apps/api/src/domains/tax-fact-dictionary/tax-fact-dictionary-commands.service.ts',
  );
  assert.match(commandsSrc, /persistDraftChecksum/);
  assert.match(commandsSrc, /rpc\('tax_fact_definition_version_activate'/);
  assert.doesNotMatch(commandsSrc, /613 has no atomic activation RPC/);
});

test('TAX-F2A2 owner-only even when Supabase is configured', async (t) => {
  if (!supabaseConfigured()) {
    t.skip('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured');
    return;
  }
  const { executeTaxFactDictionaryCommand } = await import(
    '../../src/domains/tax-fact-dictionary/tax-fact-dictionary-commands.service.js'
  );
  await assert.rejects(
    () =>
      executeTaxFactDictionaryCommand(
        {
          user: {
            id: '00000000-0000-0000-0000-000000000002',
            authUserId: '00000000-0000-0000-0000-000000000002',
            email: 'not-owner@example.com',
            fullName: null,
            status: 'active',
            uiLanguage: 'en',
          },
        } as never,
        'create_tax_fact_definition',
        { fact_key: 'employee_count', semantic_title: 'x' },
      ),
    (err: unknown) => err instanceof AppError && err.statusCode === 403,
  );
});
