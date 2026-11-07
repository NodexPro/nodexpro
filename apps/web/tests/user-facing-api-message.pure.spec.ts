import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  USER_FACING_API_MESSAGE_KEYS,
  lookupNestedMessage,
  resolveUserFacingApiMessage,
  userFacingApiMessageKey,
} from '../src/lib/user-facing-api-message.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const en = JSON.parse(readFileSync(join(root, 'src/i18n/en.json'), 'utf8')) as unknown;
const he = JSON.parse(readFileSync(join(root, 'src/i18n/he.json'), 'utf8')) as unknown;

function lookup(locale: string, key: string): string | undefined {
  return lookupNestedMessage(locale === 'he' ? he : en, key);
}

function api(status: number, code?: string, message = ''): { status: number; code?: string; message: string } {
  return { status, code, message };
}

test('401/403/5xx/network use common.errors keys, not DocFlow Hebrew in English', () => {
  assert.equal(userFacingApiMessageKey(api(401, 'UNAUTHORIZED')), USER_FACING_API_MESSAGE_KEYS.unauthorized);
  assert.equal(userFacingApiMessageKey(api(403, 'FORBIDDEN')), USER_FACING_API_MESSAGE_KEYS.forbidden);
  assert.equal(userFacingApiMessageKey(api(500, 'SUPABASE_ERROR')), USER_FACING_API_MESSAGE_KEYS.serverError);
  assert.equal(userFacingApiMessageKey(new Error('Failed to fetch')), USER_FACING_API_MESSAGE_KEYS.network);

  const unauthorizedEn = resolveUserFacingApiMessage(api(401, 'UNAUTHORIZED'), 'en', lookup);
  assert.equal(unauthorizedEn, 'Your session expired. Sign in again.');
  assert.doesNotMatch(unauthorizedEn, /DocFlow|[\u0590-\u05FF]/);

  const forbiddenEn = resolveUserFacingApiMessage(api(403, 'FORBIDDEN'), 'en', lookup);
  assert.equal(forbiddenEn, 'You do not have permission to perform this action.');
  assert.doesNotMatch(forbiddenEn, /[\u0590-\u05FF]/);

  const serverEn = resolveUserFacingApiMessage(api(500, 'SUPABASE_ERROR', 'שגיאת שרת זמנית'), 'en', lookup);
  assert.equal(serverEn, 'Temporary server error. Try again in a moment; if it continues, contact support.');
  assert.doesNotMatch(serverEn, /[\u0590-\u05FF]/);

  const networkEn = resolveUserFacingApiMessage(new Error('Failed to fetch'), 'en', lookup);
  assert.equal(networkEn, 'Network problem. Check your internet connection and try again.');
});

test('Hebrew UI still receives Hebrew 401/403/5xx/network copy', () => {
  assert.equal(
    resolveUserFacingApiMessage(api(401, 'UNAUTHORIZED'), 'he', lookup),
    'פג תוקף ההתחברות. יש להיכנס מחדש.',
  );
  assert.equal(
    resolveUserFacingApiMessage(api(403, 'FORBIDDEN'), 'he', lookup),
    'אין הרשאה לביצוע הפעולה.',
  );
  assert.equal(
    resolveUserFacingApiMessage(api(500, 'SUPABASE_ERROR'), 'he', lookup),
    'שגיאת שרת זמנית. נסה שוב בעוד רגע; אם זה חוזר — פנה לתמיכה.',
  );
  assert.equal(
    resolveUserFacingApiMessage(new Error('Failed to fetch'), 'he', lookup),
    'בעיית תקשורת. בדוק חיבור לאינטרנט ונסה שוב.',
  );
});

test('DocFlow portal codes stay portal-specific and follow locale', () => {
  const expiredEn = resolveUserFacingApiMessage(api(401, 'PORTAL_SESSION_EXPIRED'), 'en', lookup);
  assert.match(expiredEn, /DocFlow access link has expired/);
  assert.doesNotMatch(expiredEn, /[\u0590-\u05FF]/);
  const expiredHe = resolveUserFacingApiMessage(api(401, 'PORTAL_SESSION_EXPIRED'), 'he', lookup);
  assert.match(expiredHe, /DocFlow/);
  assert.match(expiredHe, /[\u0590-\u05FF]/);
});

test('Work Engine version conflict copy stays English in EN and does not change the API code', () => {
  assert.equal(userFacingApiMessageKey(api(409, 'WORK_ITEM_VERSION_CONFLICT')), USER_FACING_API_MESSAGE_KEYS.workItemVersionConflict);
  assert.equal(
    resolveUserFacingApiMessage(api(409, 'WORK_ITEM_VERSION_CONFLICT'), 'en', lookup),
    'Item was updated. Refreshing...',
  );
});

test('501 keeps locale-matching server detail and rejects Hebrew in English', () => {
  const heDetail = resolveUserFacingApiMessage(api(501, 'NOT_IMPLEMENTED', 'ה-PDF עדיין לא מוכן'), 'he', lookup);
  assert.equal(heDetail, 'ה-PDF עדיין לא מוכן');
  const enGeneric = resolveUserFacingApiMessage(api(501, 'NOT_IMPLEMENTED', 'ה-PDF עדיין לא מוכן'), 'en', lookup);
  assert.equal(enGeneric, 'This action is not available yet. Try a different format.');
  const enDetail = resolveUserFacingApiMessage(api(501, 'NOT_IMPLEMENTED', 'PDF is not ready yet'), 'en', lookup);
  assert.equal(enDetail, 'PDF is not ready yet');
});

test('common.errors keys exist in bundled EN and HE dictionaries', () => {
  for (const key of Object.values(USER_FACING_API_MESSAGE_KEYS)) {
    assert.ok(lookup('en', key), `missing EN ${key}`);
    assert.ok(lookup('he', key), `missing HE ${key}`);
    assert.doesNotMatch(String(lookup('en', key)), /[\u0590-\u05FF]/);
    assert.match(String(lookup('he', key)), /[\u0590-\u05FF]/);
  }
});

test('office API helper uses existing i18n lookup and no longer hardcodes Hebrew 401 copy', () => {
  const client = readFileSync(join(root, 'src/api/client.ts'), 'utf8');
  assert.match(client, /resolveUserFacingApiMessage/);
  assert.match(client, /peekPublishedTranslationOverlay/);
  assert.match(client, /common\.errors|lookupUserFacingApiMessage/);
  assert.doesNotMatch(client, /סשן ה-DocFlow אינו תקף/);
  assert.doesNotMatch(client, /אין הרשאה לביצוע הפעולה/);
});
