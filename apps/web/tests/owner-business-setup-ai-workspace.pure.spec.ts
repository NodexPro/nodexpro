import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  BUSINESS_SETUP_AI_OWNER_NAV,
  businessSetupAiOwnerSectionFromHash,
} from '../src/pages/owner-business-setup-ai-nav.ts';
import { OwnerBusinessSetupAiWorkspace } from '../src/pages/owner-business-setup-ai-workspace.tsx';
import { OwnerCountryContextPanel } from '../src/pages/owner-country-context-panel.tsx';
import { OwnerFactDictionaryPanel, parseFactDictionaryAggregate } from '../src/pages/owner-fact-dictionary-panel.tsx';
import { OwnerLegalValuesPanel } from '../src/pages/owner-legal-values-panel.tsx';
import { OwnerTaxKnowledgePanel, parseTaxKnowledgeAggregate } from '../src/pages/owner-tax-knowledge-panel.tsx';
import { OwnerStrategyEnginePanel, parseStrategyEngineAggregate } from '../src/pages/owner-strategy-engine-panel.tsx';
import { OwnerLegalControlRenderBoundary } from '../src/pages/owner-legal-control-render-safety.tsx';
import { emptyFactDictionaryAggregate } from '../src/pages/owner-legal-control-types.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const PAGE = 'apps/web/src/pages/PlatformOwnerLegalControl.tsx';
const NAV = 'apps/web/src/pages/owner-business-setup-ai-nav.ts';

const statusBadge = { code: 'active', label: 'Active', tone: 'ok' };

const countryTables = {
  countries: [{ code: 'IL', name: 'Israel', status: 'active', default_timezone: 'Asia/Jerusalem', status_badge: statusBadge }],
  packs: [
    {
      id: 'pack-1',
      country_code: 'IL',
      pack_code: 'il-core',
      name: 'Israel core',
      status: 'enabled',
      framework_version: '1',
      code_version: '1',
      status_badge: { code: 'enabled', label: 'Active', tone: 'ok' },
    },
  ],
  rulesets: [
    {
      id: 'rs-1',
      country_pack_id: 'pack-1',
      ruleset_code: 'il-2026',
      ruleset_version: '1',
      status: 'active',
      effective_from: '2026-01-01',
      effective_to: null,
      status_badge: statusBadge,
    },
  ],
};

