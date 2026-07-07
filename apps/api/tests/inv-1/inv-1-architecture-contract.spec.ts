/**
 * INV-1 Phase 10 — architecture / security contract gates.
 *
 * Prevents drift across Delivery, Income, DocFlow, and Work Engine boundaries
 * after Email + DocFlow delivery + Work Engine fact consumption (P1–P9).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDeliveryService } from '../../src/domains/delivery/delivery.service.js';
import type { DeliveryAttemptRepository } from '../../src/domains/delivery/delivery.repository.js';
import type {
  BeginDeliveryAttemptInput,
  DeliveryAttemptRecord,
  FinalizeDeliveryAttemptInput,
} from '../../src/domains/delivery/delivery.types.js';
import { DELIVERY_ATTEMPT_IMMUTABLE_FIELDS } from '../../src/domains/delivery/delivery.pure.js';
import {
  buildIncomeDocumentDocflowDeliveryBlock,
} from '../../src/domains/income/income-document-docflow-delivery.read-model.pure.js';
import {
  buildIncomeDocumentEmailDeliveryBlock,
} from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const apiSrc = join(dir, '../../src/domains');
const migration145 = readFileSync(
  join(dir, '../../../../supabase/migrations/145_delivery_attempts_foundation.sql'),
  'utf8',
);

function readDomainFile(...parts: string[]): string {
  return readFileSync(join(apiSrc, ...parts), 'utf8');
}

function listTsFiles(domainDir: string): string[] {
  return readdirSync(domainDir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(domainDir, name));
}

const deliveryDir = join(apiSrc, 'delivery');
const docflowDir = join(apiSrc, 'docflow');
const workEngineDir = join(apiSrc, 'work-engine');

const officePerms = {
  view: true,
  edit: true,
  issue: true,
  issue_on_behalf: true,
};

// ---- Gate 1: Delivery boundary ----

const DELIVERY_FORBIDDEN = [
  /from\s+['"].*\/income\//i,
  /from\s+['"].*\/docflow\//i,
  /from\s+['"].*\/work-engine\//i,
  /work-engine\.reminder/i,
  /work_items/i,
  /work_reminder_candidates/i,
  /work-engine\.sla/i,
  /escalation/i,
];

for (const filePath of listTsFiles(deliveryDir)) {
  const label = filePath.split(/[/\\]/).slice(-1)[0] ?? filePath;
  test(`gate 1 delivery: ${label} has no forbidden imports`, () => {
    const source = readFileSync(filePath, 'utf8');
    for (const pattern of DELIVERY_FORBIDDEN) {
      assert.doesNotMatch(source, pattern, `${label} violates delivery boundary (${pattern})`);
    }
  });
}

test('gate 1 delivery: owns delivery_attempts ledger and generic transport only', () => {
  const service = readDomainFile('delivery', 'delivery.service.ts');
  const repo = readDomainFile('delivery', 'delivery.repository.ts');
  assert.match(service, /beginAttempt/);
  assert.match(service, /finalizeAttempt/);
  assert.match(repo, /delivery_attempts/);
  assert.doesNotMatch(service, /income_document/i);
});

// ---- Gate 2: Income boundary ----

const INCOME_DELIVERY_FILES = [
  'income-document-email-delivery.service.ts',
  'income-document-docflow-delivery.service.ts',
  'income-document-docflow-post.service.ts',
  'income-work-engine-bridge.ts',
];

const INCOME_FORBIDDEN_WRITES = [
  /\.from\(['"]work_items['"]\)/,
  /\.from\(['"]work_reminder/i,
  /escalation/i,
  /work-engine\.scheduler/i,
];

for (const file of INCOME_DELIVERY_FILES) {
  test(`gate 2 income: ${file} does not write Work Engine tables directly`, () => {
    const source = readDomainFile('income', file);
    for (const pattern of INCOME_FORBIDDEN_WRITES) {
      assert.doesNotMatch(source, pattern, `${file} must not write Work Engine state`);
    }
  });
}

test('gate 2 income: send commands delegate to delivery service and emit facts via bridge', () => {
  const commands = readDomainFile('income', 'income-commands.service.ts');
  const email = readDomainFile('income', 'income-document-email-delivery.service.ts');
  const docflow = readDomainFile('income', 'income-document-docflow-delivery.service.ts');
  const bridge = readDomainFile('income', 'income-work-engine-bridge.ts');

  assert.match(commands, /executeSendIncomeDocumentByEmail/);
  assert.match(commands, /executeSendIncomeDocumentByDocflow/);
  assert.match(email, /from '\.\.\/delivery\/index\.js'/);
  assert.match(docflow, /from '\.\.\/delivery\/index\.js'/);
  assert.match(email, /emitIncomeWorkEventAfterDocumentSentByEmail/);
  assert.match(docflow, /emitIncomeWorkEventAfterDocumentSentByDocflow/);
  assert.match(bridge, /intakeWorkEvent/);
  assert.doesNotMatch(bridge, /\.from\(['"]work_items['"]\)/);
});

// ---- Gate 3: DocFlow boundary ----

const DOCFLOW_FORBIDDEN = [
  /from\s+['"].*\/income\//i,
  /from\s+['"].*\/accounting-base\//i,
  /income_documents/i,
  /renderIncomeDocumentPdf/i,
  /income-document-pdf/i,
  /\.from\(['"]work_items['"]\)\s*\.insert/,
  /work_reminder_candidates/i,
  /work-engine\.sla/i,
];

for (const filePath of listTsFiles(docflowDir)) {
  const label = filePath.split(/[/\\]/).slice(-1)[0] ?? filePath;
  test(`gate 3 docflow: ${label} owns secure communication only`, () => {
    const source = readFileSync(filePath, 'utf8');
    for (const pattern of DOCFLOW_FORBIDDEN) {
      assert.doesNotMatch(source, pattern, `${label} violates docflow boundary (${pattern})`);
    }
  });
}

test('gate 3 docflow: work engine bridge uses intake only', () => {
  const bridge = readDomainFile('docflow', 'docflow-work-engine-bridge.ts');
  assert.match(bridge, /intakeWorkEvent/);
  assert.doesNotMatch(bridge, /\.from\(['"]work_items['"]\)/);
});

// ---- Gate 4: Work Engine boundary ----

test('gate 4 work engine: consumes facts and owns work_items transitions', () => {
  const intake = readDomainFile('work-engine', 'work-engine.event-intake.service.ts');
  const fact = readDomainFile('work-engine', 'work-engine-income-document-sent-fact.service.ts');
  assert.match(intake, /consumeIncomeDocumentSentFact/);
  assert.match(fact, /completeRecurringDocumentSendFollowupWorkItem/);
  assert.match(fact, /work_transitions/);
  assert.match(fact, /WORK_ITEM_STATE_CHANGED/);
});

test('gate 4 work engine: does not write delivery_attempts', () => {
  for (const filePath of listTsFiles(workEngineDir)) {
    const label = filePath.split(/[/\\]/).slice(-1)[0] ?? filePath;
    const source = readFileSync(filePath, 'utf8');
    assert.doesNotMatch(
      source,
      /delivery_attempts[\s\S]*\.insert/,
      `${label} must not insert delivery_attempts`,
    );
  }
});

test('gate 4 work engine: delivery_attempts read is isolated to retainer delivery seam', () => {
  const readers = listTsFiles(workEngineDir).filter((filePath) =>
    readFileSync(filePath, 'utf8').includes("from('delivery_attempts')"),
  );
  assert.deepEqual(
    readers.map((p) => p.split(/[/\\]/).slice(-1)[0]),
    ['work-engine-invoice-retainer-delivery.read.ts'],
  );
});

test('gate 4 work engine: invoice money columns are display reference only', () => {
  const tab = readDomainFile('work-engine', 'work-engine-invoices-tab.read-model.service.ts');
  assert.match(tab, /money_reference/);
  assert.match(tab, /amountReferenceFromTotalsSnapshot/);
  assert.doesNotMatch(tab, /accounting-base|accounting_entries/i);
});

// ---- Gate 5: Aggregate parity ----

test('gate 5 aggregate parity: workspace and WE invoices tab use same delivery block builders', () => {
  const workspace = readDomainFile('income', 'income-workspace-aggregate.service.ts');
  const weDocs = readDomainFile(
    'work-engine',
    'work-engine-invoices-client-documents-by-type.read-model.service.ts',
  );
  const types = readDomainFile('income', 'income.types.ts');

  for (const source of [workspace, weDocs, types]) {
    assert.match(source, /email_delivery/);
    assert.match(source, /docflow_delivery/);
  }
  assert.match(workspace, /buildIncomeDocumentEmailDeliveryBlock/);
  assert.match(workspace, /buildIncomeDocumentDocflowDeliveryBlock/);
  assert.match(weDocs, /buildIncomeDocumentEmailDeliveryBlock/);
  assert.match(weDocs, /buildIncomeDocumentDocflowDeliveryBlock/);
});

test('gate 5 aggregate parity: delivery blocks expose backend-owned labels and actions', () => {
  const docId = randomUUID();
  const clientId = randomUUID();
  const pdfId = randomUUID();
  const emailBlock = buildIncomeDocumentEmailDeliveryBlock({
    incomeDocumentId: docId,
    attemptCount: 0,
    permissions: officePerms,
    representedClientId: clientId,
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: pdfId,
  });
  const docflowBlock = buildIncomeDocumentDocflowDeliveryBlock({
    incomeDocumentId: docId,
    attemptCount: 0,
    permissions: officePerms,
    representedClientId: clientId,
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: pdfId,
    docflowEntitled: true,
    portalActive: true,
  });

  for (const block of [emailBlock, docflowBlock]) {
    assert.ok(typeof block.status_label === 'string' && block.status_label.length > 0);
    assert.ok(typeof block.action.label === 'string' && block.action.label.length > 0);
    assert.equal(typeof block.action.enabled, 'boolean');
    assert.ok('disabled_reason' in block.action);
    assert.equal(typeof block.send_enabled, 'boolean');
  }
});

test('gate 5 aggregate parity: send commands return refreshed income_workspace_aggregate', () => {
  const commands = readDomainFile('income', 'income-commands.service.ts');
  assert.match(
    commands,
    /INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL[\s\S]*commandResponse\(ctx, command\)/,
  );
  assert.match(
    commands,
    /INCOME_COMMAND_SEND_DOCUMENT_BY_DOCFLOW[\s\S]*commandResponse\(ctx, command\)/,
  );
  assert.match(commands, /buildIncomeWorkspaceAggregate/);
});

// ---- Gate 6: Security / tenant checks ----

const SEND_SERVICES = [
  'income-document-email-delivery.service.ts',
  'income-document-docflow-delivery.service.ts',
];

for (const file of SEND_SERVICES) {
  test(`gate 6 security: ${file} resolves org/client from issuer scope not spoofable body fields`, () => {
    const source = readDomainFile('income', file);
    assert.match(source, /loadActiveIncomeIssuerScope\(ctx\)/);
    assert.match(source, /assertRowMatchesIssuerScope\(scope, doc\)/);
    assert.match(source, /doc\.represented_client_id !== representedClientId/);
    assert.match(source, /loadIssuedDocumentFor(?:Email|Docflow)\(\s*scope\.org_id,\s*incomeDocumentId\)/);
    assert.match(source, /\.eq\('organization_id', orgId\)/);
    assert.match(source, /sentByUserId: scope\.actor_user_id/);
    assert.doesNotMatch(source, /body\.org_id/);
    assert.doesNotMatch(source, /body\.represented_client_id/);
    assert.doesNotMatch(source, /body\.actor_user_id/);
  });
}

// ---- Gate 7: Delivery attempt immutability ----

test('gate 7 immutability: migration trigger guards immutable snapshot fields', () => {
  assert.match(migration145, /delivery_attempts_immutable_guard/);
  assert.match(migration145, /immutable fields cannot be changed/);
  assert.match(migration145, /result is terminal/);
  assert.match(migration145, /invalid result transition/);
  for (const field of [
    'organization_id',
    'source_module',
    'source_entity_type',
    'source_entity_id',
    'channel',
    'sender_snapshot_json',
    'idempotency_key',
  ]) {
    assert.match(migration145, new RegExp(`OLD\\.${field}`));
  }
});

test('gate 7 immutability: DELIVERY_ATTEMPT_IMMUTABLE_FIELDS aligns with migration', () => {
  const snakeFields = DELIVERY_ATTEMPT_IMMUTABLE_FIELDS.map((f) => f);
  for (const field of snakeFields) {
    assert.match(migration145, new RegExp(`OLD\\.${field}`), `migration must guard ${field}`);
  }
});

// ---- Gate 8: Idempotency ----

class IdempotencyRepo implements DeliveryAttemptRepository {
  inserts = 0;
  private rows = new Map<string, DeliveryAttemptRecord>();

  async insertAttempt(input: BeginDeliveryAttemptInput): Promise<DeliveryAttemptRecord> {
    const existing = await this.findByIdempotencyKey(input.organizationId, input.idempotencyKey);
    if (existing) return existing;
    this.inserts += 1;
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

  async findByIdempotencyKey(orgId: string, key: string): Promise<DeliveryAttemptRecord | null> {
    for (const row of this.rows.values()) {
      if (row.organizationId === orgId && row.idempotencyKey === key.trim()) return row;
    }
    return null;
  }

  async findById(orgId: string, id: string): Promise<DeliveryAttemptRecord | null> {
    const row = this.rows.get(id);
    return row && row.organizationId === orgId ? row : null;
  }

  async finalizeAttempt(input: FinalizeDeliveryAttemptInput): Promise<DeliveryAttemptRecord> {
    const current = await this.findById(input.organizationId, input.attemptId);
    if (!current) throw new Error('not found');
    if (current.result !== 'pending') return current;
    const updated = {
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

  async listAttempts(): Promise<DeliveryAttemptRecord[]> {
    return [...this.rows.values()];
  }
}

test('gate 8 idempotency: delivery service does not duplicate attempts for same key', async () => {
  const repo = new IdempotencyRepo();
  const service = createDeliveryService(repo);
  const orgId = randomUUID();
  const base = {
    organizationId: orgId,
    representedClientId: randomUUID(),
    sourceModule: 'income',
    sourceEntityType: 'income_document',
    sourceEntityId: randomUUID(),
    channel: 'email' as const,
    recipientEmail: 'a@example.com',
    senderSnapshotJson: {},
    messageSnapshotJson: {},
    idempotencyKey: 'income:email:doc:click-1',
    sentByUserId: randomUUID(),
  };
  const first = await service.beginAttempt(base);
  const second = await service.beginAttempt({ ...base, channel: 'docflow' });
  assert.equal(first.id, second.id);
  assert.equal(repo.inserts, 1);
});

test('gate 8 idempotency: email and docflow orchestrators skip transport when attempt is terminal', () => {
  const email = readDomainFile('income', 'income-document-email-delivery.service.ts');
  const docflow = readDomainFile('income', 'income-document-docflow-delivery.service.ts');
  for (const source of [email, docflow]) {
    assert.match(source, /const idempotentReplay = attempt\.result !== 'pending'/);
    assert.match(source, /if \(!idempotentReplay\)/);
  }
});

test('gate 8 idempotency: duplicate fact intake skips duplicate transitions', () => {
  const intake = readDomainFile('work-engine', 'work-engine.event-intake.service.ts');
  const fact = readDomainFile('work-engine', 'work-engine-income-document-sent-fact.service.ts');
  assert.match(intake, /WORK_EVENT_DUPLICATE_SKIPPED/);
  assert.match(fact, /current\.work_state === 'done'/);
});
