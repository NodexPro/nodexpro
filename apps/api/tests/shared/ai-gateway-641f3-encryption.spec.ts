import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../src/shared/errors.js';
import { decryptJson, encryptJson } from '../../src/shared/field-encryption.js';
import {
  AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE,
  decryptAiGatewayJson,
  encryptAiGatewayJson,
  getAiGatewayEncryptionEnvDiagnostic,
  isAiGatewayEncryptionNotConfiguredError,
} from '../../src/shared/ai-gateway/ai-gateway.encryption.js';
import { parseCredentialPayload, sanitizeAiGatewayAuditPayload } from '../../src/domains/ai-gateway-control-plane/ai-gateway-control-plane.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

function withEnv(patch: Record<string, string | undefined>, run: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    const next = patch[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    run();
  } finally {
    for (const key of Object.keys(patch)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

function validKey(fill = 11): string {
  return Buffer.alloc(32, fill).toString('base64');
}

test('TAX-641F3 valid 32-byte AI key encrypts and decrypts an AI credential', () => {
  withEnv({ AI_GATEWAY_ENCRYPTION_KEY: validKey(), CLIENT_DATA_ENCRYPTION_KEY: undefined }, () => {
    const parsed = parseCredentialPayload({
      ai_provider_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      credential: 'sk-test-not-returned',
    });
    const ciphertext = encryptAiGatewayJson({ value: parsed.credential });
    assert.notEqual(ciphertext, 'sk-test-not-returned');
    assert.doesNotMatch(ciphertext, /sk-test-not-returned/);
    const roundTrip = decryptAiGatewayJson<{ value: string }>(ciphertext);
    assert.equal(roundTrip.value, 'sk-test-not-returned');
  });
});

test('TAX-641F3 missing, malformed, and 24-byte AI keys fail closed', () => {
  withEnv({ AI_GATEWAY_ENCRYPTION_KEY: undefined, CLIENT_DATA_ENCRYPTION_KEY: validKey(3) }, () => {
    const missing = getAiGatewayEncryptionEnvDiagnostic();
    assert.equal(missing.env_set, false);
    assert.equal(missing.valid_for_aes256, false);
    assert.throws(
      () => encryptAiGatewayJson({ value: 'sk-test-not-returned' }),
      (error: unknown) =>
        error instanceof AppError &&
        error.statusCode === 503 &&
        error.code === AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE &&
        isAiGatewayEncryptionNotConfiguredError(error),
    );
  });
  withEnv({ AI_GATEWAY_ENCRYPTION_KEY: '%%%not-base64%%%' }, () => {
    const malformed = getAiGatewayEncryptionEnvDiagnostic();
    assert.equal(malformed.env_set, true);
    assert.equal(malformed.decoded_length_bytes, null);
    assert.equal(malformed.valid_for_aes256, false);
    assert.throws(
      () => encryptAiGatewayJson({ value: 'sk-test-not-returned' }),
      (error: unknown) => error instanceof AppError && error.code === AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE,
    );
  });
  withEnv({ AI_GATEWAY_ENCRYPTION_KEY: Buffer.alloc(24, 9).toString('base64') }, () => {
    const shortKey = getAiGatewayEncryptionEnvDiagnostic();
    assert.equal(shortKey.env_set, true);
    assert.equal(shortKey.decoded_length_bytes, 24);
    assert.equal(shortKey.valid_for_aes256, false);
    assert.throws(
      () => decryptAiGatewayJson('AAAA'),
      (error: unknown) => error instanceof AppError && error.code === AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE,
    );
  });
});

test('TAX-641F3 AI Gateway encryption never reads CLIENT_DATA_ENCRYPTION_KEY', () => {
  const helper = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.encryption.ts');
  assert.match(helper, /AI_GATEWAY_ENCRYPTION_KEY/);
  assert.doesNotMatch(helper, /CLIENT_DATA_ENCRYPTION_KEY/);
  assert.match(helper, /aes256GcmEncryptJson/);
  assert.match(helper, /aes256GcmDecryptJson/);
  withEnv(
    {
      CLIENT_DATA_ENCRYPTION_KEY: validKey(5),
      AI_GATEWAY_ENCRYPTION_KEY: undefined,
    },
    () => {
      assert.throws(
        () => encryptAiGatewayJson({ value: 'sk-must-not-use-client-key' }),
        (error: unknown) => error instanceof AppError && error.code === AI_GATEWAY_ENCRYPTION_NOT_CONFIGURED_CODE,
      );
    },
  );
});

test('TAX-641F3 generic encryption users remain on CLIENT_DATA_ENCRYPTION_KEY', () => {
  const field = readRepo('apps/api/src/shared/field-encryption.ts');
  const tax = readRepo('apps/api/src/domains/client-operations/client-tax-settings.service.ts');
  const accounting = readRepo('apps/api/src/domains/client-operations/client-accounting-tab.service.ts');
  const email = readRepo('apps/api/src/shared/owner-email-provider-config.service.ts');
  const otp = readRepo('apps/api/src/domains/client-operations/payment-card-access.service.ts');
  const ownerOtp = readRepo('apps/api/src/domains/auth/platform-owner-password-recovery.service.ts');
  assert.match(field, /CLIENT_DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(field, /AI_GATEWAY_ENCRYPTION_KEY/);
  assert.match(tax, /encryptJson/);
  assert.match(accounting, /encryptJson/);
  assert.match(email, /encryptJson/);
  assert.match(otp, /CLIENT_DATA_ENCRYPTION_KEY/);
  assert.match(ownerOtp, /CLIENT_DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(tax, /encryptAiGatewayJson/);
  assert.doesNotMatch(accounting, /encryptAiGatewayJson/);
  assert.doesNotMatch(email, /encryptAiGatewayJson/);
  withEnv(
    {
      AI_GATEWAY_ENCRYPTION_KEY: validKey(8),
      CLIENT_DATA_ENCRYPTION_KEY: undefined,
    },
    () => {
      assert.throws(() => encryptJson({ password: 'must-not-use-ai-key' }), (error: unknown) => {
        return error instanceof AppError && error.code === 'ENCRYPTION_NOT_CONFIGURED';
      });
    },
  );
  withEnv(
    {
      CLIENT_DATA_ENCRYPTION_KEY: validKey(4),
      AI_GATEWAY_ENCRYPTION_KEY: undefined,
    },
    () => {
      const ciphertext = encryptJson({ password: 'generic-secret' });
      assert.doesNotMatch(ciphertext, /generic-secret/);
      assert.equal(decryptJson<{ password: string }>(ciphertext).password, 'generic-secret');
    },
  );
});

test('TAX-641F3 AI credential paths use the dedicated key and keep plaintext out of aggregate/audit', () => {
  const commands = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-commands.service.ts',
  );
  const probe = readRepo(
    'apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-connection-test.service.ts',
  );
  const routing = readRepo('apps/api/src/shared/ai-gateway/ai-gateway.owner-routing.ts');
  const read = readRepo('apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane-read.service.ts');
  const types = readRepo('apps/api/src/domains/ai-gateway-control-plane/ai-gateway-control-plane.types.ts');
  const example = readRepo('apps/api/.env.example');
  const renderEnv = readRepo('apps/api/RENDER_ENV.md');

  assert.match(commands, /encryptAiGatewayJson\(\{ value: parsed\.credential \}\)/);
  const encryptAt = commands.indexOf('encryptAiGatewayJson');
  const writeAt = commands.indexOf('credential_ciphertext: ciphertext');
  assert.equal(encryptAt > 0 && writeAt > encryptAt, true);
  assert.doesNotMatch(commands, /from '\.\.\/\.\.\/shared\/field-encryption/);
  assert.doesNotMatch(commands, /encryptJson/);
  assert.doesNotMatch(commands, /CLIENT_DATA_ENCRYPTION_KEY/);

  assert.match(probe, /decryptAiGatewayJson/);
  assert.match(probe, /isAiGatewayEncryptionNotConfiguredError/);
  assert.doesNotMatch(probe, /decryptJson/);
  assert.doesNotMatch(probe, /CLIENT_DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(probe, /field-encryption/);

  assert.match(routing, /decryptAiGatewayJson/);
  assert.match(routing, /isAiGatewayEncryptionNotConfiguredError/);
  assert.doesNotMatch(routing, /decryptJson/);
  assert.doesNotMatch(routing, /CLIENT_DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(routing, /field-encryption/);

  const cardBlock = types.slice(
    types.indexOf('export type OwnerAiGatewayProviderCard'),
    types.indexOf('export type OwnerAiGatewayAggregate'),
  );
  assert.match(read, /credential_configured: Boolean/);
  assert.doesNotMatch(cardBlock, /credential_ciphertext/);
  const cleaned = sanitizeAiGatewayAuditPayload({
    credential: 'sk-live-must-not-appear',
    api_key: 'secret',
    credential_ciphertext: 'blob',
    ai_provider_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  assert.equal('credential' in cleaned, false);
  assert.equal('api_key' in cleaned, false);
  assert.equal('credential_ciphertext' in cleaned, false);
  assert.doesNotMatch(JSON.stringify(cleaned), /sk-live/);

  assert.match(example, /AI_GATEWAY_ENCRYPTION_KEY=/);
  assert.match(example, /Do NOT reuse CLIENT_DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(example, /AI_GATEWAY_ENCRYPTION_KEY=.+/);
  assert.match(renderEnv, /AI_GATEWAY_ENCRYPTION_KEY/);
  assert.match(renderEnv, /Do not reuse `CLIENT_DATA_ENCRYPTION_KEY`/);
});
