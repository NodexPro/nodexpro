import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

test('Client Operations surfaces sanitized API errors, never raw Postgres text', () => {
  const clientSrc = readFileSync(join(dir, '../src/api/client.ts'), 'utf8');
  const registrySrc = readFileSync(
    join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
    'utf8',
  );
  const caseSrc = readFileSync(join(dir, '../src/pages/ClientOperationsClientCase.tsx'), 'utf8');
  assert.match(clientSrc, /export function userFacingApiMessage/);
  assert.match(clientSrc, /duplicate key\|violates unique/);
  assert.match(clientSrc, /c === 'SUPABASE_ERROR'/);
  assert.match(registrySrc, /userFacingApiMessage\(e\)/);
  assert.match(registrySrc, /userFacingApiMessage\(err\)/);
  assert.match(caseSrc, /userFacingApiMessage\(e\)/);
  assert.doesNotMatch(caseSrc, /e instanceof Error \? e\.message/);
});
