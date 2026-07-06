import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sendEmail } from '../../src/domains/delivery/delivery-email.transport.js';
import type { DeliveryEmailTransportDeps } from '../../src/domains/delivery/delivery-email.transport.js';
import type { DeliveryEmailEnvelope } from '../../src/domains/delivery/delivery-email.types.js';
import type { EmailDeliveryAdapter, EmailSendInput } from '../../src/shared/email-delivery.adapter.js';
import type { OwnerEmailProviderConfigResolved } from '../../src/shared/owner-email-provider-config.service.js';
import { validateDeliveryEmailEnvelope } from '../../src/domains/delivery/delivery-email.pure.js';
import { randomUUID } from 'node:crypto';

const dir = dirname(fileURLToPath(import.meta.url));
const deliveryDir = join(dir, '../../src/domains/delivery');

test('delivery email transport source has no forbidden module imports', () => {
  const source = readFileSync(join(deliveryDir, 'delivery-email.transport.ts'), 'utf8');
  assert.doesNotMatch(source, /from\s+['"].*\/docflow\//i);
  assert.doesNotMatch(source, /from\s+['"].*\/income\//i);
  assert.doesNotMatch(source, /invoice/i);
});

function baseEnvelope(overrides: Partial<DeliveryEmailEnvelope> = {}): DeliveryEmailEnvelope {
  return {
    organizationId: randomUUID(),
    to: 'recipient@example.com',
    subject: 'Subject',
    body_text: 'Plain body',
    body_html: '<p>HTML body</p>',
    ...overrides,
  };
}

function mockProviderConfig(): OwnerEmailProviderConfigResolved {
  return {
    providerType: 'resend',
    providerDisplayName: 'Resend',
    fromEmail: 'noreply@example.com',
    fromName: 'Example',
    apiKey: 'test-key',
    smtp: { host: null, port: null, user: null, password: null },
    customApi: {
      apiEndpointUrl: null,
      httpMethod: 'POST',
      authType: null,
      authHeaderName: null,
      recipientField: null,
      subjectField: null,
      htmlBodyField: null,
      textBodyField: null,
      staticHeaders: {},
      staticPayload: {},
      successResponsePath: null,
      errorResponsePath: null,
    },
    isConfigured: true,
  };
}

function mockDeps(handler: (input: EmailSendInput) => Promise<{ providerMessageId: string | null }>): DeliveryEmailTransportDeps {
  return {
    resolveProvider: async () => mockProviderConfig(),
    createAdapter: () =>
      ({
        sendEmail: handler,
      }) as EmailDeliveryAdapter,
    sendViaAdapter: (adapter, input) => adapter.sendEmail(input),
  };
}

test('sendEmail returns sent with provider_message_id', async () => {
  const captured: EmailSendInput[] = [];
  const result = await sendEmail(
    baseEnvelope({
      reply_to: 'reply@example.com',
      attachments: [{ filename: 'doc.pdf', content_type: 'application/pdf', content_base64: 'aGVsbG8=' }],
    }),
    mockDeps(async (input) => {
      captured.push(input);
      return { providerMessageId: 'msg-123' };
    }),
  );
  assert.equal(result.status, 'sent');
  assert.equal(result.provider_message_id, 'msg-123');
  assert.equal(result.failure_reason, null);
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.reply_to, 'reply@example.com');
  assert.equal(captured[0]?.attachments?.[0]?.filename, 'doc.pdf');
});

test('sendEmail returns failed when provider is not configured', async () => {
  const result = await sendEmail(baseEnvelope(), {
    resolveProvider: async () => null,
    createAdapter: () => ({ sendEmail: async () => ({ providerMessageId: null }) }) as EmailDeliveryAdapter,
    sendViaAdapter: (adapter, input) => adapter.sendEmail(input),
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_reason, 'email_provider_not_configured');
});

test('sendEmail returns failed when adapter throws', async () => {
  const result = await sendEmail(
    baseEnvelope(),
    mockDeps(async () => {
      throw new Error('email_send_failed:provider_timeout');
    }),
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_reason, 'provider_timeout');
});

test('validateDeliveryEmailEnvelope requires recipient and body', () => {
  assert.throws(() => validateDeliveryEmailEnvelope(baseEnvelope({ to: '' })));
  assert.throws(() =>
    validateDeliveryEmailEnvelope(baseEnvelope({ body_text: '', body_html: '' })),
  );
});

test('shared email adapter is re-exported by docflow without logic duplication', () => {
  const docflowAdapter = readFileSync(
    join(dir, '../../src/domains/docflow/email-delivery.adapter.ts'),
    'utf8',
  );
  assert.match(docflowAdapter, /shared\/email-delivery\.adapter/);
});
