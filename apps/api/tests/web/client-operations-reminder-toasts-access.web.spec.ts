/**
 * Global ReminderToasts must not call CO /reminders/due without session module + permission.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CLIENT_OPERATIONS_MODULE_CODE,
  CLIENT_OPERATIONS_REMINDERS_VIEW_PERMISSION,
  isClientOperationsReminderToastsEnabled,
} from '../../../web/src/lib/client-operations-reminder-toasts-access.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(dir, '../../../web/src');

function readWeb(relPath: string): string {
  return readFileSync(join(webRoot, relPath), 'utf8');
}

test('enabled module + client_operations.view → ReminderToasts enabled', () => {
  assert.equal(
    isClientOperationsReminderToastsEnabled({
      enabledModules: [CLIENT_OPERATIONS_MODULE_CODE],
      permissions: [CLIENT_OPERATIONS_REMINDERS_VIEW_PERMISSION],
    }),
    true,
  );
});

test('enabled module without client_operations.view → ReminderToasts disabled', () => {
  assert.equal(
    isClientOperationsReminderToastsEnabled({
      enabledModules: [CLIENT_OPERATIONS_MODULE_CODE],
      permissions: [],
    }),
    false,
  );
});

test('client_operations.view without enabled module → ReminderToasts disabled', () => {
  assert.equal(
    isClientOperationsReminderToastsEnabled({
      enabledModules: ['work_engine'],
      permissions: [CLIENT_OPERATIONS_REMINDERS_VIEW_PERMISSION],
    }),
    false,
  );
});

test('AppShell gates ReminderToasts through session module + permission helper', () => {
  const appShell = readWeb('components/layout/AppShell.tsx');
  assert.match(appShell, /isClientOperationsReminderToastsEnabled\(/);
  assert.match(appShell, /enabledModules:\s*me\.enabledModules/);
  assert.match(appShell, /permissions:\s*me\.permissions/);
  assert.match(appShell, /<ReminderToasts enabled=\{reminderEnabled\} \/>/);
});

test('disabled ReminderToasts does not fetch /reminders/due', () => {
  const reminderToasts = readWeb('components/ReminderToasts.tsx');
  assert.match(reminderToasts, /if \(!enabled\) return/);
  assert.match(reminderToasts, /if \(!enabled \|\| fetchInFlight\.current\) return/);
  assert.match(reminderToasts, /moduleClientOperationsRemindersDue\(\)/);
});
