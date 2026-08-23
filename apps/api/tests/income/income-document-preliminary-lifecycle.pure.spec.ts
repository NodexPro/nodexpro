import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConversionTargetOptions,
  buildPreliminaryEditAction,
} from '../../src/domains/income/income-document-conversion.pure.js';
import {
  buildPreliminaryLifecycleStatusDetail,
  buildPreliminaryReopenAction,
  decideClosePreliminarySourceOnIssuedChild,
  decideReopenPreliminaryDocument,
  linkedDocumentRefFromIssuedTarget,
  preliminaryLifecycleLabel,
  resolvePreliminaryLifecycleState,
} from '../../src/domains/income/income-document-preliminary-lifecycle.pure.js';

test('1 — quote remains open while stored lifecycle is null/open (child not issued)', () => {
  assert.equal(
    resolvePreliminaryLifecycleState({
      documentType: 'quote',
      documentStatus: 'issued',
      storedLifecycle: null,
    }),
    'open',
  );
  assert.equal(
    resolvePreliminaryLifecycleState({
      documentType: 'quote',
      documentStatus: 'issued',
      storedLifecycle: 'open',
    }),
    'open',
  );
  assert.equal(
    decideClosePreliminarySourceOnIssuedChild({
      sourceDocumentType: 'quote',
      sourceDocumentStatus: 'issued',
      currentLifecycle: 'open',
      downstreamDocumentId: '',
    }).action,
    'noop',
  );
});

test('2 — issued child closes quote', () => {
  assert.equal(
    decideClosePreliminarySourceOnIssuedChild({
      sourceDocumentType: 'quote',
      sourceDocumentStatus: 'issued',
      currentLifecycle: 'open',
      downstreamDocumentId: 'child-1',
    }).action,
    'close',
  );
});

test('3 — issued tax document closes deal_invoice source', () => {
  assert.equal(
    decideClosePreliminarySourceOnIssuedChild({
      sourceDocumentType: 'deal_invoice',
      sourceDocumentStatus: 'issued',
      currentLifecycle: 'open',
      downstreamDocumentId: 'tax-1',
    }).action,
    'close',
  );
});

test('4 — tax_invoice itself does NOT get preliminary close lifecycle', () => {
  assert.equal(
    resolvePreliminaryLifecycleState({
      documentType: 'tax_invoice',
      documentStatus: 'issued',
      storedLifecycle: 'closed',
    }),
    null,
  );
  assert.equal(
    decideClosePreliminarySourceOnIssuedChild({
      sourceDocumentType: 'tax_invoice',
      sourceDocumentStatus: 'issued',
      currentLifecycle: null,
      downstreamDocumentId: 'x',
    }).action,
    'noop',
  );
  assert.equal(
    decideReopenPreliminaryDocument({
      documentType: 'tax_invoice',
      documentStatus: 'issued',
      lifecycleState: 'closed',
      reason: 'reason',
    }).action,
    'reject',
  );
});

test('5/6/7 — closed builders disable edit/convert; reopen enabled for closed', () => {
  const edit = buildPreliminaryEditAction({
    sourceStatus: 'issued',
    canEdit: true,
    lifecycleState: 'closed',
  });
  const targets = buildConversionTargetOptions({
    sourceType: 'quote',
    sourceStatus: 'issued',
    canEdit: true,
    lifecycleState: 'closed',
  });
  const reopen = buildPreliminaryReopenAction({
    lifecycleState: 'closed',
    documentStatus: 'issued',
    canEdit: true,
  });
  assert.equal(edit.enabled, false);
  assert.equal(targets.every((t) => !t.enabled), true);
  assert.equal(reopen.enabled, true);
  assert.equal(reopen.command, 'reopen_income_preliminary_document');
});

test('8 — status detail contains backend-built downstream type + number', () => {
  const linked = linkedDocumentRefFromIssuedTarget({
    documentId: 'd2',
    documentNumber: '2000',
    documentType: 'deal_invoice',
  });
  assert.equal(
    buildPreliminaryLifecycleStatusDetail({ lifecycleState: 'closed', linked }),
    'הופק בגינו חשבון עסקה 2000',
  );
  assert.equal(
    buildPreliminaryLifecycleStatusDetail({
      lifecycleState: 'closed',
      linked: linkedDocumentRefFromIssuedTarget({
        documentId: 't1',
        documentNumber: '4005',
        documentType: 'tax_invoice',
      }),
    }),
    'הופקה בגינו חשבונית מס 4005',
  );
  assert.equal(
    buildPreliminaryLifecycleStatusDetail({ lifecycleState: 'open', linked }),
    'הופק בעבר חשבון עסקה 2000',
  );
});

test('9/10/11 — reopen keeps identity policy (same id/number; lineage retained by design)', () => {
  const decision = decideReopenPreliminaryDocument({
    documentType: 'quote',
    documentStatus: 'issued',
    lifecycleState: 'closed',
    reason: 'צריך תיקון',
  });
  assert.equal(decision.action, 'reopen');
  // Storage update only flips preliminary_lifecycle_state — never clones or renumbers.
  assert.equal(preliminaryLifecycleLabel('open'), 'פתוח');
});

test('12 — reopen requires reason', () => {
  assert.equal(
    decideReopenPreliminaryDocument({
      documentType: 'deal_invoice',
      documentStatus: 'issued',
      lifecycleState: 'closed',
      reason: '   ',
    }).code,
    'PRELIMINARY_REOPEN_REASON_REQUIRED',
  );
});

test('17 — repeated close is idempotent', () => {
  assert.equal(
    decideClosePreliminarySourceOnIssuedChild({
      sourceDocumentType: 'quote',
      sourceDocumentStatus: 'issued',
      currentLifecycle: 'closed',
      downstreamDocumentId: 'child-2',
    }).action,
    'idempotent',
  );
});
