import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHttpJsonText } from '../src/lib/parse-http-json.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

test('204 and empty success do not parse JSON; invalid bodies stay errors', () => {
  assert.equal(parseHttpJsonText({ ok: true, status: 204, text: '' }).kind, 'empty_success');
  assert.equal(parseHttpJsonText({ ok: true, status: 205, text: '   ' }).kind, 'empty_success');
  assert.equal(parseHttpJsonText({ ok: true, status: 200, text: '' }).kind, 'invalid_json');
  assert.equal(parseHttpJsonText({ ok: true, status: 200, text: '{' }).kind, 'invalid_json');
  assert.deepEqual(parseHttpJsonText({ ok: true, status: 200, text: '{"ok":true}' }), {
    kind: 'json',
    value: { ok: true },
  });
  assert.equal(parseHttpJsonText({ ok: false, status: 403, text: '' }).kind, 'empty_error');
  assert.equal(parseHttpJsonText({ ok: true, status: 200, text: '{}', aborted: true }).kind, 'abort');
});

test('apiJson no longer calls Response.json on Core logout 204', () => {
  const client = read('../src/api/client.ts');
  const auth = read('../src/contexts/AuthContext.tsx');
  assert.match(client, /parseHttpJsonText/);
  assert.match(client, /readResponseJson/);
  assert.doesNotMatch(client, /if \(res\.ok\) \{\s*const payload = \(await res\.json\(\)\)/);
  assert.match(auth, /AUTH\.logout/);
  assert.match(auth, /signOut\(deviceSignOutOptions\(\)\)\.catch/);
  assert.doesNotMatch(auth, /signOut\(\s*\)/);
});

test('logout stays local; GoTrue 403 after Core revoke is not a second Core logout', () => {
  const auth = read('../src/contexts/AuthContext.tsx');
  const device = read('../src/lib/device-session.pure.ts');
  const apiLogout = read('../../api/src/domains/auth/auth.routes.ts');
  assert.match(device, /scope: 'local'/);
  assert.match(auth, /deviceSignOutOptions\(\)/);
  assert.doesNotMatch(auth, /scope:\s*'global'|scope:\s*"global"/);
  assert.match(apiLogout, /router\.post\('\/logout'/);
  assert.match(apiLogout, /status\(204\)\.send\(\)/);
  assert.match(apiLogout, /scope:\s*'local'|signOut\([^)]*'local'/);
});
