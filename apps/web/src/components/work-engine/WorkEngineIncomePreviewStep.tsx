import { useMemo, useState } from 'react';
import type { IncomeDocumentDetailsStep } from '../../income/income-document-details-types';
import { normalizeIncomeDocumentPreviewHtml } from '../../lib/income-document-preview-display.pure';
import { WorkEngineIncomeDocumentPreviewPaper } from './WorkEngineIncomeDocumentPreviewPaper';
import { WorkEngineIncomeDocumentPreviewSidebar } from './WorkEngineIncomeDocumentPreviewSidebar';

type Props = {
  step: IncomeDocumentDetailsStep;
  busy: boolean;
  onGeneratePreview: () => void;
  onSaveAllocationNumber?: (value: string | null) => Promise<void>;
};

export function WorkEngineIncomePreviewStep({
  step,
  busy,
  onGeneratePreview,
  onSaveAllocationNumber,
}: Props) {
  const preview = step.document_preview;
  const toolbar = preview?.toolbar_actions ?? [];
  const allocationField = preview?.allocation_number_field;
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const previewHtml = useMemo(
    () => normalizeIncomeDocumentPreviewHtml(preview?.preview_html?.trim() ?? ''),
    [preview?.preview_html],
  );
  const showPaper = preview?.visible && previewHtml;

  return (
    <div className="nx-we-preview-layout" dir="rtl">
      <div className="nx-we-preview-main">
        <div className="nx-we-preview-toolbar">
          {toolbar.map((action) => (
            <button
              key={action.action}
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={!action.enabled || busy}
              title={action.reason ?? undefined}
            >
              {action.label}
            </button>
          ))}
        </div>

        <div
          className={`nx-we-preview-canvas${
            allocationModalOpen ? ' nx-we-preview-canvas--blocked' : ''
          }`}
        >
          {showPaper ? (
            <WorkEngineIncomeDocumentPreviewPaper
              previewHtml={previewHtml}
              busy={busy}
              allocationField={allocationField}
              onSaveAllocationNumber={onSaveAllocationNumber}
              onAllocationModalOpenChange={setAllocationModalOpen}
            />
          ) : (
            <div className="nx-we-preview-empty">
              <p>תצוגה מקדימה טרם נוצרה.</p>
              {preview?.allowed_actions.includes('generate_income_document_preview') ? (
                <button
                  type="button"
                  className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={onGeneratePreview}
                >
                  {busy ? 'מייצר תצוגה…' : 'יצירת תצוגה מקדימה'}
                </button>
              ) : null}
            </div>
          )}
        </div>

        {preview?.validation_messages?.length ? (
          <div className="nx-we-preview-validation">
            {preview.validation_messages.map((m, idx) => (
              <div
                key={idx}
                className={`nx-we-preview-validation__item nx-we-preview-validation__item--${m.severity}`}
              >
                {m.label}
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <WorkEngineIncomeDocumentPreviewSidebar step={step} />
    </div>
  );
}
