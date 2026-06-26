import { useCallback, useEffect, useState } from 'react';
import type { IncomeDocumentDetailsStep } from '../../income/income-document-details-types';
import type { WorkEngineInvoiceRetainerNextDocumentPreview } from '../../income/income-workspace-types';
import { WorkEngineDocumentDetailsStep } from './WorkEngineDocumentDetailsStep';

type Props = {
  preview: WorkEngineInvoiceRetainerNextDocumentPreview;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
};

function displayValue(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  return trimmed || '—';
}

function NextDocumentInfoBlock({
  info,
}: {
  info: WorkEngineInvoiceRetainerNextDocumentPreview['info_block'];
}) {
  return (
    <section className="nx-we-retainer-next-doc__info">
      <h3 className="nx-we-retainer-next-doc__info-title">{info.title}</h3>
      <dl className="nx-we-retainer-next-doc__info-grid">
        <div className="nx-we-retainer-next-doc__info-row">
          <dt>סוג מסמך</dt>
          <dd>{displayValue(info.document_type_label)}</dd>
        </div>
        <div className="nx-we-retainer-next-doc__info-row">
          <dt>תאריך המסמך הבא</dt>
          <dd>{displayValue(info.next_document_date_display)}</dd>
        </div>
        <div className="nx-we-retainer-next-doc__info-row nx-we-retainer-next-doc__info-row--stacked">
          <dt>{info.draft_review_date_label}</dt>
          <dd>
            <span>{displayValue(info.draft_review_date_display)}</span>
            {info.draft_review_advance_note ? (
              <span className="nx-we-retainer-next-doc__info-sub">{info.draft_review_advance_note}</span>
            ) : null}
          </dd>
        </div>
        <div className="nx-we-retainer-next-doc__info-row">
          <dt>סטטוס</dt>
          <dd>{displayValue(info.profile_status_label)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function WorkEngineInvoiceRetainerNextDocumentPanel({
  preview,
  busy,
  onBusyChange,
  onError,
}: Props) {
  const [localStep, setLocalStep] = useState<IncomeDocumentDetailsStep | null>(
    preview.document_details_step,
  );

  useEffect(() => {
    setLocalStep(preview.document_details_step);
  }, [
    preview.projection_id,
    preview.document_details_step,
    preview.info_block.document_type_label,
  ]);

  const handleProjectionStepChange = useCallback((next: IncomeDocumentDetailsStep) => {
    setLocalStep(next);
  }, []);

  if (preview.status !== 'ready' || !localStep) {
    return (
      <div className="nx-we-retainer-next-doc__unavailable">
        <p className="nx-we-retainer-next-doc__preview-banner" role="status">
          תצוגה מקדימה בלבד — שמירת שינויים תתווסף בשלב הבא
        </p>
        <NextDocumentInfoBlock info={preview.info_block} />
        <p className="nx-we-retainer-note">
          {preview.unavailable_message ?? 'תצוגת המסמך הבא אינה זמינה.'}
        </p>
      </div>
    );
  }

  return (
    <div className="nx-we-retainer-next-doc">
      <p className="nx-we-retainer-next-doc__preview-banner" role="status">
        תצוגה מקדימה בלבד — שמירת שינויים תתווסף בשלב הבא
      </p>
      <NextDocumentInfoBlock info={preview.info_block} />
      {preview.price_increase_note ? (
        <p className="nx-we-retainer-note nx-we-retainer-next-doc__note">{preview.price_increase_note}</p>
      ) : null}
      <WorkEngineDocumentDetailsStep
        step={localStep}
        commands={{}}
        workspaceAgg={null}
        busy={busy}
        hideHeader
        projectionMode
        onProjectionStepChange={handleProjectionStepChange}
        onBusyChange={onBusyChange}
        onWorkspaceAgg={() => {}}
        onError={onError}
      />
    </div>
  );
}
