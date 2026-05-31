import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { IncomeDocumentBrandingProfileAggregate } from '../../income/income-document-branding-types';
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
  portal?: boolean;
};

export function IncomeDocumentBrandingSettingsModal({
  open,
  title,
  profile,
  commands,
  busy,
  onClose,
  onCommand,
  portal = false,
}: Props) {
  const { activeTab, setActiveTab, draft, setDraft } = useBrandingModalState(profile);

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
    await onCommand(commands.update_branding_profile, buildBrandingModalSaveBody(profile, draft));
  };

  const dialog = (
    <div
      className="nx-income-branding-overlay nx-invoice-ui"
      role="dialog"
      aria-modal="true"
      aria-labelledby="income-branding-title"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div className="nx-income-branding-modal" onClick={(e) => e.stopPropagation()}>
        <div className="nx-income-branding-modal__head">
          <h2 id="income-branding-title" className="nx-income-branding-modal__title nx-modal-title">
            {title}
          </h2>
        </div>
        <div className="nx-income-branding-modal__body">
          {profile ? (
            <IncomeDocumentBrandingSettingsPanel
              profile={profile}
              commands={commands}
              busy={busy}
              activeTab={activeTab}
              onActiveTabChange={setActiveTab}
              draft={draft}
              onDraftChange={setDraft}
              onCommand={onCommand}
            />
          ) : (
            <p>טוען הגדרות…</p>
          )}
        </div>
        <div className="nx-income-branding-modal__footer">
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
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
