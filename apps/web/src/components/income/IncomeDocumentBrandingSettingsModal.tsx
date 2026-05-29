import type { IncomeDocumentBrandingProfileAggregate } from '../../income/income-document-branding-types';
import type { IncomeBrandingCommandsMap } from './IncomeDocumentBrandingSettingsPanel';
import { IncomeDocumentBrandingSettingsPanel } from './IncomeDocumentBrandingSettingsPanel';

type Props = {
  open: boolean;
  title: string;
  profile: IncomeDocumentBrandingProfileAggregate | null;
  commands: IncomeBrandingCommandsMap;
  busy: boolean;
  draftId?: string | null;
  onClose: () => void;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
};

export function IncomeDocumentBrandingSettingsModal({
  open,
  title,
  profile,
  commands,
  busy,
  draftId,
  onClose,
  onCommand,
}: Props) {
  if (!open) return null;

  return (
    <div className="nx-income-wizard-overlay" role="dialog" aria-modal="true" aria-labelledby="income-branding-title">
      <div className="nx-income-branding-modal nx-accounting-editor-modal">
        <div className="nx-income-branding-modal__head">
          <h2 id="income-branding-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {title}
          </h2>
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            סגירה
          </button>
        </div>
        <div className="nx-income-branding-modal__body">
          {profile ? (
            <IncomeDocumentBrandingSettingsPanel
              profile={profile}
              commands={commands}
              busy={busy}
              draftId={draftId}
              onCommand={onCommand}
              layout="modal"
            />
          ) : (
            <p>טוען הגדרות…</p>
          )}
        </div>
      </div>
    </div>
  );
}
