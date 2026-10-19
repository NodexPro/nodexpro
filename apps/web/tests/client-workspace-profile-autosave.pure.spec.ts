import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIENT_PROFILE_AUTOSAVE_DEBOUNCE_MS,
  CLIENT_PROFILE_BUSINESS_TYPE_VALUES,
  buildClientProfileUpdatePayload,
  clientProfileBusinessTypeSelectOptions,
  clientProfileDraftsEqual,
  clientProfileNeedsLeaveGuard,
  createClientProfileAutosaver,
  decideAfterProfileSave,
  draftFromClientOperationsCase,
  hydrateClientProfileBusinessType,
  shouldIgnoreStaleProfileResponse,
  shouldSkipClientProfileSave,
  validateClientProfileDraft,
  type ClientProfileDraft,
} from '../src/components/client-workspace-profile-autosave.pure.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const panelSrc = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');
const registrySrc = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);

function sample(over: Partial<ClientProfileDraft> = {}): ClientProfileDraft {
  return {
    client_name: 'חברה',
    government_id: '512345678',
    business_type: 'עוסק מורשה',
    status: 'active',
    contact_person: 'ישראל',
    phone: '0500000000',
    email: '',
    address_text: 'רחוב 1 · תל אביב',
    assigned_handler_user_id: 'u1',
    ended_at: '',
    ...over,
  };
}

