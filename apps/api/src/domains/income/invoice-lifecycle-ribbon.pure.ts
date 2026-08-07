/**
 * INV-2B — lifecycle ribbon presentation (pure). Does not own truth; maps INV-2A dimensions only.
 */

import type {
  InvoiceLifecycleAggregate,
  InvoiceLifecycleRibbonStage,
  InvoiceLifecycleRibbonStageKey,
  InvoiceLifecycleRibbonStageState,
} from './invoice-lifecycle.types.js';

const RIBBON_LABELS: Record<InvoiceLifecycleRibbonStageKey, string> = {
  draft: 'טיוטה',
  issued: 'הופק',
  sent: 'נשלח',
  delivered: 'נמסר',
  payment: 'תשלום',
  overdue: 'באיחור',
  credited: 'זוכה',
  voided: 'בוטל',
  closed: 'סגור',
};

function stage(
  key: InvoiceLifecycleRibbonStageKey,
  state: InvoiceLifecycleRibbonStageState,
  completed: boolean,
  current: boolean,
): InvoiceLifecycleRibbonStage {
  return {
    key,
    label: RIBBON_LABELS[key],
    state,
    completed,
    current,
  };
}

type RibbonInput = Pick<
  InvoiceLifecycleAggregate,
  'document' | 'delivery' | 'payment' | 'due' | 'finalization'
>;

/**
 * Presentation-only ribbon. Exactly one stage may be `current` among tracked stages.
 * Unavailable / not_tracked stages never become current.
 */
export function composeInvoiceLifecycleRibbon(input: RibbonInput): InvoiceLifecycleRibbonStage[] {
  const draftCompleted =
    input.document.document_state_key === 'issued' || Boolean(input.document.source_draft_id);
  const issuedCompleted = input.document.document_state_key === 'issued';

  let sentState: InvoiceLifecycleRibbonStageState = 'pending';
  let sentCompleted = false;
  if (input.delivery.state_key === 'sent') {
    sentState = 'reached';
    sentCompleted = true;
  } else if (input.delivery.state_key === 'failed') {
    sentState = 'failed';
    sentCompleted = false;
  }

  let paymentState: InvoiceLifecycleRibbonStageState = 'pending';
  let paymentCompleted = false;
  let paymentLabel = RIBBON_LABELS.payment;
  if (input.payment.state_key === 'paid') {
    paymentState = 'reached';
    paymentCompleted = true;
    paymentLabel = 'שולם';
  } else if (input.payment.state_key === 'partial') {
    paymentState = 'pending';
    paymentCompleted = false;
    paymentLabel = 'שולם חלקית';
  } else {
    paymentLabel = 'לא שולם';
  }

  const showOverdue = input.due.overdue === true && input.due.state_key === 'overdue';

  // Attention priority for `current` (INV-2.0): overdue > send failed > unpaid/partial > not sent > issued.
  let currentKey: InvoiceLifecycleRibbonStageKey | null = null;
  if (showOverdue) {
    currentKey = 'overdue';
  } else if (input.delivery.state_key === 'failed') {
    currentKey = 'sent';
  } else if (input.payment.state_key === 'unpaid' || input.payment.state_key === 'partial') {
    currentKey = 'payment';
  } else if (input.delivery.state_key === 'not_sent' && issuedCompleted) {
    currentKey = 'sent';
  } else if (issuedCompleted && input.payment.state_key === 'paid') {
    currentKey = null; // all tracked path complete; closed unavailable
  } else if (issuedCompleted) {
    currentKey = 'issued';
  } else if (draftCompleted) {
    currentKey = 'draft';
  }

  const rows: InvoiceLifecycleRibbonStage[] = [
    stage('draft', draftCompleted ? 'reached' : 'pending', draftCompleted, currentKey === 'draft'),
    stage('issued', issuedCompleted ? 'reached' : 'pending', issuedCompleted, currentKey === 'issued'),
    {
      key: 'sent',
      label: RIBBON_LABELS.sent,
      state: sentState,
      completed: sentCompleted,
      current: currentKey === 'sent',
    },
    stage('delivered', 'not_tracked', false, false),
    {
      key: 'payment',
      label: paymentLabel,
      state: paymentState,
      completed: paymentCompleted,
      current: currentKey === 'payment',
    },
  ];

  if (showOverdue) {
    rows.push(stage('overdue', 'current', false, currentKey === 'overdue'));
  }

  rows.push(
    stage('credited', 'unavailable', false, false),
    stage('voided', 'unavailable', false, false),
    stage('closed', 'unavailable', false, false),
  );

  // Normalize: when overdue is current, its state is already 'current'.
  // Ensure only one current flag.
  let seenCurrent = false;
  for (const row of rows) {
    if (row.current) {
      if (seenCurrent) row.current = false;
      else seenCurrent = true;
    }
  }

  return rows;
}
