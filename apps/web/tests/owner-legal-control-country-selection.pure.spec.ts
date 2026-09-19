import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ownerCountryCodeFromSearch,
  replaceOwnerLegalControlCountrySearch,
  resolveOwnerSelectedCountryCode,
  shouldApplyOwnerLegalControlPanelResponse,
} from '../src/pages/owner-legal-control-country-selection.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

const PAGE = 'apps/web/src/pages/PlatformOwnerLegalControl.tsx';

test('Owner country selection never invents the first sorted country', () => {
  const page = readRepo(PAGE);
  assert.match(page, /resolveOwnerSelectedCountryCode/);
  assert.match(page, /persistOwnerCountrySelection/);
  assert.match(page, /ownerCountryCodeFromSearch\(location\.search\)/);
  assert.doesNotMatch(page, /countryOptions\[0\]/);
  assert.doesNotMatch(page, /startsWith\(['"]cp-verify/);

  const firstSorted = [{ code: 'HP', name: 'Haiti' }, { code: 'IL', name: 'Israel' }];
  void firstSorted;
  assert.equal(
    resolveOwnerSelectedCountryCode({
      pendingCountryCode: '',
      explicitCountryCode: '',
      backendSelectedCountryCode: null,
      backendDefaultCountryCode: null,
    }),
    '',
  );
});

test('selecting IL remains IL and does not fall back to HP', () => {
  assert.equal(
    resolveOwnerSelectedCountryCode({
      pendingCountryCode: 'IL',
      explicitCountryCode: 'HP',
      backendSelectedCountryCode: 'HP',
    }),
    'IL',
  );
  assert.equal(
    resolveOwnerSelectedCountryCode({
      pendingCountryCode: null,
      explicitCountryCode: 'IL',
      backendSelectedCountryCode: 'HP',
    }),
    'IL',
  );
});

test('stale HP aggregate response cannot replace a newer IL selection', () => {
  assert.equal(
    shouldApplyOwnerLegalControlPanelResponse({
      requestSeq: 1,
      latestSeq: 2,
      requestedCountryCode: 'HP',
      explicitCountryCode: 'IL',
    }),
    false,
  );
  assert.equal(
    shouldApplyOwnerLegalControlPanelResponse({
      requestSeq: 1,
      latestSeq: 1,
      aborted: true,
      requestedCountryCode: 'HP',
      explicitCountryCode: 'IL',
    }),
    false,
  );
  assert.equal(
    shouldApplyOwnerLegalControlPanelResponse({
      requestSeq: 2,
      latestSeq: 2,
      requestedCountryCode: 'HP',
      explicitCountryCode: 'IL',
    }),
    false,
  );
  assert.equal(
    shouldApplyOwnerLegalControlPanelResponse({
      requestSeq: 2,
      latestSeq: 2,
      requestedCountryCode: 'IL',
      explicitCountryCode: 'IL',
    }),
    true,
  );

  const page = readRepo(PAGE);
  assert.match(page, /AbortController/);
  assert.match(page, /shouldApplyOwnerLegalControlPanelResponse/);
  assert.match(page, /loadSeqRef/);
});

test('refresh and persisted URL query restore the explicit IL selection', () => {
  const search = replaceOwnerLegalControlCountrySearch('', 'IL');
  assert.equal(search, '?tax_knowledge_country_code=IL&strategy_engine_country_code=IL');
  assert.equal(ownerCountryCodeFromSearch(search), 'IL');
  assert.equal(
    ownerCountryCodeFromSearch('?tax_knowledge_country_code=IL&strategy_engine_country_code=IL#tax-knowledge'),
    'IL',
  );
  assert.equal(replaceOwnerLegalControlCountrySearch(search, 'IL'), search);

  const page = readRepo(PAGE);
  assert.match(page, /replaceOwnerLegalControlCountrySearch/);
  assert.match(page, /search: location\.search/);
  assert.match(page, /ownerCountryCodeFromSearch\(location\.search\)/);
});

test('empty selection stays explicit when no backend or default country exists', () => {
  assert.equal(ownerCountryCodeFromSearch(''), '');
  assert.equal(replaceOwnerLegalControlCountrySearch('?tax_knowledge_country_code=HP', ''), '');
  assert.equal(
    resolveOwnerSelectedCountryCode({
      pendingCountryCode: null,
      explicitCountryCode: '',
      backendSelectedCountryCode: null,
      backendDefaultCountryCode: undefined,
    }),
    '',
  );
  assert.equal(
    resolveOwnerSelectedCountryCode({
      pendingCountryCode: null,
      explicitCountryCode: '',
      backendSelectedCountryCode: 'IL',
    }),
    'IL',
  );
});
