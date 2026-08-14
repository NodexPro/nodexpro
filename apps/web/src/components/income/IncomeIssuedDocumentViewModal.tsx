/**
 * Issued document viewer — unified HTML from issued-document-view aggregate.
 * Retainer-style dark overlay; allocation number editable like retainer preview.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { IncomeIssuedDocumentViewAggregate } from '../../api/income';
import {
  downloadIncomeDocumentPdf,
  executeIncomeCommand,
  fetchIncomeIssuedDocumentViewAggregate,
} from '../../api/income';
import { normalizeIncomeDocumentPreviewHtml } from '../../lib/income-document-preview-display.pure';
import { printIncomeIssuedDocumentHtml } from './income-issued-document-print.pure';
import { WorkEngineIncomeDocumentPreviewPaper } from '../work-engine/WorkEngineIncomeDocumentPreviewPaper';
import '../../styles/nx-work-engine-invoice-retainer.css';

type Props = {
  open: boolean;
  incomeDocumentId: string | null;
  /** When opening from Work Engine office-client documents, align Income issuer first. */
  representedClientId?: string | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onError?: (message: string) => void;
};

function IssuedViewDownloadIcon() {
  return (
    <svg
      width={23}
      height={23}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="nx-we-retainer-preview-modal__head-icon-glyph"
    >
      <path
        d="M12 4v12m0 0 4-4m-4 4-4-4M5 20h14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IssuedViewPrintIcon() {
  return (
    <svg
      width={23}
      height={23}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className="nx-we-retainer-preview-modal__head-icon-glyph"
    >
      <path
        d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 13h10v8H7v-8z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IncomeIssuedDocumentViewModal({
  open,
  incomeDocumentId,
  representedClientId = null,
  busy,
  onBusyChange,
  onClose,
  onError,
}: Props) {
  const [aggregate, setAggregate] = useState<IncomeIssuedDocumentViewAggregate | null>(null);
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const loadAggregate = useCallback(async () => {
    if (!incomeDocumentId) return;
    onBusyChange?.(true);
    try {
      if (representedClientId) {
        await executeIncomeCommand('select_income_issuer_context', {
          acting_mode: 'office_representative',
          issuer_business_id: representedClientId,
          represented_client_id: representedClientId,
        });
      }
      const next = await fetchIncomeIssuedDocumentViewAggregate({ incomeDocumentId });
      setAggregate(next);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
      setAggregate(null);
    } finally {
      onBusyChange?.(false);
    }
  }, [incomeDocumentId, representedClientId, onBusyChange, onError]);

  useEffect(() => {
    if (!open || !incomeDocumentId) {
      setAggregate(null);
      setAllocationModalOpen(false);
      return;
    }
    void loadAggregate();
  }, [open, incomeDocumentId, loadAggregate]);

  if (!open || !incomeDocumentId) return null;

  const previewHtml = normalizeIncomeDocumentPreviewHtml(aggregate?.document_html?.trim() ?? '');
  const pdf = aggregate?.pdf_action ?? null;
  const allocationField = aggregate?.allocation_number_field ?? null;
  const displayTitle = aggregate?.title?.trim() || 'צפייה במסמך';
  const downloadEnabled = Boolean(pdf?.enabled && pdf.pdf_download_path);
  const downloadTitle = downloadEnabled
    ? (pdf?.label ?? 'הורדה')
    : (pdf?.disabled_reason ?? 'קובץ PDF אינו זמין');

  const handleDownload = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!pdf?.enabled || !pdf.pdf_download_path) return;
    onBusyChange?.(true);
    try {
      await downloadIncomeDocumentPdf(
        pdf.pdf_download_path,
        `income-${aggregate?.document_number ?? 'document'}.pdf`,
      );
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      onBusyChange?.(false);
    }
  };

  const handlePrint = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    printIncomeIssuedDocumentHtml(previewHtml);
  };

  const handleSaveAllocationNumber = async (allocation_number: string | null) => {
    if (!aggregate) return;
    onBusyChange?.(true);
    try {
      const res = await executeIncomeCommand('update_income_document_allocation_number', {
        income_document_id: aggregate.income_document_id,
        allocation_number,
      });
      if (
        'income_issued_document_view_aggregate' in res &&
        res.income_issued_document_view_aggregate
      ) {
        setAggregate(res.income_issued_document_view_aggregate as IncomeIssuedDocumentViewAggregate);
      } else {
        await loadAggregate();
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      onBusyChange?.(false);
    }
  };

  return createPortal(
    <div
      className={`nx-we-retainer-preview-overlay nx-invoice-ui nx-income-issued-document-view${
        allocationModalOpen ? ' nx-we-retainer-preview-overlay--blocked' : ''
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="income-issued-document-view-title"
      onClick={onClose}
    >
      <div className="nx-we-retainer-preview-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <header className="nx-we-retainer-preview-modal__head">
          <div className="nx-we-retainer-preview-modal__head-text">
            <h2 id="income-issued-document-view-title" className="nx-we-retainer-preview-modal__title">
              {displayTitle}
            </h2>
          </div>
          <div className="nx-we-retainer-preview-modal__head-actions">
            <div className="nx-we-retainer-preview-modal__head-icon-rail">
              <button
                type="button"
                className="nx-we-retainer-preview-modal__head-icon"
                data-testid="income-issued-document-download"
                aria-label="הורדה"
                title={downloadTitle}
                disabled={busy || !downloadEnabled}
                onClick={(e) => void handleDownload(e)}
              >
                <IssuedViewDownloadIcon />
              </button>
              <button
                type="button"
                className="nx-we-retainer-preview-modal__head-icon"
                data-testid="income-issued-document-print"
                aria-label="הדפסה"
                title="הדפסה"
                disabled={busy || !previewHtml}
                onClick={handlePrint}
              >
                <IssuedViewPrintIcon />
              </button>
            </div>
            <button
              type="button"
              className="nx-we-retainer-preview-modal__close"
              aria-label="סגירה"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              ×
            </button>
          </div>
        </header>

        <div
          ref={canvasRef}
          className={`nx-we-retainer-preview-modal__canvas${
            allocationModalOpen ? ' nx-we-preview-canvas--blocked' : ''
          }`}
        >
          {busy && !aggregate ? (
            <p className="nx-we-retainer-preview-modal__status">טוען מסמך…</p>
          ) : previewHtml ? (
            <WorkEngineIncomeDocumentPreviewPaper
              previewHtml={previewHtml}
              busy={busy}
              allocationField={allocationField}
              onSaveAllocationNumber={handleSaveAllocationNumber}
              onAllocationModalOpenChange={setAllocationModalOpen}
            />
          ) : (
            <p className="nx-we-retainer-preview-modal__status">לא ניתן להציג את המסמך</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
