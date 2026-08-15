import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  buildIncomeDocumentEmailDeliveryBlock,
  buildIncomeDocumentEmailSendView,
  incomeEmailDeliveryAttemptCountLabel,
  resolveIncomeDocumentEmailSendDisabledUserMessage,
  resolveIncomeDocumentEmailSendEligibility,
} from '../../src/domains/income/income-document-email-delivery.read-model.pure.js';
import { hasCanonicalIncomeDocumentPdfAsset } from '../../src/domains/income/income-document-pdf-send-readiness.pure.js';
import { assertIncomeDocumentReadyForEmailSend } from '../../src/domains/income/income-document-email-delivery.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const routesSource = readFileSync(join(dir, '../../src/domains/income/income.routes.ts'), 'utf8');
const workspaceSource = readFileSync(
  join(dir, '../../src/domains/income/income-workspace-aggregate.service.ts'),
  'utf8',
);
const panelSource = readFileSync(
  join(dir, '../../src/domains/income/income-client-document-management-panel.service.ts'),
  'utf8',
);
const weDocsSource = readFileSync(
  join(
    dir,
    '../../src/domains/work-engine/work-engine-invoices-client-documents-by-type.read-model.service.ts',
  ),
  'utf8',
);
const typesSource = readFileSync(join(dir, '../../src/domains/income/income.types.ts'), 'utf8');

const officePerms = {
  view: true,
  edit: true,
  issue: true,
  issue_on_behalf: true,
};

test('email delivery block exposes attempt count, labels, and @ action', () => {
  const block = buildIncomeDocumentEmailDeliveryBlock({
    incomeDocumentId: 'a1111111-1111-4111-8111-111111111111',
    attemptCount: 2,
    permissions: officePerms,
    representedClientId: 'b2222222-2222-4222-8222-222222222222',
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: 'c3333333-3333-4333-8333-333333333333',
  });
  assert.equal(block.attempt_count, 2);
  assert.equal(block.status_label, incomeEmailDeliveryAttemptCountLabel(2));
  assert.equal(block.action.icon_key, 'at');
  assert.equal(block.action.enabled, true);
  assert.equal(block.send_enabled, true);
});

test('email send eligibility disabled in self mode', () => {
  const result = resolveIncomeDocumentEmailSendEligibility({
    permissions: officePerms,
    representedClientId: null,
    documentStatus: 'issued',
    pdfRenderStatus: 'rendered',
    pdfAssetId: 'c3333333-3333-4333-8333-333333333333',
  });
  assert.equal(result.enabled, false);
  assert.match(String(result.disabled_reason), /ניהול לקוח/);
});

test('income routes expose email history aggregates', () => {
  assert.match(routesSource, /document-email-history/);
  assert.match(routesSource, /represented-client-email-history/);
  assert.match(routesSource, /buildIncomeDocumentEmailHistoryAggregate/);
  assert.match(routesSource, /buildIncomeRepresentedClientEmailHistoryAggregate/);
});

test('document email history resolves office issuer scope for WE mismatch', () => {
  const historyServiceSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-email-history.service.ts'),
    'utf8',
  );
  assert.match(historyServiceSource, /resolveIssuerScopeForIssuedDocument/);
});

test('workspace issued rows include email_delivery block', () => {
  assert.match(workspaceSource, /email_delivery/);
  assert.match(workspaceSource, /loadEmailAttemptCountsByDocumentIds/);
  assert.match(workspaceSource, /buildIncomeDocumentEmailDeliveryBlock/);
});

test('client management panel includes @ email history action', () => {
  assert.match(panelSource, /open_email_history/);
  assert.match(panelSource, /icon_key: 'at'/);
  assert.match(panelSource, /INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY/);
});

test('work engine documents-by-type rows include email_delivery for issued docs', () => {
  assert.match(weDocsSource, /email_delivery/);
  assert.match(weDocsSource, /buildIncomeDocumentEmailDeliveryBlock/);
  assert.match(weDocsSource, /loadEmailAttemptCountsByDocumentIds/);
});

test('types define email history aggregates and delivery block', () => {
  assert.match(typesSource, /income_document_email_history_aggregate/);
  assert.match(typesSource, /income_represented_client_email_history_aggregate/);
  assert.match(typesSource, /IncomeDocumentEmailDeliveryBlock/);
  assert.match(typesSource, /email_delivery: IncomeDocumentEmailDeliveryBlock/);
  assert.match(typesSource, /IncomeDocumentEmailSendView/);
  assert.match(typesSource, /send_view: IncomeDocumentEmailSendView/);
  assert.match(typesSource, /income_document_email_history_aggregate\?: IncomeDocumentEmailHistoryAggregate/);
});

test('email send view uses backend labels and hides PDF internals', () => {
  const view = buildIncomeDocumentEmailSendView({
    documentTypeLabel: 'חשבונית מס',
    documentNumber: '4005',
    senderDisplayName: 'Test4',
    recipientDisplayName: 'NYC',
    sendEligibility: { enabled: true, disabled_reason_key: null, disabled_reason: null },
    emailFieldPresent: true,
    historyAvailable: false,
    pdfAssetId: randomUUID(),
  });
  assert.equal(view.title, 'שליחה במייל — חשבונית מס 4005');
  assert.equal(view.sender_label, 'מאת');
  assert.equal(view.sender_display_name, 'Test4');
  assert.equal(view.recipient_name_label, 'אל');
  assert.equal(view.recipient_display_name, 'NYC');
  assert.equal(view.document_label, 'מסמך');
  assert.equal(view.document_display, 'חשבונית מס 4005');
  assert.equal(view.attachment_ready, true);
  assert.equal(view.attachment_filename, 'חשבונית מס 4005.pdf');
  assert.equal(view.email_label, 'אימייל');
  assert.equal(view.email_editable, true);
  assert.equal(view.send_button_label, 'שליחה');
  assert.equal(view.send_disabled_user_message, null);
});

