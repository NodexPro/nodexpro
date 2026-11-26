import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleTaxRatePayload,
  buildOwnerTaxRuleRows,
  dayBeforeYmd,
  isOwnerTaxCategory,
  parseTaxConditions,
  parseTaxRatePayload,
} from '../../src/domains/country-pack/owner-legal-taxes.pure.js';
import { ownerTaxesCopy } from '../../src/domains/country-pack/owner-taxes-copy.pure.js';

test('tax categories and conditions reject executable payloads', () => {
  assert.equal(isOwnerTaxCategory('VAT'), true);
  assert.equal(isOwnerTaxCategory('Modules'), false);
  assert.deepEqual(parseTaxConditions({ seller_context: 'nodexpro_platform', applies_to: 'platform_sales' }), {
    seller_context: 'nodexpro_platform',
    applies_to: 'platform_sales',
  });
  assert.equal(parseTaxConditions({ eval: '1+1' }), undefined);
  assert.equal(parseTaxConditions('function () {}'), undefined);
  assert.equal(assembleTaxRatePayload({ rate: 18, name_en: 'VAT' })?.rate, 0.18);
  assert.equal(assembleTaxRatePayload({ rate: '18' })?.rate, 0.18);
  assert.equal(assembleTaxRatePayload({ rate: 0.18 })?.rate, 0.18);
  assert.equal(assembleTaxRatePayload({ rate: 1800 }), null);
  assert.equal(assembleTaxRatePayload({ rate: 18, conditions: { script: 'x' } }), null);
  assert.equal(parseTaxRatePayload({ rate: 0.18 })?.calculation_type, 'percentage');
  assert.equal(parseTaxRatePayload({ rate: 0.18 })?.rate, 0.18);
  assert.equal(dayBeforeYmd('2027-01-01'), '2026-12-31');
});

test('tax rule rows expose versioned history and schedule command, not a second tax table', () => {
  const copy = ownerTaxesCopy('en');
  const rows = buildOwnerTaxRuleRows({
    asOfDate: '2026-11-26',
    lang: 'en',
    copy,
    legalRows: [
      {
        id: 'lv1',
        country_code: 'IL',
        value_key: 'il_standard_vat_rate',
        label: 'Israel standard VAT rate',
        category: 'VAT',
        module_scope: 'nodexpro_platform_sales',
        value_type: 'percentage',
        status: 'active',
        versions: [
          {
            id: 'v1',
            country_pack_ruleset_id: 'rs1',
            value_payload_json: { rate: 0.17, name_en: 'VAT 17' },
            effective_from: '2015-01-01',
            effective_to: '2024-12-31',
            status: 'active',
          },
          {
            id: 'v2',
            country_pack_ruleset_id: 'rs1',
            value_payload_json: { rate: 0.18, name_en: 'VAT 18', name_he: 'מע״מ' },
            effective_from: '2025-01-01',
            effective_to: null,
            status: 'active',
          },
        ],
      },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rate_label, '18%');
  assert.equal(rows[0].history.length, 2);
  assert.equal(rows[0].history[0].is_current, true);
  assert.ok(rows[0].actions.some((a) => a.action_key === 'schedule_tax_rate_change'));
  assert.equal(copy.title, 'Taxes');
  assert.equal(ownerTaxesCopy('he').title, 'מיסים');
});

test('schedule tax rate reuses Legal Control active ruleset id instead of creating another pack', () => {
  const copy = ownerTaxesCopy('en');
  const rows = buildOwnerTaxRuleRows({
    asOfDate: '2026-11-26',
    lang: 'en',
    copy,
    countryCatalog: {
      countries: [{ code: 'IL', name: 'Israel' }],
      country_packs: [{ id: 'pack-il', country_code: 'IL', name: 'Israel Base Pack', status: 'active' }],
      rulesets: [
        {
          id: 'ruleset-2026-01',
          country_pack_id: 'pack-il',
          ruleset_code: '2026.01',
          ruleset_version: '2026.01',
          status: 'active',
          effective_from: '2026-01-01',
          effective_to: null,
        },
      ],
    },
    legalRows: [
      {
        id: 'lv1',
        country_code: 'IL',
        value_key: 'il_standard_vat_rate',
        label: 'Israel standard VAT rate',
        category: 'VAT',
        module_scope: 'nodexpro_platform_sales',
        value_type: 'percentage',
        status: 'active',
        versions: [],
      },
    ],
  });
  const schedule = rows[0]?.actions.find((a) => a.action_key === 'schedule_tax_rate_change');
  assert.equal(schedule?.prefill.country_pack_ruleset_id, 'ruleset-2026-01');
});
