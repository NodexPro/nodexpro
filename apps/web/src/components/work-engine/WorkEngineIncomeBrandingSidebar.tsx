import { useCallback, useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import type {
  IncomeDocumentBrandingAssetSlot,
  IncomeDocumentBrandingField,
  IncomeDocumentBrandingProfileAggregate,
  IncomeDocumentBrandingSection,
} from '../../income/income-document-branding-types';

type Props = {
  profile: IncomeDocumentBrandingProfileAggregate;
  draftId: string;
  commands: {
    update_branding_profile: string;
    upload_document_logo: string;
    upload_document_signature: string;
  };
  busy: boolean;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
};

function SidebarSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="nx-we-preview-sidebar__section">
      <button
        type="button"
        className="nx-we-preview-sidebar__section-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <span>{title}</span>
        <span aria-hidden>{open ? '▾' : '◂'}</span>
      </button>
      {open ? <div className="nx-we-preview-sidebar__section-body">{children}</div> : null}
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
      <label className="nx-we-branding-field nx-we-branding-field--bool">
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
      <label className="nx-we-branding-field">
        <span className="nx-we-preview-sidebar__label">{field.label}</span>
        <select
          className="nx-we-branding-input"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
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
      <label className="nx-we-branding-field">
        <span className="nx-we-preview-sidebar__label">{field.label}</span>
        <textarea
          className="nx-we-branding-input nx-we-branding-input--textarea"
          value={value}
          disabled={disabled}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
        {field.hint ? <span className="nx-we-branding-hint">{field.hint}</span> : null}
      </label>
    );
  }
  return (
    <label className="nx-we-branding-field">
      <span className="nx-we-preview-sidebar__label">{field.label}</span>
      <input
        className="nx-we-branding-input"
        type={field.input_type === 'color' ? 'text' : 'text'}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.hint ? <span className="nx-we-branding-hint">{field.hint}</span> : null}
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
  draftId: string;
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
    const body: Record<string, unknown> = { draft_id: draftId, section: section.key };
    for (const field of section.fields) {
      if (field.input_type === 'boolean') {
        body[field.key] = draft[field.key] === 'true';
      } else {
        body[field.key] = draft[field.key] ?? '';
      }
    }
    await onCommand(updateCommand, body);
  };

  return (
    <div className="nx-we-branding-section-form">
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
        <button
          type="button"
          className="nx-btn nx-btn-primary nx-btn-taxes-compact nx-we-branding-save"
          disabled={busy}
          onClick={() => void save()}
        >
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
  draftId: string;
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
      const file_base64 = btoa(binary);
      await onCommand(slot.upload_command, {
        draft_id: draftId,
        file_name: file.name,
        mime_type: file.type || 'image/png',
        file_base64,
      });
    },
    [canUpload, draftId, onCommand, slot.upload_command],
  );

  return (
    <div className="nx-we-branding-asset">
      <div className="nx-we-preview-sidebar__label">{slot.label}</div>
      {slot.preview_data_url ? (
        <img src={slot.preview_data_url} alt="" className="nx-we-branding-asset__preview" />
      ) : (
        <div className="nx-we-branding-asset__empty">אין קובץ</div>
      )}
      {slot.hint ? <div className="nx-we-branding-hint">{slot.hint}</div> : null}
      {canUpload ? (
        <label className="nx-btn nx-btn-taxes-compact nx-we-branding-upload">
          העלאה
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} hidden onChange={(e) => void onFile(e)} />
        </label>
      ) : null}
    </div>
  );
}

export function WorkEngineIncomeBrandingSidebar({ profile, draftId, commands, busy, onCommand }: Props) {
  return (
    <SidebarSection title={profile.title} defaultOpen>
      <AssetUploadSlot slot={profile.logo} draftId={draftId} busy={busy} onCommand={onCommand} />
      <AssetUploadSlot slot={profile.signature} draftId={draftId} busy={busy} onCommand={onCommand} />
      {profile.sections.map((section) => (
        <div key={section.key} className="nx-we-branding-subsection">
          <div className="nx-we-branding-subsection__title">{section.title}</div>
          <BrandingSectionForm
            section={section}
            draftId={draftId}
            updateCommand={commands.update_branding_profile}
            busy={busy}
            onCommand={onCommand}
          />
        </div>
      ))}
    </SidebarSection>
  );
}
