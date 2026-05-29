import { useCallback, useEffect, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type {
  IncomeDocumentBrandingAssetSlot,
  IncomeDocumentBrandingField,
  IncomeDocumentBrandingProfileAggregate,
  IncomeDocumentBrandingTab,
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
  activeTab: string;
  onActiveTabChange: (key: string) => void;
  draft: Record<string, string>;
  onDraftChange: Dispatch<SetStateAction<Record<string, string>>>;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
};

export function fieldToDraftValue(field: IncomeDocumentBrandingField): string {
  return typeof field.value === 'boolean' ? (field.value ? 'true' : 'false') : String(field.value ?? '');
}

export function buildDraftFromProfile(profile: IncomeDocumentBrandingProfileAggregate): Record<string, string> {
  const draft: Record<string, string> = {
    color_preset_key: profile.selected_color_preset_key,
  };
  for (const tab of profile.tabs) {
    for (const field of tab.fields) {
      if (field.visible) draft[field.key] = fieldToDraftValue(field);
    }
  }
  return draft;
}

export function buildBrandingModalSaveBody(
  profile: IncomeDocumentBrandingProfileAggregate,
  draft: Record<string, string>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { section: profile.save_section_key };
  for (const tab of profile.tabs) {
    for (const field of tab.fields) {
      if (!field.visible) continue;
      if (field.input_type === 'boolean') {
        body[field.key] = draft[field.key] === 'true';
      } else if (field.input_type !== 'color_preset') {
        body[field.key] = draft[field.key] ?? '';
      }
    }
  }
  body.color_preset_key = draft.color_preset_key ?? profile.selected_color_preset_key;
  return body;
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
        <select
          className="nx-income-branding-input"
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
      <input
        className="nx-income-branding-input"
        type="text"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {field.hint ? <span className="nx-income-branding-hint">{field.hint}</span> : null}
    </label>
  );
}

function ColorPresetPicker({
  label,
  presets,
  selectedKey,
  disabled,
  onSelect,
}: {
  label: string;
  presets: IncomeDocumentBrandingProfileAggregate['color_presets'];
  selectedKey: string;
  disabled: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="nx-income-branding-color-presets">
      <div className="nx-income-branding-field__label">{label}</div>
      <div className="nx-income-branding-color-presets__grid" role="listbox" aria-label={label}>
        {presets.map((preset) => {
          const selected = preset.key === selectedKey;
          const isNodex = preset.key === 'nodexpro';
          return (
            <button
              key={preset.key}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              className={`nx-income-branding-swatch${selected ? ' nx-income-branding-swatch--selected' : ''}`}
              title={preset.label}
              onClick={() => onSelect(preset.key)}
            >
              <span
                className={`nx-income-branding-swatch__circle${isNodex ? ' nx-income-branding-swatch__circle--nodexpro' : ''}`}
                style={
                  isNodex
                    ? undefined
                    : { background: preset.primary_color, borderColor: preset.secondary_color }
                }
              />
              <span className="nx-income-branding-swatch__label">{preset.label}</span>
              {selected ? <span className="nx-income-branding-swatch__check" aria-hidden>✓</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AssetUploadSlot({
  slot,
  busy,
  onCommand,
}: {
  slot: IncomeDocumentBrandingAssetSlot;
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
      await onCommand(slot.upload_command, {
        file_name: file.name,
        mime_type: file.type || 'image/png',
        file_base64: btoa(binary),
      });
    },
    [canUpload, onCommand, slot.upload_command],
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

function TabPanel({
  tab,
  profile,
  draft,
  busy,
  canEdit,
  onCommand,
  onDraftChange,
}: {
  tab: IncomeDocumentBrandingTab;
  profile: IncomeDocumentBrandingProfileAggregate;
  draft: Record<string, string>;
  busy: boolean;
  canEdit: boolean;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
  onDraftChange: Dispatch<SetStateAction<Record<string, string>>>;
}) {
  return (
    <div className="nx-income-branding-tab-panel">
      {tab.key === 'design' ? <AssetUploadSlot slot={profile.logo} busy={busy} onCommand={onCommand} /> : null}
      {tab.key === 'business' ? (
        <AssetUploadSlot slot={profile.signature} busy={busy} onCommand={onCommand} />
      ) : null}
      {tab.fields
        .filter((f) => f.visible && f.input_type !== 'color_preset')
        .map((field) => (
          <BrandingFieldInput
            key={field.key}
            field={field}
            value={draft[field.key] ?? fieldToDraftValue(field)}
            disabled={!field.editable || busy || !canEdit}
            onChange={(next) => onDraftChange((d) => ({ ...d, [field.key]: next }))}
          />
        ))}
      {tab.fields.some((f) => f.input_type === 'color_preset') ? (
        <ColorPresetPicker
          label="ערכת צבעים"
          presets={profile.color_presets}
          selectedKey={draft.color_preset_key ?? profile.selected_color_preset_key}
          disabled={busy || !canEdit}
          onSelect={(key) => onDraftChange((d) => ({ ...d, color_preset_key: key }))}
        />
      ) : null}
    </div>
  );
}

export function IncomeDocumentBrandingSettingsPanel({
  profile,
  commands,
  busy,
  activeTab,
  onActiveTabChange,
  draft,
  onDraftChange,
  onCommand,
}: Props) {
  const canEdit = profile.allowed_actions.includes(commands.update_branding_profile);
  const activeTabDef = profile.tabs.find((t) => t.key === activeTab) ?? profile.tabs[0];

  return (
    <div className="nx-income-branding" dir="rtl">
      <nav className="nx-income-branding-tabs" aria-label="הגדרות מסמך">
        {profile.tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`nx-income-branding-tabs__btn${activeTab === tab.key ? ' nx-income-branding-tabs__btn--active' : ''}`}
            onClick={() => onActiveTabChange(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {activeTabDef ? (
        <TabPanel
          tab={activeTabDef}
          profile={profile}
          draft={draft}
          busy={busy}
          canEdit={canEdit}
          onCommand={onCommand}
          onDraftChange={onDraftChange}
        />
      ) : null}
    </div>
  );
}

export function useBrandingModalState(profile: IncomeDocumentBrandingProfileAggregate | null) {
  const [activeTab, setActiveTab] = useState(profile?.tabs[0]?.key ?? 'design');
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    profile ? buildDraftFromProfile(profile) : {},
  );

  useEffect(() => {
    if (!profile) return;
    setDraft(buildDraftFromProfile(profile));
    setActiveTab(profile.tabs[0]?.key ?? 'design');
  }, [profile]);

  return { activeTab, setActiveTab, draft, setDraft };
}