test('debounce is 700–900 ms and the named update_profile command is reused', () => {
  assert.ok(CLIENT_PROFILE_AUTOSAVE_DEBOUNCE_MS >= 700 && CLIENT_PROFILE_AUTOSAVE_DEBOUNCE_MS <= 900);
  assert.match(panelSrc, /CLIENT_PROFILE_AUTOSAVE_DEBOUNCE_MS/);
  assert.match(panelSrc, /createClientProfileAutosaver/);
  assert.match(panelSrc, /moduleClientOperationsUpdateClientProfile/);
  assert.match(panelSrc, /method:\s*'POST'/);
  assert.doesNotMatch(panelSrc, /method:\s*'PATCH'/);
  assert.doesNotMatch(panelSrc, />\s*שמירה\s*</);
  assert.doesNotMatch(panelSrc, />\s*ביטול\s*</);
  assert.match(panelSrc, /clientProfileSaveStateLabelHe/);
  assert.match(panelSrc, /נסה שוב/);
  assert.match(panelSrc, /beforeunload/);
  assert.match(panelSrc, /clientProfileNeedsLeaveGuard/);
  assert.match(panelSrc, /previous\.flush\(\)/);
  assert.match(registrySrc, /onClientProfileSaved=\{reloadRegistry\}/);
  assert.doesNotMatch(registrySrc, /onSaveSuccess=\{\(\) => \{\s*setModalOpen\(false\)/);
});

test('validation preserves the same required contact/business rules', () => {
  assert.equal(validateClientProfileDraft(sample()).ok, true);
  const missing = validateClientProfileDraft(sample({ business_type: '', phone: '', email: '' }));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.messageHe, /סוג עסק/);
});

test('empty business type stays empty; עוסק פטור and other allowed types hydrate and validate', () => {
  assert.equal(hydrateClientProfileBusinessType(null), '');
  assert.equal(hydrateClientProfileBusinessType(''), '');
  assert.equal(hydrateClientProfileBusinessType('—'), '');
  assert.equal(hydrateClientProfileBusinessType('עוסק פטור'), 'עוסק פטור');
  assert.equal(hydrateClientProfileBusinessType('\u00a0עוסק פטור\u00a0'), 'עוסק פטור');
  for (const value of CLIENT_PROFILE_BUSINESS_TYPE_VALUES) {
    assert.equal(hydrateClientProfileBusinessType(value), value);
    assert.equal(validateClientProfileDraft(sample({ business_type: value })).ok, true);
    assert.ok(clientProfileBusinessTypeSelectOptions(value).includes(value));
  }
  const emptyDraft = draftFromClientOperationsCase({
    client: { client_name: 'חדש', tax_id: '1', status: 'active', phone: '0500000000' },
    profile: { business_type: null, assigned_handler_user_id: null },
    primary_contact: null,
  });
  assert.equal(emptyDraft.business_type, '');
  const emptyCheck = validateClientProfileDraft(emptyDraft);
  assert.equal(emptyCheck.ok, false);
  if (!emptyCheck.ok) assert.match(emptyCheck.messageHe, /סוג עסק/);
  const patur = draftFromClientOperationsCase({
    client: { client_name: 'פטור', tax_id: '1', status: 'active', phone: '0500000000' },
    profile: { business_type: 'עוסק פטור', assigned_handler_user_id: null },
    primary_contact: null,
  });
  assert.equal(patur.business_type, 'עוסק פטור');
  assert.equal(validateClientProfileDraft(patur).ok, true);
  assert.equal(buildClientProfileUpdatePayload(patur).business_type, 'עוסק פטור');
  const dashPlaceholder = draftFromClientOperationsCase({
    client: { client_name: 'רשימה', tax_id: '1', status: 'active', phone: '0500000000' },
    profile: { business_type: '—', assigned_handler_user_id: null },
    primary_contact: null,
  });
  assert.equal(dashPlaceholder.business_type, '');
});

test('business-type control does not use a disabled empty option that browsers display as עוסק פטור', () => {
  assert.match(panelSrc, /clientProfileBusinessTypeSelectOptions/);
  assert.match(panelSrc, /hydrateClientProfileBusinessType/);
  assert.match(panelSrc, /נא לבחור/);
  assert.doesNotMatch(
    panelSrc.slice(panelSrc.indexOf('aria-label="סוג עסק"')),
    /<option value="" disabled>/,
  );
  const allowed = readFileSync(
    join(dir, '../../api/src/domains/client-operations/client-operations.service.ts'),
    'utf8',
  );
  assert.match(
    allowed,
    /const ALLOWED_BUSINESS_TYPES = new Set\(\['עוסק פטור', 'עוסק מורשה', 'חברה', 'תאגיד', 'אחר'\]\)/,
  );
  assert.deepEqual([...CLIENT_PROFILE_BUSINESS_TYPE_VALUES], [
    'עוסק פטור',
    'עוסק מורשה',
    'חברה',
    'תאגיד',
    'אחר',
  ]);
});

test('unchanged draft is not saved; newer local edits are not replaced by a stale response', () => {
  const a = sample();
  assert.equal(shouldSkipClientProfileSave(a, a), true);
  assert.equal(shouldSkipClientProfileSave(sample({ phone: '0501111111' }), a), false);
  assert.equal(decideAfterProfileSave(a, a), 'apply_aggregate');
  assert.equal(decideAfterProfileSave(a, sample({ phone: '0501111111' })), 'keep_local_and_resave');
  assert.equal(shouldIgnoreStaleProfileResponse('c1', 'c2'), true);
  assert.equal(shouldIgnoreStaleProfileResponse('c1', 'c1'), false);
});

test('payload matches the existing update_profile body and round-trips from the case aggregate', () => {
  const draft = sample({ ended_at: '2026-04-01' });
  const payload = buildClientProfileUpdatePayload(draft);
  assert.equal(payload.address, draft.address_text);
  assert.equal(payload.ended_at, '2026-04-01');
  const fromCase = draftFromClientOperationsCase({
    client: {
      client_name: 'חברה',
      tax_id: '512345678',
      status: 'active',
      phone: '0500000000',
      email: null,
      address: 'רחוב 1',
      city: 'תל אביב',
      ended_at: '2026-04-01T00:00:00.000Z',
    },
    profile: { business_type: 'עוסק מורשה', assigned_handler_user_id: 'u1' },
    primary_contact: { full_name: 'ישראל', phone: '0500000000', email: null },
  });
  assert.ok(clientProfileDraftsEqual(fromCase, { ...draft, ended_at: '2026-04-01' }));
});

test('serialized pump sends the latest draft after overlapping edits and never confirms a stale snapshot', async () => {
  const sent: string[] = [];
  const confirmed: string[] = [];
  let releaseFirst!: () => void;
  const firstHold = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const saver = createClientProfileAutosaver({
    initial: sample(),
    debounceMs: 0,
    save: async (draft) => {
      sent.push(draft.phone);
      if (sent.length === 1) await firstHold;
    },
    onConfirmed: (draft) => {
      confirmed.push(draft.phone);
    },
    onState: () => undefined,
  });
  saver.change(sample({ phone: '0501111111' }));
  const flushed = saver.flush();
  saver.change(sample({ phone: '0502222222' }));
  releaseFirst();
  const ok = await flushed;
  assert.equal(ok, true);
  assert.deepEqual(sent, ['0501111111', '0502222222']);
  assert.deepEqual(confirmed, ['0502222222']);
});

test('validation and network failures keep the draft and allow retry', async () => {
  const invalid = sample({ business_type: '', phone: '', email: '' });
  const saver = createClientProfileAutosaver({
    initial: sample(),
    debounceMs: 0,
    save: async () => {
      throw new Error('network');
    },
    onState: () => undefined,
  });
  saver.change(invalid);
  assert.equal(await saver.flush(), false);
  assert.equal(saver.getLatest().business_type, '');
  assert.equal(saver.getState().status, 'error');
  assert.match(String(saver.getState().error), /סוג עסק/);

  const net = createClientProfileAutosaver({
    initial: sample(),
    debounceMs: 0,
    save: async () => {
      throw new Error('network');
    },
    onState: () => undefined,
  });
  net.change(sample({ phone: '0509999999' }));
  assert.equal(await net.flush(), false);
  assert.equal(net.getLatest().phone, '0509999999');
  assert.equal(net.isDirty(), true);
  assert.equal(net.getState().error, 'network');
});

test('dispose does not fire-and-forget; flush after dispose still persists leftover edits', async () => {
  let saves = 0;
  const saver = createClientProfileAutosaver({
    initial: sample(),
    debounceMs: 30_000,
    save: async () => {
      saves += 1;
    },
    onState: () => undefined,
  });
  saver.change(sample({ phone: '0501111111' }));
  saver.dispose();
  assert.equal(saves, 0);
  assert.equal(saver.isDirty(), true);
  assert.equal(await saver.flush(), true);
  assert.equal(saves, 1);
});

test('leave guard covers pending, saving, dirty, and failed saves only', () => {
  assert.equal(clientProfileNeedsLeaveGuard({ status: 'idle', error: null }, false), false);
  assert.equal(clientProfileNeedsLeaveGuard({ status: 'saved', error: null }, false), false);
  assert.equal(clientProfileNeedsLeaveGuard({ status: 'pending', error: null }, true), true);
  assert.equal(clientProfileNeedsLeaveGuard({ status: 'saving', error: null }, true), true);
  assert.equal(clientProfileNeedsLeaveGuard({ status: 'error', error: 'network' }, true), true);
  assert.equal(clientProfileNeedsLeaveGuard({ status: 'idle', error: null }, true), true);
});

test('switching clients ignores a stale aggregate and keeps the newer local draft', async () => {
  const confirmed: string[] = [];
  const sent: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saver = createClientProfileAutosaver({
    initial: sample(),
    debounceMs: 0,
    save: async (draft) => {
      sent.push(draft.phone);
      await hold;
    },
    onConfirmed: (draft) => {
      confirmed.push(draft.phone);
    },
    onState: () => undefined,
  });
  saver.change(sample({ phone: '0501111111' }));
  const first = saver.flush();
  saver.change(sample({ phone: '0503333333' }));
  saver.dispose();
  const joined = saver.flush();
  release();
  assert.equal(await first, true);
  assert.equal(await joined, true);
  assert.deepEqual(confirmed, []);
  assert.deepEqual(sent, ['0501111111', '0503333333']);
  assert.equal(saver.getLatest().phone, '0503333333');
  assert.equal(shouldIgnoreStaleProfileResponse('client-a', 'client-b'), true);
});
