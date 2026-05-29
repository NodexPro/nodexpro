import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import type {
  IncomeDocumentBrandingAssetSlot,
  IncomeDocumentBrandingField,
  IncomeDocumentBrandingProfileAggregate,
  IncomeDocumentBrandingSection,
} from '../../income/income-document-branding-types';

export type IncomeBrandingCommandsMap = {
  update_branding_profile: string;
  upload_document_logo: string;
  upload_document_signature: string;
};

type Props = {
  profile: IncomeDocumentBrandingProfileAggregate;
  commands: IncomeBrandingCommandsMap;
  busy: boolean;
  draftId?: string | null;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
  layout?: 'modal' | 'compact';
};

function PanelSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="nx-income-branding__section">
      <button type="button" className="nx-income-branding__section-toggle" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span aria-hidden>{open ? '▾' : '◂'}</span>
      </button>
      {open ? <div className="nx-income-branding__section-body">{children}</div> : null}
    </section>
  );
}

function fieldDraftValue(field: IncomeDocumentBrandingField): string {
  return typeof field.value === 'boolean' ? (field.value ? 'true' : 'false') : String(field.value ?? '');
}

function BrandingFieldInput({
  field,
  value,
  disabled,
  onChange,
}: {
  field: IncomeDocumentBrandingField;
  value: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  if (field.input_type === 'boolean') {
    return (
      <label className="nx-income-branding-field nx-income-branding-field--bool">
        <input
          type="checkbox"
          checked={value === 'true'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.input_type === 'select' && field.options?.length) {
    return (
      <label className="nx-income-branding-field">
        <span className="nx-income-branding-field__label">{field.label}</span>
        <select className="nx-income-branding-input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.input_type === 'textarea') {
    return (
      <label className="nx-income-branding-field">
        <span className="nx-income-branding-field__label">{field.label}</span>
        <textarea
          className="nx-income-branding-input nx-income-branding-input--textarea"
          value={value}
          disabled={disabled}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.hint ? <span className="nx-income-branding-hint">{field.hint}</span> : null}
      </label>
    );
  }
  return (
    <label className="nx-income-branding-field">
      <span className="nx-income-branding-field__label">{field.label}</span>
      <input className="nx-income-branding-input" type="text" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {field.hint ? <span className="nx-income-branding-hint">{field.hint}</span> : null}
    </label>
  );
}

function BrandingSectionForm({
  section,
  draftId,
  updateCommand,
  busy,
  onCommand,
}: {
  section: IncomeDocumentBrandingSection;
  draftId?: string | null;
  updateCommand: string;
  busy: boolean;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const canSave = section.allowed_actions.includes(updateCommand);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(section.fields.map((f) => [f.key, fieldDraftValue(f)])),
  );

  useEffect(() => {
    setDraft(Object.fromEntries(section.fields.map((f) => [f.key, fieldDraftValue(f)])));
  }, [section]);

  const save = async () => {
    const body: Record<string, unknown> = { section: section.key };
    if (draftId) body.draft_id = draftId;
    for (const field of section.fields) {
      body[field.key] = field.input_type === 'boolean' ? draft[field.key] === 'true' : (draft[field.key] ?? '');
    }
    await onCommand(updateCommand, body);
  };

  return (
    <div className="nx-income-branding-section-form">
      {section.fields
        .filter((f) => f.visible)
        .map((field) => (
          <BrandingFieldInput
            key={field.key}
            field={field}
            value={draft[field.key] ?? fieldDraftValue(field)}
            disabled={!field.editable || busy}
            onChange={(next) => setDraft((d) => ({ ...d, [field.key]: next }))}
          />
        ))}
      {canSave ? (
        <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" disabled={busy} onClick={() => void save()}>
          שמירה
        </button>
      ) : null}
    </div>
  );
}

function AssetUploadSlot({
  slot,
  draftId,
  busy,
  onCommand,
}: {
  slot: IncomeDocumentBrandingAssetSlot;
  draftId?: string | null;
  busy: boolean;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const canUpload = slot.allowed_actions.includes(slot.upload_command);

  const onFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !canUpload) return;
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const body: Record<string, unknown> = {
        file_name: file.name,
        mime_type: file.type || 'image/png',
        file_base64: btoa(binary),
      };
      if (draftId) body.draft_id = draftId;
      await onCommand(slot.upload_command, body);
    },
    [canUpload, draftId, onCommand, slot.upload_command],
  );

  return (
    <div className="nx-income-branding-asset">
      <div className="nx-income-branding-field__label">{slot.label}</div>
      {slot.preview_data_url ? (
        <img src={slot.preview_data_url} alt="" className="nx-income-branding-asset__preview" />
      ) : (
        <div className="nx-income-branding-asset__empty">אין קובץ</div>
      )}
      {slot.hint ? <div className="nx-income-branding-hint">{slot.hint}</div> : null}
      {canUpload ? (
        <label className="nx-btn nx-btn-taxes-compact nx-income-branding-upload">
          העלאה
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} hidden onChange={(e) => void onFile(e)} />
        </label>
      ) : null}
    </div>
  );
}

export function IncomeDocumentBrandingSettingsPanel({
  profile,
  commands,
  busy,
  draftId,
  onCommand,
  layout = 'modal',
}: Props) {
  const designSection = profile.sections.find((s) => s.key === 'document_design');
  const signatureSection = profile.sections.find((s) => s.key === 'signature');
  const otherSections = profile.sections.filter(
    (s) => s.key !== 'document_design' && s.key !== 'signature',
  );

  return (
    <div className={`nx-income-branding nx-income-branding--${layout}`} dir="rtl">
      {designSection ? (
        <PanelSection title={designSection.title} defaultOpen>
          <AssetUploadSlot slot={profile.logo} draftId={draftId} busy={busy} onCommand={onCommand} />
          <BrandingSectionForm
            section={designSection}
            draftId={draftId}
            updateCommand={commands.update_branding_profile}
            busy={busy}
            onCommand={onCommand}
          />
        </PanelSection>
      ) : null}

      {signatureSection ? (
        <PanelSection title={signatureSection.title} defaultOpen={layout === 'modal'}>
          <AssetUploadSlot slot={profile.signature} draftId={draftId} busy={busy} onCommand={onCommand} />
          <BrandingSectionForm
            section={signatureSection}
            draftId={draftId}
            updateCommand={commands.update_branding_profile}
            busy={busy}
            onCommand={onCommand}
          />
        </PanelSection>
      ) : null}

      {otherSections.map((section) => (
        <PanelSection key={section.key} title={section.title} defaultOpen={layout === 'modal'}>
          <BrandingSectionForm
            section={section}
            draftId={draftId}
            updateCommand={commands.update_branding_profile}
            busy={busy}
            onCommand={onCommand}
          />
        </PanelSection>
      ))}
    </div>
  );
}
