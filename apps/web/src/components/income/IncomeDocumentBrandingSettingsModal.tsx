import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/nx-branding-studio.css';
import type { IncomeDocumentBrandingProfileAggregate, IncomeDocumentBrandingStudioPreviewDraftResult } from '../../income/income-document-branding-types';
import {
  IncomeDocumentBrandingSettingsPanel,
  buildBrandingModalSaveBody,
  useBrandingModalState,
  type IncomeBrandingCommandsMap,
} from './IncomeDocumentBrandingSettingsPanel';

type Props = {
  open: boolean;
  title: string;
  profile: IncomeDocumentBrandingProfileAggregate | null;
  commands: IncomeBrandingCommandsMap;
  busy: boolean;
  onClose: () => void;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
  onPreviewDraft: (body: Record<string, unknown>) => Promise<IncomeDocumentBrandingStudioPreviewDraftResult | null>;
  portal?: boolean;
  saveBodyExtra?: Record<string, unknown>;
};

export function IncomeDocumentBrandingSettingsModal({
  open,
  title,
  profile,
  commands,
  busy,
  onClose,
  onCommand,
  onPreviewDraft,
  portal = false,
  saveBodyExtra,
}: Props) {
  const { activeSection, setActiveSection, draft, setDraft } = useBrandingModalState(profile);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const canSave = Boolean(profile?.allowed_actions.includes(commands.update_branding_profile));

  const handleSave = async () => {
    if (!profile || !canSave) return;
    await onCommand(commands.update_branding_profile, buildBrandingModalSaveBody(profile, draft, saveBodyExtra));
  };

  const dialog = (
    <div
      className="nx-income-branding-overlay nx-income-branding-overlay--studio nx-invoice-ui nx-invoice-designer-ui"
      role="dialog"
      aria-modal="true"
      aria-labelledby="income-branding-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div className="nx-income-branding-modal nx-income-branding-modal--studio" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="nx-income-branding-modal__head">
          <div className="nx-income-branding-modal__head-brand">
            <span className="nx-income-branding-modal__head-icon" aria-hidden>
              <span className="nx-income-branding-modal__head-icon-glyph">▦</span>
            </span>
            <div className="nx-income-branding-modal__head-text">
              <h2 id="income-branding-title" className="nx-income-branding-modal__title nx-modal-title">
                {title}
              </h2>
              <p className="nx-income-branding-modal__subtitle">
                התאמה אישית של מראה המסמך, פרטי העסק, אפשרויות תשלום ותוכן.
              </p>
            </div>
          </div>
          <div className="nx-income-branding-modal__head-actions">
            <button
              type="button"
              className="nx-income-branding-modal__close"
              disabled={busy}
              aria-label="סגירה"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        <div className="nx-income-branding-modal__body">
          {profile ? (
            <IncomeDocumentBrandingSettingsPanel
              profile={profile}
              commands={commands}
              busy={busy}
              activeSection={activeSection}
              onActiveSectionChange={setActiveSection}
              draft={draft}
              onDraftChange={setDraft}
              onCommand={onCommand}
              onPreviewDraft={onPreviewDraft}
            />
          ) : (
            <p>טוען הגדרות…</p>
          )}
        </div>
        <div className="nx-income-branding-modal__footer">
          <button
            type="button"
            className="nx-income-branding-modal__btn nx-income-branding-modal__btn--cancel"
            disabled={busy}
            onClick={onClose}
          >
            ביטול
          </button>
          <button
            type="button"
            className="nx-income-branding-modal__btn nx-income-branding-modal__btn--save"
            disabled={busy || !canSave}
            onClick={() => void handleSave()}
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  );

  if (portal && typeof document !== 'undefined') {
    return createPortal(dialog, document.body);
  }

  return dialog;
}
