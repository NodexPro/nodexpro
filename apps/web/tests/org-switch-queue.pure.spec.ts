import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createOfficeSwitchQueue,
  enqueueOfficeSwitch,
  nextOfficeSwitchCommand,
  resolveOfficeSwitchCommand,
  shouldApplyOfficeSwitchAggregate,
  simulateRapidOfficeSwitches,
} from '../src/lib/org-switch-queue.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

test('rapid A → B → A keeps the last confirmed office and does not paint B', () => {
  const result = simulateRapidOfficeSwitches(['org-a', 'org-b', 'org-a']);
  assert.deepEqual(result.commandsSent, ['org-a']);
  assert.deepEqual(result.appliedIds, ['org-a']);
  assert.deepEqual(result.discardedCommandIds, []);
  assert.equal(result.finalAppliedId, 'org-a');
  assert.equal(result.finalLatestRequestedId, null);
});

test('rapid A → B → C sends only A then C and applies C', () => {
  const result = simulateRapidOfficeSwitches(['org-a', 'org-b', 'org-c']);
  assert.deepEqual(result.commandsSent, ['org-a', 'org-c']);
  assert.deepEqual(result.appliedIds, ['org-c']);
  assert.deepEqual(result.discardedCommandIds, ['org-a']);
  assert.equal(result.finalAppliedId, 'org-c');
  assert.equal(result.finalLatestRequestedId, null);
  assert.equal(
    shouldApplyOfficeSwitchAggregate({
      commandOrganizationId: 'org-a',
      aggregateOrganizationId: 'org-a',
      latestRequestedId: 'org-c',
    }),
    false,
  );
  assert.equal(
    shouldApplyOfficeSwitchAggregate({
      commandOrganizationId: 'org-c',
      aggregateOrganizationId: 'org-c',
      latestRequestedId: 'org-c',
    }),
    true,
  );
});

test('a resolved command for an older office never transplants permissions onto the latest office', () => {
  let queue = createOfficeSwitchQueue();
  queue = enqueueOfficeSwitch(queue, 'org-a');
  queue = nextOfficeSwitchCommand(queue).queue;
  queue = enqueueOfficeSwitch(queue, 'org-b');
  const stale = resolveOfficeSwitchCommand(queue, {
    commandOrganizationId: 'org-a',
    aggregateOrganizationId: 'org-a',
  });
  assert.equal(stale.apply, false);
  assert.equal(stale.followLatest, true);
  assert.equal(stale.queue.appliedId, null);
  const next = nextOfficeSwitchCommand(stale.queue);
  assert.equal(next.send, 'org-b');
  const latest = resolveOfficeSwitchCommand(next.queue, {
    commandOrganizationId: 'org-b',
    aggregateOrganizationId: 'org-b',
  });
  assert.equal(latest.apply, true);
  assert.equal(latest.queue.appliedId, 'org-b');
  assert.equal(
    shouldApplyOfficeSwitchAggregate({
      commandOrganizationId: 'org-a',
      aggregateOrganizationId: 'org-a',
      latestRequestedId: 'org-b',
    }),
    false,
  );
});

test('AuthContext serializes select_active_organization and follows the latest requested office', () => {
  const auth = readFileSync(join(dir, '../src/contexts/AuthContext.tsx'), 'utf8');
  assert.match(auth, /shouldApplyOfficeSwitchAggregate/);
  assert.match(auth, /orgSwitchLatestRef/);
  assert.match(auth, /drainOfficeSwitch/);
  assert.match(auth, /AUTH\.selectActiveOrgCommand/);
  assert.match(auth, /organization_id: target/);
  assert.doesNotMatch(auth, /overlaySessionActiveOrganization/);
});
