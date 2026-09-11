import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseTaxKnowledgeAggregate, OwnerTaxKnowledgePanel } from '../src/pages/owner-tax-knowledge-panel.tsx';
import { parseStrategyEngineAggregate, OwnerStrategyEnginePanel } from '../src/pages/owner-strategy-engine-panel.tsx';
import {
  OwnerLegalControlRenderBoundary,
  ownerLegalControlStatusBadgeLabel,
  ownerLegalControlWarningTexts,
  stringifyAggregateJson,
} from '../src/pages/owner-legal-control-render-safety.tsx';

const statusBadge = { code: 'active', label: 'Active', tone: 'ok' };

/**
 * Current GET /api/v1/owner/legal-control 200 shape after migrations 618/619.
 * Includes the nested objects that white-screened the page when rendered as React children.
 */
const currentLegalControl200 = {
  aggregate_key: 'owner_legal_control_panel_aggregate',
  owner_panel_sections: [
    {
      section_key: 'system',
      label: 'System',
      description: 'Platform diagnostics',
      aggregate_key: 'owner_system_health_aggregate',
      read_route: '/owner/system-health',
      enabled: true,
    },
  ],
  country_packs_admin: {
    aggregate_key: 'owner_country_pack_admin_aggregate',
    status: { packs_enabled: 1, rulesets_active: 1 },
    tables: {
      countries: [
        {
          code: 'IL',
          name: 'Israel',
          status: 'active',
          default_timezone: 'Asia/Jerusalem',
          status_badge: statusBadge,
        },
      ],
      country_packs: [
        {
          id: 'pack-1',
          country_code: 'IL',
          pack_code: 'il-core',
          name: 'Israel core',
          status: 'enabled',
          module_code: 'core',
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
          effective_window: '2026-01-01 -> open',
        },
      ],
    },
    warnings: ['no_enabled_packs'],
    errors: [],
    actions: [{ action_key: 'create_country', enabled: true }],
  },
  countries: [{ code: 'IL', name: 'Israel', status: 'active', status_badge: statusBadge }],
  country_packs: [
    {
      id: 'pack-1',
      country_code: 'IL',
      pack_code: 'il-core',
      name: 'Israel core',
      status: 'enabled',
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
      status_badge: statusBadge,
    },
  ],
  legal_values: {
    aggregate_key: 'owner_legal_values_aggregate',
    table: [
      {
        id: 'lv-1',
        country_code: 'IL',
        value_key: 'vat.standard_rate',
        label: 'VAT standard',
        category: 'VAT',
        module_scope: null,
        value_type: 'percentage',
        status: 'active',
        status_badge: statusBadge,
        current_active_value: { rate: 18 },
        versions: [
          {
            id: 'lvv-1',
            status: 'active',
            effective_from: '2026-01-01',
            effective_to: null,
            value_payload_json: { rate: 18 },
            status_badge: statusBadge,
          },
        ],
      },
    ],
    legal_values_table: {
      columns: [{ key: 'value_key', label: 'Key' }],
      rows: [
        {
          row_id: 'IL:vat.standard_rate',
          cells: { value_key: 'vat.standard_rate' },
          current_value_display: '18%',
          actions: [],
        },
      ],
      empty_state: { visible: false, title: 'No legal values', description: '' },
    },
    validation_warnings: [],
    actions: [{ action_key: 'create_legal_value', enabled: true }],
  },
  legal_values_table: {
    columns: [{ key: 'value_key', label: 'Key' }],
    rows: [],
    empty_state: { visible: true, title: 'No legal values', description: '' },
  },
  legal_tax_values: {
    table: [
      {
        id: 'lv-1',
        country_code: 'IL',
        value_key: 'vat.standard_rate',
        label: 'VAT standard',
        category: 'VAT',
        status: 'active',
        status_badge: statusBadge,
        current_active_value: { rate: 18 },
        versions: [],
      },
    ],
    legal_values_table: { columns: [], rows: [], empty_state: { visible: false } },
  },
  platform_pricing: {
    aggregate_key: 'owner_platform_pricing_aggregate',
    table: {
      rows: [
        {
          module_plan_id: 'mp-1',
          module_code: 'docflow',
          module_name: 'DocFlow',
          plan_code: 'std',
          plan_name: 'Standard',
          price_amount: 10,
          currency: 'ILS',
          billing_period: 'monthly',
          is_active: true,
          status_badge: statusBadge,
        },
      ],
    },
    warnings: ['module_plan_pricing_has_no_effective_date_versioning'],
    actions: [{ action_key: 'create_module_plan', enabled: true, payload: { module_plan_id: 'uuid' } }],
  },
  owner_email_provider_config_aggregate: {
    provider_type: 'resend',
    provider_display_name: 'Resend',
    masked_api_key: 're_***xx',
    from_email: 'ops@example.com',
    from_name: 'NodexPro',
    is_configured: true,
    custom_api_config_summary: null,
    app_public_url: 'https://nodexpro-dev.vercel.app',
    app_public_url_is_configured: true,
    allowed_actions: {
      save_email_provider_config: { enabled: true, reason: null },
      save_platform_public_url: { enabled: true, reason: null },
    },
  },
  communication_policies: {
    operational_reminder_policies: [
      {
        row_key: 'ver-1:waiting_client',
        country_code: 'IL',
        workflow_summary: 'Waiting client',
        reminder_count: 2,
        channel_labels: ['DocFlow', 'Email'],
        default_channels: ['docflow', 'email'],
        approval_required: true,
        effective_window: '2026-01-01 -> open',
        workflow_row_status_label: 'Active',
        policy_preview: 'Waiting client',
        allowed_actions: [
          {
            action_key: 'edit_reminder_workflow',
            command: 'edit_operational_reminder_workflow',
            label: 'Edit',
            enabled: true,
            command_payload: {},
          },
        ],
      },
    ],
    quick_actions: [
      {
        action_key: 'save_operational_reminder_workflow',
        enabled: true,
        button_label: 'New reminder workflow',
        smart_form: 'reminder_workflow',
      },
    ],
    validation_errors: [],
    picker_options: { countries: [], country_packs: [], rulesets: [] },
    editor_options: { channels: [{ code: 'docflow', label: 'DocFlow' }] },
  },
  commercial_controls: {
    filters: {
      search: '',
      module_key: '',
      entitlement_status: '',
      activation_status: '',
      options: {
        modules: [{ module_key: 'docflow', module_name: 'DocFlow' }],
        entitlement_statuses: ['entitled', 'trial', 'not_entitled', 'expired'],
        activation_statuses: ['active', 'inactive'],
      },
    },
    pagination: { page: 1, page_size: 20, total_count: 1, total_pages: 1 },
    org_rows: [
      {
        org_id: 'org-1',
        org_name: 'Demo office',
        clients_count: 3,
        modules: [
          {
            module_key: 'docflow',
            module_name: 'DocFlow',
            activation_status: 'active',
            entitlement_status: 'entitled',
            effective_price_preview: { currency: 'ILS', amount: 10 },
            active_pricing_adjustment: null,
          },
        ],
      },
    ],
  },
  tax_knowledge: {
    selected_country_code: 'IL',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    sources: [
      {
        id: 'src-1',
        country_code: 'IL',
        source_code: 'ITA',
        title: 'Income Tax Act',
        provenance_type: 'statute',
        status: 'active',
        allowed_actions: [],
      },
    ],
    rules: [
      {
        id: 'rule-1',
        country_code: 'IL',
        rule_code: 'R-1',
        title: 'Rule one',
        status: 'active',
        allowed_actions: [],
        versions: [
          {
            id: 'rv-1',
            tax_rule_id: 'rule-1',
            country_code: 'IL',
            version_no: 1,
            status: 'draft',
            payload_json: { kind: 'rule' },
            allowed_actions: [],
          },
        ],
      },
      {
        id: 'rule-missing-versions',
        country_code: 'IL',
        rule_code: 'R-2',
        title: 'Rule without versions key',
        status: 'active',
        allowed_actions: [],
      },
    ],
    rule_versions: [],
    allowed_actions: [],
    implemented_commands: [],
    warnings: [],
  },
  strategy_engine: {
    selected_country_code: 'IL',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    exclusive_groups: [
      {
        id: 'g1',
        country_code: 'IL',
        group_code: 'cap',
        title: 'Capital',
        owner_note: null,
        allowed_actions: [],
      },
    ],
    strategies: [
      {
        id: 's1',
        country_code: 'IL',
        strategy_code: 'cap_gains',
        admin_label: 'Capital gains',
        owner_note: null,
        allowed_actions: [],
        versions: [
          {
            id: 'sv-1',
            tax_strategy_id: 's1',
            version_no: 1,
            status: 'active',
            title: 'Active strategy',
            authored_metadata_json: { benefits: ['a'], tags: ['t'] },
            allowed_actions: [],
            rule_pins: [],
            calculation_pins: [],
          },
        ],
      },
      {
        id: 's-missing-versions',
        country_code: 'IL',
        strategy_code: 'bare',
        admin_label: 'Bare strategy',
        allowed_actions: [],
      },
    ],
    strategy_versions: [],
    pin_catalog: { calculation_definition_versions: [] },
    allowed_actions: [],
    warnings: [],
  },
  fact_dictionary: {
    selected_country_code: 'IL',
    countries: [{ code: 'IL', name: 'Israel', status: 'active' }],
    definitions: [],
    allowed_actions: [],
    warnings: ['fact_dictionary_schema_not_applied'],
  },
  docflow_communication_templates: [],
  docflow_request_templates: [],
  available_actions: {
    country_pack_admin: [{ action_key: 'create_country', enabled: true }],
    legal_values: [{ action_key: 'create_legal_value', enabled: true }],
    tax_knowledge: [],
    strategy_engine: [],
    fact_dictionary: [],
    platform_pricing: [],
    owner_email_provider_config: [{ action_key: 'save_email_provider_config', enabled: true, button_label: 'Email provider' }],
  },
  audit_summary: { recent: [] },
  warnings: {
    country_pack_admin: ['no_enabled_packs'],
    legal_values: [],
    communication_policies: [],
    platform_pricing: ['module_plan_pricing_has_no_effective_date_versioning'],
    tax_knowledge: ['tax_knowledge_schema_not_applied'],
    strategy_engine: ['strategy_engine_schema_not_applied'],
    fact_dictionary: ['fact_dictionary_schema_not_applied'],
    combined: [
      'no_enabled_packs',
      'module_plan_pricing_has_no_effective_date_versioning',
      'fact_dictionary_schema_not_applied',
      statusBadge,
      { message: 'checksum_note' },
    ],
  },
};

