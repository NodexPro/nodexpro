import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnerAddCountryControl } from '../src/pages/owner-add-country-control.tsx';
import { OwnerBusinessSetupAiWorkspace } from '../src/pages/owner-business-setup-ai-workspace.tsx';
import { OwnerCountryContextPanel } from '../src/pages/owner-country-context-panel.tsx';
import {
  mergeOwnerCountrySelectorOptions,
  ownerIsoRegionPickerOptions,
} from '../src/pages/owner-iso-country-options.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

test('global country selector options are a union of backend lists only', () => {
  const merged = mergeOwnerCountrySelectorOptions(
    [{ code: 'IL', name: 'Israel' }],
    [{ code: 'us', name: 'United States' }, { code: 'IL', name: 'IL' }],
  );
  assert.deepEqual(merged, [
    { code: 'IL', name: 'Israel' },
    { code: 'US', name: 'United States' },
  ]);
  assert.equal(merged.some((row) => row.code === 'DE'), false);
});

test('ISO picker is presentation-only and excludes existing backend countries', () => {
  const options = ownerIsoRegionPickerOptions(['IL']);
  assert.ok(options.length > 0);
  assert.equal(options.some((row) => row.code === 'IL'), false);
  assert.ok(options.every((row) => /^[A-Z]{2}$/.test(row.code)));
  assert.ok(options.some((row) => row.code === 'US'));
});

test('+ Add Country renders only when create_country is enabled by the aggregate', () => {
  const hiddenMissing = renderToStaticMarkup(
    createElement(OwnerAddCountryControl, {
      action: null,
      existingCountryCodes: ['IL'],
      busy: false,
      onSubmit: async () => undefined,
    }),
  );
  const hiddenDisabled = renderToStaticMarkup(
    createElement(OwnerAddCountryControl, {
      action: { action_key: 'create_country', enabled: false },
      existingCountryCodes: ['IL'],
      busy: false,
      onSubmit: async () => undefined,
    }),
  );
  const visible = renderToStaticMarkup(
    createElement(OwnerAddCountryControl, {
      action: { action_key: 'create_country', enabled: true },
      existingCountryCodes: ['IL'],
      busy: false,
      onSubmit: async () => undefined,
    }),
  );
  assert.equal(hiddenMissing, '');
  assert.equal(hiddenDisabled, '');
  assert.match(visible, /\+ Add Country/);
  assert.match(visible, /data-action-key="create_country"/);
  assert.doesNotMatch(visible, /create_country_pack/);
});

test('workspace country selector does not invent countries absent from the aggregate', () => {
  const html = renderToStaticMarkup(
    createElement(OwnerBusinessSetupAiWorkspace, {
      activeSection: 'tax-knowledge',
      onSelectSection: () => undefined,
      countryCode: 'IL',
      countries: [{ code: 'IL', name: 'Israel' }],
      countryBusy: false,
      onSelectCountry: () => undefined,
      addCountryControl: createElement(OwnerAddCountryControl, {
        action: { action_key: 'create_country', enabled: true },
        existingCountryCodes: ['IL'],
        busy: false,
        onSubmit: async () => undefined,
      }),
      warningCount: 0,
      warningsOpen: false,
      onToggleWarnings: () => undefined,
      warnings: [],
      error: '',
      children: null,
    }),
  );
  assert.match(html, /IL — Israel/);
  assert.match(html, /\+ Add Country/);
  assert.doesNotMatch(html, /DE —/);
  assert.doesNotMatch(html, /Country context/);
});

test('country workspace hides unrelated country packs when a country is selected', () => {
  const html = renderToStaticMarkup(
    createElement(OwnerCountryContextPanel, {
      countries: [
        { code: 'IL', name: 'Israel' },
        { code: 'US', name: 'United States' },
      ],
      packs: [
        { id: 'pack-il', country_code: 'IL', pack_code: 'il-core', name: 'Israel core', status: 'enabled' },
        { id: 'pack-us', country_code: 'US', pack_code: 'us-core', name: 'US core', status: 'draft' },
      ],
      rulesets: [
        { id: 'rs-il', country_pack_id: 'pack-il', ruleset_code: 'il-2026', ruleset_version: '1', status: 'active' },
        { id: 'rs-us', country_pack_id: 'pack-us', ruleset_code: 'us-2026', ruleset_version: '1', status: 'draft' },
      ],
      countryPackActions: [
        { action_key: 'create_country', enabled: true },
        { action_key: 'create_country_pack', enabled: true },
      ],
      emptyRulesetCreateActions: [],
      busy: false,
      selectedCountryCode: 'IL',
      onOpenCommand: () => undefined,
      onToggleCountryPack: () => undefined,
    }),
  );
  assert.match(html, /il-core/);
  assert.match(html, /il-2026/);
  assert.doesNotMatch(html, /us-core/);
  assert.doesNotMatch(html, /us-2026/);
  assert.match(html, /Create Country Pack|create_country_pack|Create Country Pack/i);
  assert.doesNotMatch(html, />Add Country</);
});

test('Add Country UI dispatches create_country only and does not invent a pack', () => {
  const add = readRepo('apps/web/src/pages/owner-add-country-control.tsx');
  const page = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');
  assert.match(add, /onSubmit\(commandKey, payload\)/);
  assert.match(add, /code: nextCode, name: nextName/);
  assert.doesNotMatch(add, /create_country_pack/);
  assert.doesNotMatch(add, /status:/);
  assert.match(page, /OwnerAddCountryControl/);
  assert.match(page, /setPanel\(refreshed\)/);
  assert.doesNotMatch(page, /create_country[\s\S]{0,200}create_country_pack/);
  assert.doesNotMatch(page, /localCountries|setCountries\(/);
});

test('professional AppShell and session nav never include owner workspace links', () => {
  const app = readRepo('apps/web/src/App.tsx');
  const shell = readRepo('apps/web/src/components/layout/AppShell.tsx');
  const auth = readRepo('apps/api/src/domains/auth/auth.routes.ts');
  const page = readRepo('apps/web/src/pages/PlatformOwnerLegalControl.tsx');

  assert.match(app, /path="\/platform-owner\/legal-control"/);
  assert.match(app, /<Route path="\/" element=\{<RequireAuth><RequireOrg><AppShell/);
  const navBlockStart = auth.indexOf('const navItems');
  const navBlockEnd = auth.indexOf('moduleAppNavItems.sort');
  assert.ok(navBlockStart >= 0 && navBlockEnd > navBlockStart);
  const navBlock = auth.slice(navBlockStart, navBlockEnd);
  assert.doesNotMatch(navBlock, /platform-owner|legal-control/);
  assert.doesNotMatch(shell, /platform-owner|legal-control|Country Pack|Knowledge Trainer/);
  assert.match(page, /Access denied/);
  assert.match(page, /This page is available only for platform owner/);
  assert.match(page, /isForbidden/);
});
