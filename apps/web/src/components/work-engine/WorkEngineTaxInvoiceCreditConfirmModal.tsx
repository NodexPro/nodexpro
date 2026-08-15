import type { WorkEngineDocumentCreditAction } from '../../income/income-workspace-types';
import { btnPrimary } from '../../pages/owner-legal-control-panel-actions';

export type WorkEngineTaxInvoiceCreditRequest = {
  documentId: string;
  documentNumber: string | null;
  action: WorkEngineDocumentCreditAction;
  documentsListYear: number | null;
};

type Props = {
  request: WorkEngineTaxInvoiceCreditRequest | null;
  creditMode: 'full' | 'partial';
  creditReasonKey: string;
  creditReasonNote: string;
  busy: boolean;
  onCreditModeChange: (mode: 'full' | 'partial') => void;
  onCreditReasonKeyChange: (key: string) => void;
  onCreditReasonNoteChange: (note: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function WorkEngineTaxInvoiceCreditConfirmModal({
  request,
  creditMode,
  creditReasonKey,
  creditReasonNote,
  busy,
  onCreditModeChange,
  onCreditReasonKeyChange,
  onCreditReasonNoteChange,
  onClose,
  onConfirm,
}: Props) {
  if (!request) return null;

  return (
    <div className="nx-modal-overlay" role="dialog" aria-modal="true">
      <div className="nx-modal nx-owner-legal-command-modal">
        <div className="nx-modal-header">
          <h2>{request.action.label}</h2>
        </div>
        <div className="nx-modal-body">
          <p>החשבונית המקורית לא תבוטל. יווצר מסמך זיכוי חדש ומקושר.</p>
          {request.documentNumber ? (
            <p>
              חשבונית מס: <strong>{request.documentNumber}</strong>
            </p>
          ) : null}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            סוג זיכוי
            <select
              value={creditMode}
              disabled={busy}
              onChange={(e) => onCreditModeChange(e.target.value === 'partial' ? 'partial' : 'full')}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: 14,
              }}
            >
              {request.action.modes.map((mode) => (
                <option key={mode.key} value={mode.key}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            סיבת זיכוי
            <select
              value={creditReasonKey}
              disabled={busy}
              onChange={(e) => onCreditReasonKeyChange(e.target.value)}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: 14,
              }}
            >
              {request.action.reason_options.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            הערה (אופציונלי)
            <input
              value={creditReasonNote}
              onChange={(e) => onCreditReasonNoteChange(e.target.value)}
              disabled={busy}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                fontSize: 14,
              }}
            />
          </label>
        </div>
        <div className="nx-modal-footer nx-tax-nested-modal-footer">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            סגירה
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact nx-btn-primary"
            style={btnPrimary}
            disabled={busy || !request.action.enabled}
            onClick={onConfirm}
          >
            המשך
          </button>
        </div>
      </div>
    </div>
  );
}
