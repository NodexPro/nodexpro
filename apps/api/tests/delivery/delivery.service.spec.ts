import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDeliveryService } from '../../src/domains/delivery/delivery.service.js';
import { DELIVERY_ATTEMPT_IMMUTABLE_FIELDS } from '../../src/domains/delivery/delivery.pure.js';
import type { DeliveryAttemptRepository } from '../../src/domains/delivery/delivery.repository.js';
import type {
  BeginDeliveryAttemptInput,
  DeliveryAttemptRecord,
  FinalizeDeliveryAttemptInput,
  ListDeliveryAttemptsFilter,
} from '../../src/domains/delivery/delivery.types.js';
import { randomUUID } from 'node:crypto';

const dir = dirname(fileURLToPath(import.meta.url));
const deliveryDir = join(dir, '../../src/domains/delivery');

function listDeliverySourceFiles(): string[] {
  return readdirSync(deliveryDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(deliveryDir, name));
}

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+['"].*\/income\//i,
  /from\s+['"].*\/payroll\//i,
  /from\s+['"].*\/vat\//i,
  /from\s+['"].*\/docflow\//i,
  /from\s+['"].*\/work-engine\//i,
  /work-engine\.reminder/i,
  /work_items/i,
  /work_reminder_candidates/i,
  /work-engine\.sla/i,
];

for (const filePath of listDeliverySourceFiles()) {
  const label = filePath.split(/[/\\]/).slice(-1)[0] ?? filePath;
  test(`delivery contract: ${label} has no forbidden module imports`, () => {
    const source = readFileSync(filePath, 'utf8');
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${label} must not import ${pattern}`);
    }
  });
}

test('delivery contract: service does not reference income document types', () => {
  const serviceSource = readFileSync(join(deliveryDir, 'delivery.service.ts'), 'utf8');
  const runtimeSource = readFileSync(join(deliveryDir, 'delivery.runtime.ts'), 'utf8');
  assert.doesNotMatch(serviceSource, /income_document/i);
  assert.doesNotMatch(runtimeSource, /income_document/i);
  assert.doesNotMatch(serviceSource, /tax_invoice/i);
});

class InMemoryDeliveryAttemptRepository implements DeliveryAttemptRepository {
  private rows = new Map<string, DeliveryAttemptRecord>();

  private key(orgId: string, idempotencyKey: string): string {
    return `${orgId}:${idempotencyKey}`;
  }

  async insertAttempt(input: BeginDeliveryAttemptInput): Promise<DeliveryAttemptRecord> {
    const existing = await this.findByIdempotencyKey(input.organizationId, input.idempotencyKey);
    if (existing) return existing;

    const now = new Date().toISOString();
    const row: DeliveryAttemptRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      representedClientId: input.representedClientId,
      sourceModule: input.sourceModule,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId,
      channel: input.channel,
      recipientEmail: input.recipientEmail ?? null,
      result: 'pending',
      failureReason: null,
      senderSnapshotJson: { ...input.senderSnapshotJson },
      messageSnapshotJson: { ...input.messageSnapshotJson },
      attachmentRefsJson: [...(input.attachmentRefsJson ?? [])],
      providerMessageId: null,
      docflowThreadId: null,
      docflowMessageId: null,
      idempotencyKey: input.idempotencyKey,
      sentByUserId: input.sentByUserId ?? null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<DeliveryAttemptRecord | null> {
    for (const row of this.rows.values()) {
      if (row.organizationId === organizationId && row.idempotencyKey === idempotencyKey.trim()) {
        return row;
      }
    }
    return null;
  }

  async findById(organizationId: string, attemptId: string): Promise<DeliveryAttemptRecord | null> {
    const row = this.rows.get(attemptId);
    if (!row || row.organizationId !== organizationId) return null;
    return row;
  }

  async finalizeAttempt(input: FinalizeDeliveryAttemptInput): Promise<DeliveryAttemptRecord> {
    const current = await this.findById(input.organizationId, input.attemptId);
    if (!current) throw new Error('not found');
    if (current.result !== 'pending') return current;

    const updated: DeliveryAttemptRecord = {
      ...current,
      result: input.result,
      failureReason: input.failureReason ?? null,
      providerMessageId: input.providerMessageId ?? null,
      docflowThreadId: input.docflowThreadId ?? null,
      docflowMessageId: input.docflowMessageId ?? null,
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(updated.id, updated);
    return updated;
  }

  async listAttempts(filter: ListDeliveryAttemptsFilter): Promise<DeliveryAttemptRecord[]> {
    let rows = [...this.rows.values()].filter((row) => row.organizationId === filter.organizationId);
    if (filter.representedClientId) {
      rows = rows.filter((row) => row.representedClientId === filter.representedClientId);
    }
    if (filter.sourceModule) {
      rows = rows.filter((row) => row.sourceModule === filter.sourceModule);
    }
    if (filter.sourceEntityType) {
      rows = rows.filter((row) => row.sourceEntityType === filter.sourceEntityType);
    }
    if (filter.sourceEntityId) {
      rows = rows.filter((row) => row.sourceEntityId === filter.sourceEntityId);
    }
    if (filter.channel) {
      rows = rows.filter((row) => row.channel === filter.channel);
    }
    rows.sort((a, b) => {
      const aSent = a.sentAt ?? a.createdAt;
      const bSent = b.sentAt ?? b.createdAt;
      return bSent.localeCompare(aSent);
    });
    const limit = filter.limit ?? 100;
    return rows.slice(0, limit);
  }
}

function baseBeginInput(overrides: Partial<BeginDeliveryAttemptInput> = {}): BeginDeliveryAttemptInput {
  return {
    organizationId: randomUUID(),
    representedClientId: randomUUID(),
    sourceModule: 'income',
    sourceEntityType: 'income_document',
    sourceEntityId: randomUUID(),
    channel: 'email',
    recipientEmail: 'ap@example.com',
    senderSnapshotJson: { business_name: 'Acme Ltd' },
    messageSnapshotJson: { subject: 'Invoice', body: 'Please see attached.' },
    attachmentRefsJson: [{ asset_id: randomUUID(), filename: 'invoice.pdf' }],
    idempotencyKey: randomUUID(),
    sentByUserId: randomUUID(),
    ...overrides,
  };
}

test('delivery service creates pending attempt', async () => {
  const service = createDeliveryService(new InMemoryDeliveryAttemptRepository());
  const input = baseBeginInput();
  const attempt = await service.beginAttempt(input);
  assert.equal(attempt.result, 'pending');
  assert.equal(attempt.recipientEmail, 'ap@example.com');
  assert.deepEqual(attempt.senderSnapshotJson, { business_name: 'Acme Ltd' });
  assert.equal(attempt.sentAt, null);
});

test('delivery service finalizes sent attempt', async () => {
  const service = createDeliveryService(new InMemoryDeliveryAttemptRepository());
  const attempt = await service.beginAttempt(baseBeginInput());
  const finalized = await service.finalizeAttempt({
    attemptId: attempt.id,
    organizationId: attempt.organizationId,
    result: 'sent',
    providerMessageId: 'provider-123',
  });
  assert.equal(finalized.result, 'sent');
  assert.equal(finalized.providerMessageId, 'provider-123');
  assert.ok(finalized.sentAt);
});

test('delivery service finalizes failed attempt', async () => {
  const service = createDeliveryService(new InMemoryDeliveryAttemptRepository());
  const attempt = await service.beginAttempt(baseBeginInput());
  const finalized = await service.finalizeAttempt({
    attemptId: attempt.id,
    organizationId: attempt.organizationId,
    result: 'failed',
    failureReason: 'email_provider_not_configured',
  });
  assert.equal(finalized.result, 'failed');
  assert.equal(finalized.failureReason, 'email_provider_not_configured');
});

test('delivery service returns same attempt for duplicate idempotency key', async () => {
  const repo = new InMemoryDeliveryAttemptRepository();
  const service = createDeliveryService(repo);
  const input = baseBeginInput({ idempotencyKey: 'same-key' });
  const first = await service.beginAttempt(input);
  const second = await service.beginAttempt({
    ...input,
    recipientEmail: 'other@example.com',
  });
  assert.equal(first.id, second.id);
  assert.equal(second.recipientEmail, 'ap@example.com');
});

test('delivery service lists attempts by represented client scope', async () => {
  const service = createDeliveryService(new InMemoryDeliveryAttemptRepository());
  const orgId = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  await service.beginAttempt(baseBeginInput({ organizationId: orgId, representedClientId: clientA }));
  await service.beginAttempt(baseBeginInput({ organizationId: orgId, representedClientId: clientB }));
  const rows = await service.listAttempts({ organizationId: orgId, representedClientId: clientA });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.representedClientId, clientA);
});

test('delivery service lists attempts by source entity', async () => {
  const service = createDeliveryService(new InMemoryDeliveryAttemptRepository());
  const orgId = randomUUID();
  const documentId = randomUUID();
  await service.beginAttempt(
    baseBeginInput({
      organizationId: orgId,
      sourceModule: 'income',
      sourceEntityType: 'income_document',
      sourceEntityId: documentId,
    }),
  );
  await service.beginAttempt(
    baseBeginInput({
      organizationId: orgId,
      sourceEntityId: randomUUID(),
    }),
  );
  const rows = await service.listAttempts({
    organizationId: orgId,
    sourceModule: 'income',
    sourceEntityType: 'income_document',
    sourceEntityId: documentId,
    channel: 'email',
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.sourceEntityId, documentId);
});

test('delivery snapshots are unchanged after finalize', async () => {
  const service = createDeliveryService(new InMemoryDeliveryAttemptRepository());
  const attempt = await service.beginAttempt(
    baseBeginInput({
      senderSnapshotJson: { business_name: 'Before' },
      messageSnapshotJson: { body: 'Body v1' },
    }),
  );
  const finalized = await service.finalizeAttempt({
    attemptId: attempt.id,
    organizationId: attempt.organizationId,
    result: 'sent',
  });
  assert.deepEqual(finalized.senderSnapshotJson, { business_name: 'Before' });
  assert.deepEqual(finalized.messageSnapshotJson, { body: 'Body v1' });
});

test('delivery migration defines immutable snapshot guard trigger', () => {
  const migration = readFileSync(
    join(dir, '../../../../supabase/migrations/145_delivery_attempts_foundation.sql'),
    'utf8',
  );
  assert.match(migration, /delivery_attempts_immutable_guard/);
  assert.match(migration, /sender_snapshot_json is distinct from NEW\.sender_snapshot_json/);
  assert.match(migration, /delivery_attempts_org_idempotency_key_unique/);
  assert.match(migration, /result is terminal/);
  assert.match(migration, /invalid result transition/);
});

test('delivery immutable fields constant matches migration guard columns', () => {
  const migration = readFileSync(
    join(dir, '../../../../supabase/migrations/145_delivery_attempts_foundation.sql'),
    'utf8',
  );
  for (const field of DELIVERY_ATTEMPT_IMMUTABLE_FIELDS) {
    assert.match(migration, new RegExp(`OLD\\.${field}`), `migration must guard ${field}`);
  }
});