test('email send view maps PDF unreadiness to a short human message', () => {
  assert.equal(
    resolveIncomeDocumentEmailSendDisabledUserMessage({
      enabled: false,
      disabled_reason_key: 'pdf_failed',
      disabled_reason: 'הפקת קובץ ה-PDF נכשלה. ניתן לנסות שוב.',
    }),
    'לא ניתן לשלוח את המסמך כרגע.',
  );
  assert.equal(
    resolveIncomeDocumentEmailSendDisabledUserMessage({
      enabled: false,
      disabled_reason_key: 'pdf_pending',
      disabled_reason: 'ה-PDF בהכנה. ניתן לשלוח לאחר סיום ההפקה.',
    }),
    'לא ניתן לשלוח את המסמך כרגע.',
  );
  assert.match(
    String(
      resolveIncomeDocumentEmailSendDisabledUserMessage({
        enabled: false,
        disabled_reason_key: 'self_mode_not_allowed',
        disabled_reason: 'שליחה במייל זמינה במצב ניהול לקוח בלבד',
      }),
    ),
    /ניהול לקוח/,
  );
});

test('email history aggregate builder and send command return send_view without extra GET', () => {
  const historyServiceSource = readFileSync(
    join(dir, '../../src/domains/income/income-document-email-history.service.ts'),
    'utf8',
  );
  const commandsSource = readFileSync(
    join(dir, '../../src/domains/income/income-commands.service.ts'),
    'utf8',
  );
  assert.match(historyServiceSource, /buildIncomeDocumentEmailSendView/);
  assert.match(historyServiceSource, /customerDisplayNameFromSnapshot/);
  assert.match(historyServiceSource, /represented_client_label/);
  assert.match(commandsSource, /INCOME_COMMAND_SEND_DOCUMENT_BY_EMAIL/);
  assert.match(commandsSource, /buildIncomeDocumentEmailHistoryAggregate/);
  assert.match(commandsSource, /income_document_email_history_aggregate/);
});

test('email send is enabled when canonical pdf_asset_id exists despite stale/failed render status', () => {
  const assetId = randomUUID();
  assert.equal(hasCanonicalIncomeDocumentPdfAsset(assetId), true);
  for (const status of ['failed', 'pending', 'stale', 'rendered']) {
    const email = resolveIncomeDocumentEmailSendEligibility({
      permissions: officePerms,
      representedClientId: 'b2222222-2222-4222-8222-222222222222',
      documentStatus: 'issued',
      pdfRenderStatus: status,
      pdfAssetId: assetId,
    });
    assert.equal(email.enabled, true, `status=${status}`);
    assert.equal(email.disabled_reason_key, null, `status=${status}`);
    const view = buildIncomeDocumentEmailSendView({
      documentTypeLabel: 'חשבונית מס',
      documentNumber: '4007',
      senderDisplayName: 'Test4',
      recipientDisplayName: 'NYC',
      sendEligibility: email,
      emailFieldPresent: true,
      historyAvailable: false,
      pdfAssetId: assetId,
    });
    assert.equal(view.attachment_ready, true);
    assert.equal(view.attachment_filename, 'חשבונית מס 4007.pdf');
    assert.equal(view.send_disabled_user_message, null);
    assert.doesNotThrow(() =>
      assertIncomeDocumentReadyForEmailSend({
        document_status: 'issued',
        pdf_render_status: status,
        pdf_asset_id: assetId,
      } as never),
    );
  }
});

test('email send stays disabled and attachment is not ready when pdf_asset_id is missing', () => {
  const email = resolveIncomeDocumentEmailSendEligibility({
    permissions: officePerms,
    representedClientId: 'b2222222-2222-4222-8222-222222222222',
    documentStatus: 'issued',
    pdfRenderStatus: 'failed',
    pdfAssetId: null,
  });
  assert.equal(hasCanonicalIncomeDocumentPdfAsset(null), false);
  assert.equal(email.enabled, false);
  assert.equal(email.disabled_reason_key, 'pdf_failed');
  const view = buildIncomeDocumentEmailSendView({
    documentTypeLabel: 'חשבונית מס',
    documentNumber: '4007',
    senderDisplayName: 'Test4',
    recipientDisplayName: 'NYC',
    sendEligibility: email,
    emailFieldPresent: true,
    historyAvailable: false,
    pdfAssetId: null,
  });
  assert.equal(view.attachment_ready, false);
  assert.equal(view.attachment_filename, null);
  assert.equal(view.send_disabled_user_message, 'לא ניתן לשלוח את המסמך כרגע.');
  assert.throws(() =>
    assertIncomeDocumentReadyForEmailSend({
      document_status: 'issued',
      pdf_render_status: 'failed',
      pdf_asset_id: null,
    } as never),
  );
});
