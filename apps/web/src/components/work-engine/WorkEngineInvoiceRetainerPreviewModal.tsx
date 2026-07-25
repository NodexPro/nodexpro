import { createPortal } from 'react-dom';
import { useState, type MouseEvent } from 'react';
import type { IncomeDocumentDetailsStep } from '../../income/income-document-details-types';
import { normalizeIncomeDocumentPreviewHtml } from '../../lib/income-document-preview-display.pure';
import type {
  WorkEngineRecurringCycleDraftReviewEditAction,
  WorkEngineRecurringCycleDraftReviewIssueAction,
  WorkEngineRecurringCycleDraftReviewIssueAndSendAction,
} from '../../income/income-workspace-types';
import { resolveCycleDraftPreviewEditButton } from './work-engine-invoice-retainer-preview-edit.pure';
import {
  resolveCycleDraftPreviewIssueAndSendIcon,
  resolveCycleDraftPreviewIssueIcon,
} from './work-engine-invoice-retainer-preview-header-actions.pure';
import { WorkEngineIncomeDocumentPreviewPaper } from './WorkEngineIncomeDocumentPreviewPaper';

type PreviewBlock = NonNullable<IncomeDocumentDetailsStep['document_preview']>;

type Props = {
  open: boolean;
  preview: PreviewBlock | null | undefined;
  busy: boolean;
  title?: string | null;
  subtitle?: string | null;
  editAction?: WorkEngineRecurringCycleDraftReviewEditAction | null;
  issueAction?: WorkEngineRecurringCycleDraftReviewIssueAction | null;
  issueAndSendAction?: WorkEngineRecurringCycleDraftReviewIssueAndSendAction | null;
  overlayClassName?: string;
  onSaveAllocationNumber?: (value: string | null) => Promise<void>;
  onEdit?: () => void;
  onIssue?: () => void;
  onIssueAndSend?: () => void;
  onClose: () => void;
};