test('Business Setup AI owner page unmounts unrelated commercial and DocFlow UI', () => {
  const page = readRepo(PAGE);
  const nav = readRepo(NAV);

  assert.match(page, /OwnerTaxKnowledgePanel/);
  assert.match(page, /OwnerLegalValuesPanel/);
  assert.match(page, /OwnerFactDictionaryPanel/);
  assert.match(page, /OwnerCountryContextPanel/);
  assert.match(page, /OwnerStrategyEnginePanel/);
  assert.match(page, /OwnerAddCountryControl/);
  assert.match(page, /mergeOwnerCountrySelectorOptions/);
  assert.match(page, /OwnerBusinessSetupAiWorkspace/);
  assert.match(page, /OWNER\.legalControl/);
  assert.match(page, /OWNER\.command/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.match(page, /ownerLegalControlCountryQueryParams\(taxKnowledgeCountryQuery\)/);
  assert.match(page, /qs\.set\('tax_knowledge_country_code'/);
  assert.match(page, /qs\.set\('strategy_engine_country_code'/);
  assert.doesNotMatch(page, /activeSection === 'country-context'/);

  assert.doesNotMatch(page, /Commercial Controls/);
  assert.doesNotMatch(page, /commercial_page/);
  assert.doesNotMatch(page, /DocFlow Rules/);
  assert.doesNotMatch(page, /DocFlow Requests/);
  assert.doesNotMatch(page, /Communication policies/);
  assert.doesNotMatch(page, /Email Provider Configuration/);
  assert.doesNotMatch(page, /Organization Country Diagnostics/);
  assert.doesNotMatch(page, /OWNER\.countrySettings|OWNER\.countryDiagnostics/);
  assert.doesNotMatch(page, /platform_pricing/);
  assert.doesNotMatch(page, /Module Plans/);
  assert.doesNotMatch(nav, /DocFlow|Commercial|Invoice|Payroll|CRM|Knowledge Trainer|Opportunity/);
  assert.doesNotMatch(page, /Knowledge Trainer|Opportunity & Risk/);
});

test('Business Setup AI nav lists only implemented Tax & Law and Strategy Engine sections', () => {
  const labels = BUSINESS_SETUP_AI_OWNER_NAV.flatMap((group) => group.items.map((item) => item.label));
  const ids = BUSINESS_SETUP_AI_OWNER_NAV.flatMap((group) => group.items.map((item) => item.id));
  assert.deepEqual(labels, [
    'Laws & Sources',
    'Legal Values',
    'Client Facts',
    'Strategies',
  ]);
  assert.deepEqual(ids, ['tax-knowledge', 'legal-values', 'fact-dictionary', 'strategy-engine']);
  assert.equal(businessSetupAiOwnerSectionFromHash('#strategy-engine'), 'strategy-engine');
  assert.equal(businessSetupAiOwnerSectionFromHash('#fact-dictionary'), 'fact-dictionary');
  assert.equal(businessSetupAiOwnerSectionFromHash('#country-context'), 'tax-knowledge');
  assert.equal(businessSetupAiOwnerSectionFromHash('#nope'), 'tax-knowledge');
});

test('workspace chrome renders one active section, country context, compact warnings', () => {
  const html = renderToStaticMarkup(
    createElement(OwnerBusinessSetupAiWorkspace, {
      activeSection: 'tax-knowledge',
      onSelectSection: () => undefined,
      countryCode: 'IL',
      countries: [{ code: 'IL', name: 'Israel' }],
      countryBusy: false,
      onSelectCountry: () => undefined,
      warningCount: 1,
      warningsOpen: false,
      onToggleWarnings: () => undefined,
      warnings: ['no_enabled_packs'],
      error: '',
      children: createElement('div', null, 'Tax Knowledge body'),
    }),
  );
  assert.match(html, /Business Setup AI/);
  assert.match(html, /TAX &amp; LAW/);
  assert.match(html, /Laws &amp; Sources/);
  assert.match(html, /Legal Values/);
  assert.match(html, /Client Facts/);
  assert.doesNotMatch(html, /Country context/);
  assert.match(html, /Strategies/);
  assert.match(html, /Tax Knowledge body/);
  assert.match(html, /IL — Israel/);
  assert.match(html, /Warnings/);
  assert.doesNotMatch(html, /no_enabled_packs/);
  assert.doesNotMatch(html, /Commercial Controls/);
  assert.doesNotMatch(html, /DocFlow/);
  assert.doesNotMatch(html, /Add Country/);
  assert.doesNotMatch(html, /Knowledge Trainer/);
});

test('opening warnings shows backend warning strings, not invented statuses', () => {
  const html = renderToStaticMarkup(
    createElement(OwnerBusinessSetupAiWorkspace, {
      activeSection: 'legal-values',
      onSelectSection: () => undefined,
      countryCode: '',
      countries: [],
      countryBusy: false,
      onSelectCountry: () => undefined,
      warningCount: 1,
      warningsOpen: true,
      onToggleWarnings: () => undefined,
      warnings: ['fact_dictionary_schema_not_applied'],
      error: '',
      children: createElement('h2', null, 'Legal Values'),
    }),
  );
  assert.match(html, /fact_dictionary_schema_not_applied/);
  assert.match(html, /Legal Values/);
  assert.doesNotMatch(html, /aria-current="page"[^>]*>Laws &amp; Sources/);
});

test('required Business Setup AI sections still render from aggregate without white-screen', () => {
  const taxKnowledge = parseTaxKnowledgeAggregate({
    selected_country_code: 'IL',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    sources: [],
    rules: [],
    allowed_actions: [],
    warnings: ['tax_knowledge_schema_not_applied'],
  });
  const strategyEngine = parseStrategyEngineAggregate({
    selected_country_code: 'IL',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    exclusive_groups: [],
    strategies: [],
    pin_catalog: { calculation_definition_versions: [] },
    allowed_actions: [],
    warnings: [],
  });
  const factDictionary = parseFactDictionaryAggregate({
    selected_country_code: 'IL',
    selected_scope: 'country',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    definitions: [],
    allowed_actions: [],
    warnings: ['fact_dictionary_schema_not_applied'],
  });

  const html = renderToStaticMarkup(
    createElement(OwnerLegalControlRenderBoundary, {
      children: createElement(
        'div',
        null,
        createElement(OwnerTaxKnowledgePanel, {
          taxKnowledge,
          countryPacks: [],
          rulesets: [],
          legalValues: { table: [] },
          pendingCountryCode: null,
          busy: false,
          showCountryPicker: false,
          onSelectCountry: () => undefined,
          onCommand: async () => undefined,
        }),
        createElement(OwnerLegalValuesPanel, {
          rows: [
            {
              country_code: 'IL',
              value_key: 'il_vat_rate',
              label: 'VAT',
              category: 'VAT',
              current_active_value: 17,
              status_badge: statusBadge,
              versions: [],
            },
          ],
          actions: [{ action_key: 'create_legal_value', enabled: true }],
          busy: false,
          onOpenCommand: () => undefined,
        }),
        createElement(OwnerFactDictionaryPanel, {
          factDictionary,
          busy: false,
          onOpenCommand: () => undefined,
        }),
        createElement(OwnerCountryContextPanel, {
          countries: countryTables.countries,
          packs: countryTables.packs,
          rulesets: countryTables.rulesets,
          countryPackActions: [{ action_key: 'create_country', enabled: true }],
          emptyRulesetCreateActions: [],
          busy: false,
          selectedCountryCode: 'IL',
          onOpenCommand: () => undefined,
          onToggleCountryPack: () => undefined,
        }),
        createElement(OwnerStrategyEnginePanel, {
          strategyEngine,
          taxKnowledge,
          busy: false,
          onCommand: async () => undefined,
        }),
      ),
    }),
  );

  assert.match(html, /Tax Knowledge/);
  assert.match(html, /Legal Values/);
  assert.match(html, /Fact Dictionary/);
  assert.match(html, /Country workspace/);
  assert.match(html, /Strategy Engine/);
  assert.match(html, /il-core/);
  assert.match(html, /il_vat_rate/);
  assert.match(html, /fact_dictionary_schema_not_applied/);
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.doesNotMatch(html, /Commercial Controls/);
  assert.doesNotMatch(html, /DocFlow/);
});

test('Fact Dictionary parse does not invent definitions when the slice is missing', () => {
  const parsed = parseFactDictionaryAggregate(undefined);
  assert.deepEqual(parsed, emptyFactDictionaryAggregate());
  const html = renderToStaticMarkup(
    createElement(OwnerFactDictionaryPanel, {
      factDictionary: parsed,
      busy: false,
      onOpenCommand: () => undefined,
    }),
  );
  assert.match(html, /No country selected/);
  assert.doesNotMatch(html, /employee_count|invented/);
});

test('global country picker is in workspace chrome; Tax Knowledge does not duplicate it', () => {
  const taxKnowledge = parseTaxKnowledgeAggregate({
    selected_country_code: 'IL',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    sources: [],
    rules: [],
    allowed_actions: [],
    warnings: [],
  });
  const html = renderToStaticMarkup(
    createElement(
      'div',
      null,
      createElement(OwnerBusinessSetupAiWorkspace, {
        activeSection: 'tax-knowledge',
        onSelectSection: () => undefined,
        countryCode: 'IL',
        countries: [{ code: 'IL', name: 'Israel' }],
        countryBusy: false,
        onSelectCountry: () => undefined,
        warningCount: 0,
        warningsOpen: false,
        onToggleWarnings: () => undefined,
        warnings: [],
        error: '',
        children: createElement(OwnerTaxKnowledgePanel, {
          taxKnowledge,
          countryPacks: [],
          rulesets: [],
          legalValues: { table: [] },
          pendingCountryCode: null,
          busy: false,
          showCountryPicker: false,
          onSelectCountry: () => undefined,
          onCommand: async () => undefined,
        }),
      }),
    ),
  );
  assert.equal((html.match(/Select country/g) ?? []).length, 1);
  assert.match(html, /nx-bsai-field/);
});
