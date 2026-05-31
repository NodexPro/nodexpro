import { useCallback, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import type {
  IncomeBrandingStudioDraft,
  IncomeBrandingStudioSectionKey,
  IncomeColorThemePreset,
  IncomeDocumentBrandingAssetSlot,
  IncomeDocumentBrandingProfileAggregate,
  IncomeDocumentBrandingStudio,
  IncomeDocumentBrandingStudioLivePreview,
  IncomeDocumentBrandingStudioPreviewDraftResult,
  IncomeDocumentStyleTemplate,
  IncomeLogoSizeOption,
} from '../../income/income-document-branding-types';

export type IncomeBrandingCommandsMap = {
  update_branding_profile: string;
  preview_branding_profile_draft: string;
  upload_document_logo: string;
  upload_document_signature: string;
};

type Props = {
  profile: IncomeDocumentBrandingProfileAggregate;
  commands: IncomeBrandingCommandsMap;
  busy: boolean;
  activeSection: IncomeBrandingStudioSectionKey;
  onActiveSectionChange: (key: IncomeBrandingStudioSectionKey) => void;
  draft: IncomeBrandingStudioDraft;
  onDraftChange: Dispatch<SetStateAction<IncomeBrandingStudioDraft>>;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
  onPreviewDraft: (body: Record<string, unknown>) => Promise<IncomeDocumentBrandingStudioPreviewDraftResult | null>;
};

function boolToDraft(value: boolean): string {
  return value ? 'true' : 'false';
}

export function buildDraftFromProfile(profile: IncomeDocumentBrandingProfileAggregate): IncomeBrandingStudioDraft {
  const studio = profile.document_branding_studio;
  const f = studio.fields;
  return {
    document_style_key: studio.selected_document_style_key,
    color_theme_key: studio.selected_color_theme_key,
    layout_template_key: studio.selected_layout_template_key ?? '',
    logo_size_key: studio.selected_logo_size_key,
    show_logo: boolToDraft(f.show_logo),
    company_subtitle: f.company_subtitle ?? '',
    show_signature: boolToDraft(f.show_signature),
    footer_text: f.footer_text ?? '',
    bank_name: f.bank_name ?? '',
    bank_branch: f.bank_branch ?? '',
    bank_account: f.bank_account ?? '',
    iban: f.iban ?? '',
    swift: f.swift ?? '',
    email_subject_template: f.email_subject_template ?? '',
    email_body_template: f.email_body_template ?? '',
    customer_notes: f.customer_notes ?? '',
    terms_and_conditions: f.terms_and_conditions ?? '',
  };
}

export function buildBrandingPreviewDraftBody(draft: IncomeBrandingStudioDraft): Record<string, unknown> {
  return {
    document_style_key: draft.document_style_key,
    color_theme_key: draft.color_theme_key,
    layout_template_key: draft.layout_template_key.trim() ? draft.layout_template_key : null,
    logo_size_key: draft.logo_size_key,
    show_logo: draft.show_logo === 'true',
    company_subtitle: draft.company_subtitle,
    show_signature: draft.show_signature === 'true',
    footer_text: draft.footer_text,
    bank_name: draft.bank_name,
    bank_branch: draft.bank_branch,
    bank_account: draft.bank_account,
    iban: draft.iban,
    swift: draft.swift,
    email_subject_template: draft.email_subject_template,
    email_body_template: draft.email_body_template,
    customer_notes: draft.customer_notes,
    terms_and_conditions: draft.terms_and_conditions,
  };
}

export function buildBrandingModalSaveBody(
  profile: IncomeDocumentBrandingProfileAggregate,
  draft: IncomeBrandingStudioDraft,
): Record<string, unknown> {
  const studio = profile.document_branding_studio;
  return {
    section: studio.save_section_key,
    document_style_key: draft.document_style_key,
    color_theme_key: draft.color_theme_key,
    layout_template_key: draft.layout_template_key.trim() ? draft.layout_template_key : null,
    logo_size_key: draft.logo_size_key,
    show_logo: draft.show_logo === 'true',
    company_subtitle: draft.company_subtitle,
    show_signature: draft.show_signature === 'true',
    footer_text: draft.footer_text,
    bank_name: draft.bank_name,
    bank_branch: draft.bank_branch,
    bank_account: draft.bank_account,
    iban: draft.iban,
    swift: draft.swift,
    email_subject_template: draft.email_subject_template,
    email_body_template: draft.email_body_template,
    customer_notes: draft.customer_notes,
    terms_and_conditions: draft.terms_and_conditions,
  };
}

function MarkupPreview({ markup, className }: { markup: string; className?: string }) {
  return (
    <div
      className={className}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

function DocumentStyleTemplateCard({
  template,
  selected,
  disabled,
  onSelect,
}: {
  template: IncomeDocumentStyleTemplate;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      className={`nx-branding-studio-style-card${selected ? ' nx-branding-studio-style-card--selected' : ''}`}
      onClick={onSelect}
    >
      <MarkupPreview markup={template.mini_preview_markup} className="nx-branding-studio-style-card__mini" />
      <span className="nx-branding-studio-style-card__title">{template.label}</span>
      <span className="nx-branding-studio-style-card__desc">{template.description}</span>
      {selected ? <span className="nx-branding-studio-style-card__check" aria-hidden>✓</span> : null}
    </button>
  );
}

function ColorThemeCard({
  preset,
  selected,
  disabled,
  onSelect,
}: {
  preset: IncomeColorThemePreset;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={disabled}
      className={`nx-branding-studio-theme-card${selected ? ' nx-branding-studio-theme-card--selected' : ''}`}
      onClick={onSelect}
    >
      <MarkupPreview markup={preset.mini_preview_markup} className="nx-branding-studio-theme-card__mini" />
      <span className="nx-branding-studio-theme-card__label">{preset.label}</span>
      {selected ? <span className="nx-branding-studio-theme-card__check" aria-hidden>✓</span> : null}
    </button>
  );
}

function LogoSizePicker({
  options,
  selectedKey,
  logoPreviewUrl,
  disabled,
  onSelect,
}: {
  options: IncomeLogoSizeOption[];
  selectedKey: string;
  logoPreviewUrl: string | null;
  disabled: boolean;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="nx-branding-studio-logo-sizes">
      <div className="nx-branding-studio-logo-sizes__preview">
        {logoPreviewUrl ? (
          <img
            src={logoPreviewUrl}
            alt=""
            className={`nx-branding-studio-logo-sizes__img nx-branding-studio-logo-sizes__img--${selectedKey}`}
          />
        ) : (
          <div className={`nx-branding-studio-logo-sizes__placeholder nx-branding-studio-logo-sizes__img--${selectedKey}`}>
            לוגו
          </div>
        )}
      </div>
      <div className="nx-branding-studio-logo-sizes__options" role="listbox" aria-label="גודל לוגו">
        {options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            role="option"
            aria-selected={opt.key === selectedKey}
            disabled={disabled}
            className={`nx-branding-studio-logo-size${opt.key === selectedKey ? ' nx-branding-studio-logo-size--selected' : ''}`}
            onClick={() => onSelect(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StudioField({
  label,
  value,
  disabled,
  multiline,
  hint,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  hint?: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="nx-branding-studio-field">
      <span className="nx-branding-studio-field__label nx-field-label">{label}</span>
      {multiline ? (
        <textarea
          className="nx-branding-studio-field__input nx-branding-studio-field__input--textarea"
          value={value}
          disabled={disabled}
          rows={3}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="nx-branding-studio-field__input"
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint ? <span className="nx-branding-studio-hint">{hint}</span> : null}
    </label>
  );
}

function StudioBoolField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="nx-branding-studio-field nx-branding-studio-field--bool">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function AssetUploadSlot({
  slot,
  slotKind,
  busy,
  canEdit,
  updateCommand,
  onCommand,
}: {
  slot: IncomeDocumentBrandingAssetSlot;
  slotKind: 'logo' | 'signature';
  busy: boolean;
  canEdit: boolean;
  updateCommand: string;
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

  const onRemove = useCallback(async () => {
    if (!slot.can_remove || !canEdit) return;
    await onCommand(updateCommand, {
      section: 'modal',
      clear_logo: slotKind === 'logo',
      clear_signature: slotKind === 'signature',
    });
  }, [canEdit, onCommand, slot.can_remove, slotKind, updateCommand]);

  return (
    <div className="nx-branding-studio-asset">
      <div className="nx-branding-studio-field__label nx-field-label">{slot.label}</div>
      {slot.recommended_size_hint ? (
        <p className="nx-branding-studio-hint nx-branding-studio-asset__recommended">{slot.recommended_size_hint}</p>
      ) : null}
      <div className="nx-branding-studio-asset__frame">
        {slot.preview_data_url ? (
          <img src={slot.preview_data_url} alt="" className="nx-branding-studio-asset__preview" />
        ) : (
          <div className="nx-branding-studio-asset__empty">אין קובץ</div>
        )}
      </div>
      {slot.hint ? <div className="nx-branding-studio-hint">{slot.hint}</div> : null}
      <div className="nx-branding-studio-asset__actions">
        {canUpload ? (
          <label className="nx-btn nx-btn-taxes-compact nx-branding-studio-upload">
            {slot.preview_data_url ? 'החלפה' : 'העלאה'}
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} hidden onChange={(e) => void onFile(e)} />
          </label>
        ) : null}
        {slot.can_remove ? (
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy || !canEdit} onClick={() => void onRemove()}>
            הסרה
          </button>
        ) : null}
      </div>
    </div>
  );
}

function StudioSectionContent({
  section,
  styleTemplates,
  colorThemePresets,
  studio,
  profile,
  draft,
  busy,
  canEdit,
  commands,
  onDraftChange,
  onCommand,
}: {
  section: IncomeBrandingStudioSectionKey;
  styleTemplates: IncomeDocumentStyleTemplate[];
  colorThemePresets: IncomeColorThemePreset[];
  studio: IncomeDocumentBrandingStudio;
  profile: IncomeDocumentBrandingProfileAggregate;
  draft: IncomeBrandingStudioDraft;
  busy: boolean;
  canEdit: boolean;
  commands: IncomeBrandingCommandsMap;
  onDraftChange: Dispatch<SetStateAction<IncomeBrandingStudioDraft>>;
  onCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const disabled = busy || !canEdit;

  if (section === 'document_style') {
    return (
      <div className="nx-branding-studio-section">
        <h3 className="nx-branding-studio-section__title">סגנון מסמך</h3>
        <p className="nx-branding-studio-section__lead">בחרו את מבנה המסמך — הפריסה, הריווח והאופי הכללי.</p>
        <div className="nx-branding-studio-style-grid" role="listbox" aria-label="סגנון מסמך">
          {styleTemplates.map((template) => (
            <DocumentStyleTemplateCard
              key={template.key}
              template={template}
              selected={draft.document_style_key === template.key}
              disabled={disabled}
              onSelect={() => onDraftChange((d) => ({ ...d, document_style_key: template.key }))}
            />
          ))}
        </div>
        <h3 className="nx-branding-studio-section__title nx-branding-studio-section__title--spaced">ערכת צבעים</h3>
        <p className="nx-branding-studio-section__lead">בחרו צבעים — גרדיאנט, כותרת טבלה, סה״כ וקו הדגשה ללקוח.</p>
        <div className="nx-branding-studio-theme-grid" role="listbox" aria-label="ערכת צבעים">
          {colorThemePresets.map((preset) => (
            <ColorThemeCard
              key={preset.key}
              preset={preset}
              selected={draft.color_theme_key === preset.key}
              disabled={disabled}
              onSelect={() => onDraftChange((d) => ({ ...d, color_theme_key: preset.key }))}
            />
          ))}
        </div>
        {studio.advanced_layout_visible ? (
          <details className="nx-branding-studio-advanced">
            <summary className="nx-branding-studio-advanced__summary">מתקדם — פריסת בלוקים</summary>
            <div className="nx-branding-studio-advanced__body">
              {studio.layout_templates.map((layout) => (
                <label key={layout.key} className="nx-branding-studio-advanced__option">
                  <input
                    type="radio"
                    name="layout_template_key"
                    checked={
                      (draft.layout_template_key || studio.selected_layout_template_key || '') === layout.key ||
                      (!draft.layout_template_key && !studio.selected_layout_template_key && false)
                    }
                    disabled={disabled}
                    onChange={() => onDraftChange((d) => ({ ...d, layout_template_key: layout.key }))}
                  />
                  <MarkupPreview markup={layout.mini_preview_markup} className="nx-branding-studio-advanced__mini" />
                  <span>{layout.label}</span>
                </label>
              ))}
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact"
                disabled={disabled}
                onClick={() => onDraftChange((d) => ({ ...d, layout_template_key: '' }))}
              >
                ברירת מחדל לפי סגנון
              </button>
            </div>
          </details>
        ) : null}
      </div>
    );
  }

  if (section === 'logo_branding') {
    return (
      <div className="nx-branding-studio-section">
        <AssetUploadSlot
          slot={profile.logo}
          slotKind="logo"
          busy={busy}
          canEdit={canEdit}
          updateCommand={commands.update_branding_profile}
          onCommand={onCommand}
        />
        <StudioBoolField
          label="הצג לוגו במסמך"
          checked={draft.show_logo === 'true'}
          disabled={disabled}
          onChange={(v) => onDraftChange((d) => ({ ...d, show_logo: boolToDraft(v) }))}
        />
        <LogoSizePicker
          options={studio.logo_size_options}
          selectedKey={draft.logo_size_key}
          logoPreviewUrl={profile.logo.preview_data_url}
          disabled={disabled}
          onSelect={(key) => onDraftChange((d) => ({ ...d, logo_size_key: key }))}
        />
        <StudioField
          label="משפט שיוצג מתחת לשם העסק"
          value={draft.company_subtitle}
          disabled={disabled}
          multiline
          onChange={(v) => onDraftChange((d) => ({ ...d, company_subtitle: v }))}
        />
      </div>
    );
  }

  if (section === 'business') {
    return (
      <div className="nx-branding-studio-section">
        <AssetUploadSlot
          slot={profile.signature}
          slotKind="signature"
          busy={busy}
          canEdit={canEdit}
          updateCommand={commands.update_branding_profile}
          onCommand={onCommand}
        />
        <StudioBoolField
          label="הצג חתימה במסמך"
          checked={draft.show_signature === 'true'}
          disabled={disabled}
          onChange={(v) => onDraftChange((d) => ({ ...d, show_signature: boolToDraft(v) }))}
        />
        <StudioField
          label="טקסט כותרת תחתונה"
          value={draft.footer_text}
          disabled={disabled}
          multiline
          onChange={(v) => onDraftChange((d) => ({ ...d, footer_text: v }))}
        />
      </div>
    );
  }

  if (section === 'payment') {
    return (
      <div className="nx-branding-studio-section">
        <StudioField label="שם בנק" value={draft.bank_name} disabled={disabled} onChange={(v) => onDraftChange((d) => ({ ...d, bank_name: v }))} />
        <StudioField label="סניף" value={draft.bank_branch} disabled={disabled} onChange={(v) => onDraftChange((d) => ({ ...d, bank_branch: v }))} />
        <StudioField label="מספר חשבון" value={draft.bank_account} disabled={disabled} onChange={(v) => onDraftChange((d) => ({ ...d, bank_account: v }))} />
        <StudioField label="IBAN" value={draft.iban} disabled={disabled} onChange={(v) => onDraftChange((d) => ({ ...d, iban: v }))} />
        <StudioField label="SWIFT" value={draft.swift} disabled={disabled} onChange={(v) => onDraftChange((d) => ({ ...d, swift: v }))} />
      </div>
    );
  }

  return (
    <div className="nx-branding-studio-section">
      <StudioField
        label="נושא אימייל"
        value={draft.email_subject_template}
        disabled={disabled}
        hint="{{document_type}} {{document_number}}"
        onChange={(v) => onDraftChange((d) => ({ ...d, email_subject_template: v }))}
      />
      <StudioField
        label="גוף אימייל"
        value={draft.email_body_template}
        disabled={disabled}
        multiline
        onChange={(v) => onDraftChange((d) => ({ ...d, email_body_template: v }))}
      />
      <StudioField
        label="הערות ללקוח (ברירת מחדל)"
        value={draft.customer_notes}
        disabled={disabled}
        multiline
        onChange={(v) => onDraftChange((d) => ({ ...d, customer_notes: v }))}
      />
      <StudioField
        label="תנאים והגבלות"
        value={draft.terms_and_conditions}
        disabled={disabled}
        multiline
        onChange={(v) => onDraftChange((d) => ({ ...d, terms_and_conditions: v }))}
      />
    </div>
  );
}

export function IncomeDocumentBrandingSettingsPanel({
  profile,
  commands,
  busy,
  activeSection,
  onActiveSectionChange,
  draft,
  onDraftChange,
  onCommand,
  onPreviewDraft,
}: Props) {
  const studio = profile.document_branding_studio;
  const canEdit = profile.allowed_actions.includes(commands.update_branding_profile);
  const canPreview = profile.allowed_actions.includes(commands.preview_branding_profile_draft);
  const previewRequestRef = useRef(0);
  const debounceRef = useRef<number | null>(null);

  const [livePreview, setLivePreview] = useState<IncomeDocumentBrandingStudioLivePreview>(
    studio.studio_live_preview,
  );
  const [styleTemplates, setStyleTemplates] = useState(studio.document_style_templates);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setLivePreview(studio.studio_live_preview);
    setStyleTemplates(studio.document_style_templates);
    setPreviewError(null);
  }, [profile]);

  const refreshPreview = useCallback(
    async (nextDraft: IncomeBrandingStudioDraft) => {
      if (!canPreview) return;
      const requestId = ++previewRequestRef.current;
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const result = await onPreviewDraft(buildBrandingPreviewDraftBody(nextDraft));
        if (requestId !== previewRequestRef.current) return;
        if (result) {
          setLivePreview(result.studio_live_preview);
          setStyleTemplates(result.document_style_templates);
        }
      } catch {
        if (requestId !== previewRequestRef.current) return;
        setPreviewError('לא ניתן לרענן תצוגה מקדימה');
      } finally {
        if (requestId === previewRequestRef.current) setPreviewLoading(false);
      }
    },
    [canPreview, onPreviewDraft],
  );

  useEffect(() => {
    if (!canPreview || busy) return;
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void refreshPreview(draft);
    }, 250);
    return () => {
      if (debounceRef.current != null) window.clearTimeout(debounceRef.current);
    };
  }, [draft, canPreview, busy, refreshPreview]);

  const preview = livePreview;

  return (
    <div className="nx-branding-studio" dir="rtl">
      <nav className="nx-branding-studio-nav" aria-label="הגדרות מסמך">
        {studio.navigation_sections.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`nx-branding-studio-nav__btn${activeSection === section.key ? ' nx-branding-studio-nav__btn--active' : ''}`}
            onClick={() => onActiveSectionChange(section.key)}
          >
            {section.label}
          </button>
        ))}
      </nav>
      <aside className="nx-branding-studio-preview" aria-label="תצוגה מקדימה">
        <div className="nx-branding-studio-preview__head">
          <span className="nx-branding-studio-preview__title">תצוגה מקדימה</span>
          <span className="nx-branding-studio-preview__meta">
            {preview.sample_document_type_label}
            {preview.sample_document_number_display ? ` · ${preview.sample_document_number_display}` : ' · טיוטה'}
          </span>
          {previewError ? <span className="nx-branding-studio-preview__warn">{previewError}</span> : null}
        </div>
        <div className="nx-branding-studio-preview__frame">
          {previewLoading ? (
            <div className="nx-branding-studio-preview__loading" aria-live="polite">
              מעדכן תצוגה…
            </div>
          ) : null}
          {preview.visible && preview.preview_html ? (
            <div
              className="nx-branding-studio-preview__doc nx-invoice-ui"
              dangerouslySetInnerHTML={{ __html: preview.preview_html }}
            />
          ) : (
            <p className="nx-branding-studio-preview__empty">אין תצוגה מקדימה</p>
          )}
        </div>
      </aside>
      <div className="nx-branding-studio-content">
        <StudioSectionContent
          section={activeSection}
          styleTemplates={styleTemplates}
          colorThemePresets={studio.color_theme_presets}
          studio={studio}
          profile={profile}
          draft={draft}
          busy={busy}
          canEdit={canEdit}
          commands={commands}
          onDraftChange={onDraftChange}
          onCommand={onCommand}
        />
      </div>
    </div>
  );
}

export function useBrandingModalState(profile: IncomeDocumentBrandingProfileAggregate | null) {
  const [activeSection, setActiveSection] = useState<IncomeBrandingStudioSectionKey>(
    profile?.document_branding_studio.navigation_sections[0]?.key ?? 'document_style',
  );
  const [draft, setDraft] = useState<IncomeBrandingStudioDraft>(() =>
    profile ? buildDraftFromProfile(profile) : ({} as IncomeBrandingStudioDraft),
  );

  useEffect(() => {
    if (!profile) return;
    setDraft(buildDraftFromProfile(profile));
    setActiveSection(profile.document_branding_studio.navigation_sections[0]?.key ?? 'document_style');
  }, [profile]);

  return { activeSection, setActiveSection, draft, setDraft };
}
