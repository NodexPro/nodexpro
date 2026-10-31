import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../src/middleware/api-security.ts'),
  'utf8',
);

test('API class limiter always consumes the shared bucket — no local allow coalescing', () => {
  assert.match(src, /consume_security_rate_bucket/);
  assert.doesNotMatch(src, /consumeLocalRateQuota|seedLocalRateQuota|allow_local|LOCAL_RATE_COALESCE/);
});
