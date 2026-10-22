import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideOtpSmsDelivery,
  logTextContainsSecrets,
  paymentOtpUnconfiguredLogMessage,
} from '../../src/shared/sensitive-logging.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const SYNTHETIC_OTP = '847291';
const SYNTHETIC_PHONE = '+972500000000';

test('production fails closed without Twilio and never embeds OTP or phone in the skip log', () => {
  const prod = decideOtpSmsDelivery({
    nodeEnv: 'production',
    twilioConfigured: false,
    allowDevSkip: true,
  });
  assert.equal(prod.action, 'fail_closed');
  const skip = paymentOtpUnconfiguredLogMessage();
  assert.equal(logTextContainsSecrets(skip, [SYNTHETIC_OTP, SYNTHETIC_PHONE]), false);
  assert.doesNotMatch(skip, /\d{6}/);
});

test('non-production skip log is redacted; Twilio path is send_sms', () => {
  const skip = decideOtpSmsDelivery({
    nodeEnv: 'development',
    twilioConfigured: false,
    allowDevSkip: true,
  });
  assert.equal(skip.action, 'dev_skip');
  if (skip.action === 'dev_skip') {
    assert.equal(logTextContainsSecrets(skip.log, [SYNTHETIC_OTP, SYNTHETIC_PHONE, 'Bearer ']), false);
  }
  assert.deepEqual(
    decideOtpSmsDelivery({ nodeEnv: 'production', twilioConfigured: true, allowDevSkip: false }),
    { action: 'send_sms' },
  );
});

test('payment-card service no longer logs OTP or phone when Twilio is unset', () => {
  const src = readFileSync(
    join(dir, '../../src/domains/client-operations/payment-card-access.service.ts'),
    'utf8',
  );
  assert.doesNotMatch(src, /OTP for \$\{toPhone\}: \$\{code\}/);
  assert.match(src, /decideOtpSmsDelivery/);
  assert.match(src, /SMS_PROVIDER_NOT_CONFIGURED/);
});