function PreviewEditIcon() {
  return (
    <svg width={23} height={23} viewBox="0 0 24 24" fill="none" aria-hidden className="nx-we-retainer-preview-modal__head-icon-glyph">
      <path
        d="M4 20h4l10.5-10.5a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0L4 16v4zM13.5 6.5l2 2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PreviewIssueIcon() {
  return (
    <svg width={23} height={23} viewBox="0 0 24 24" fill="none" aria-hidden className="nx-we-retainer-preview-modal__head-icon-glyph">
      <path
        d="M8 4h8v3H8V4zm-2 5h12v11H6V9zm4 7 2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PreviewSendIcon() {
  return (
    <svg width={23} height={23} viewBox="0 0 24 24" fill="none" aria-hidden className="nx-we-retainer-preview-modal__head-icon-glyph">
      <path
        d="M4 12 20 4l-3 8-5 2-2 5-2-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WorkEngineInvoiceRetainerPreviewModal({
  open,
  preview,
  busy,
  title,
  subtitle,
  editAction,
  issueAction,
  issueAndSendAction,
  overlayClassName,
  onSaveAllocationNumber,
  onEdit,
  onIssue,
  onIssueAndSend,
  onClose,
}: Props) {
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);

  if (!open) return null;

  const allocationField = preview?.allocation_number_field;
  const previewHtml = normalizeIncomeDocumentPreviewHtml(preview?.preview_html?.trim() ?? '');
  const toolbarActions = (preview?.toolbar_actions ?? []).filter((action) => action.enabled);
  const displayTitle = title?.trim() || preview?.document_type_label || 'תצוגה מקדימה';
  const editButton = resolveCycleDraftPreviewEditButton({
    edit_action: editAction,
    has_on_edit_handler: onEdit != null,
  });
  const issueButton = resolveCycleDraftPreviewIssueIcon({
    issue_action: issueAction,
    has_on_issue_handler: onIssue != null,
  });
  const issueAndSendButton = resolveCycleDraftPreviewIssueAndSendIcon({
    issue_and_send_action: issueAndSendAction,
    has_on_issue_and_send_handler: onIssueAndSend != null,
  });

  const handleEditClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (editButton.disabled || !onEdit) return;
    onEdit();
  };

  const handleIssueClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (issueButton.disabled || !onIssue) return;
    onIssue();
  };

  const handleIssueAndSendClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (issueAndSendButton.disabled || !onIssueAndSend) return;
    onIssueAndSend();
  };

  return createPortal(
    <>
      <div
        className={`nx-we-retainer-preview-overlay nx-invoice-ui${overlayClassName ? ` ${overlayClassName}` : ''}${
          allocationModalOpen ? ' nx-we-retainer-preview-overlay--blocked' : ''
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="we-retainer-preview-title"
        onClick={onClose}
      >
        <div className="nx-we-retainer-preview-modal" dir="rtl" onClick={(e) => e.stopPropagation()}>
          <header className="nx-we-retainer-preview-modal__head">
            <div className="nx-we-retainer-preview-modal__head-text">
              <h2 id="we-retainer-preview-title" className="nx-we-retainer-preview-modal__title">
                {displayTitle}
              </h2>
              {subtitle ? (
                <p className="nx-we-retainer-preview-modal__subtitle">{subtitle}</p>
              ) : null}
            </div>
            <div className="nx-we-retainer-preview-modal__head-actions">
              <div className="nx-we-retainer-preview-modal__head-icon-rail">
                {editButton.render ? (
                  <button
                    type="button"
                    className="nx-we-retainer-preview-modal__head-icon"
                    data-testid="we-cycle-draft-preview-edit"
                    aria-label={editButton.label}
                    title={editButton.disabled_reason ?? editButton.label}
                    disabled={editButton.disabled}
                    onClick={handleEditClick}
                  >
                    <PreviewEditIcon />
                  </button>
                ) : null}
                {issueButton.render ? (
                  <button
                    type="button"
                    className="nx-we-retainer-preview-modal__head-icon"
                    data-testid={issueButton.test_id}
                    aria-label={issueButton.tooltip}
                    title={issueButton.tooltip}
                    disabled={issueButton.disabled || busy}
                    onClick={handleIssueClick}
                  >
                    <PreviewIssueIcon />
                  </button>
                ) : null}
                {issueAndSendButton.render ? (
                  <button
                    type="button"
                    className="nx-we-retainer-preview-modal__head-icon"
                    data-testid={issueAndSendButton.test_id}
                    aria-label={issueAndSendButton.tooltip}
                    title={issueAndSendButton.tooltip}
                    disabled={issueAndSendButton.disabled || busy}
                    onClick={handleIssueAndSendClick}
                  >
                    <PreviewSendIcon />
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                className="nx-we-retainer-preview-modal__close"
                aria-label="סגירה"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose();
                }}
              >
                ×
              </button>
            </div>
          </header>

          {toolbarActions.length > 0 ? (
            <div className="nx-we-retainer-preview-modal__toolbar">
              {toolbarActions.map((action) => (
                <button key={action.action} type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy}>
                  {action.label}
                </button>
              ))}
            </div>
          ) : null}

          <div
            className={`nx-we-retainer-preview-modal__canvas${
              allocationModalOpen ? ' nx-we-preview-canvas--blocked' : ''
            }`}
          >
            {busy ? (
              <p className="nx-we-retainer-preview-modal__status">מייצר תצוגה מקדימה…</p>
            ) : previewHtml ? (
              <WorkEngineIncomeDocumentPreviewPaper
                previewHtml={previewHtml}
                busy={busy}
                allocationField={allocationField}
                onSaveAllocationNumber={onSaveAllocationNumber}
                onAllocationModalOpenChange={setAllocationModalOpen}
              />
            ) : (
              <p className="nx-we-retainer-preview-modal__status">לא ניתן להציג תצוגה מקדימה</p>
            )}
          </div>

          {preview?.validation_messages?.length ? (
            <div className="nx-we-retainer-preview-modal__validation">
              {preview.validation_messages.map((message, idx) => (
                <div
                  key={idx}
                  className={`nx-we-preview-validation__item nx-we-preview-validation__item--${message.severity}`}
                >
                  {message.label}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}