function renderFirstPaint(panel: typeof currentLegalControl200): string {
  const warnings = ownerLegalControlWarningTexts(panel);
  const countries = panel.country_packs_admin.tables.countries;
  const taxKnowledge = parseTaxKnowledgeAggregate(panel.tax_knowledge);
  const strategyEngine = parseStrategyEngineAggregate(panel.strategy_engine);
  return renderToStaticMarkup(
    createElement(OwnerLegalControlRenderBoundary, {
      children: createElement(
        'div',
        null,
        createElement('h1', null, 'Owner Legal Control Panel'),
        createElement(
          'ul',
          null,
          ...warnings.map((w) => createElement('li', { key: w }, w)),
        ),
        createElement(
          'table',
          null,
          createElement(
            'tbody',
            null,
            ...countries.map((row) =>
              createElement('tr', { key: row.code }, createElement('td', null, ownerLegalControlStatusBadgeLabel(row))),
            ),
          ),
        ),
        createElement('div', null, stringifyAggregateJson(panel.legal_values.table[0].current_active_value)),
        createElement(OwnerTaxKnowledgePanel, {
          taxKnowledge,
          countryPacks: panel.country_packs,
          rulesets: panel.rulesets,
          legalValues: panel.legal_values,
          pendingCountryCode: null,
          busy: false,
          onSelectCountry: () => undefined,
          onCommand: async () => undefined,
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
}

test('status_badge object is not a valid React child (the 200 white-screen)', () => {
  assert.throws(() => {
    renderToStaticMarkup(createElement('span', null, statusBadge));
  }, /Objects are not valid as a React child/);
});

test('warnings.combined objects are not valid React children', () => {
  assert.throws(() => {
    renderToStaticMarkup(
      createElement(
        'ul',
        null,
        ...currentLegalControl200.warnings.combined.map((w) => createElement('li', { key: String(w) }, w)),
      ),
    );
  }, /Objects are not valid as a React child/);
});

test('ownerLegalControlWarningTexts keeps backend strings and drops badge objects', () => {
  const texts = ownerLegalControlWarningTexts(currentLegalControl200);
  assert.ok(texts.includes('no_enabled_packs'));
  assert.ok(texts.includes('checksum_note'));
  assert.equal(
    texts.some((t) => t === '[object Object]'),
    false,
  );
});

test('ownerLegalControlStatusBadgeLabel reads backend badge.label', () => {
  assert.equal(ownerLegalControlStatusBadgeLabel(currentLegalControl200.country_packs_admin.tables.countries[0]), 'Active');
});

test('current Legal Control 200 aggregate first-paint cannot white-screen', () => {
  const html = renderFirstPaint(currentLegalControl200);
  assert.match(html, /Owner Legal Control Panel/);
  assert.match(html, /Tax Knowledge/);
  assert.match(html, /Strategy Engine/);
  assert.match(html, /Active/);
  assert.match(html, /no_enabled_packs/);
  assert.doesNotMatch(html, /\[object Object\]/);
});
