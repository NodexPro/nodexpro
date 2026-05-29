import { useMemo, useState, type ReactNode } from 'react';
import type { IncomeDocumentDetailsStep } from '../../income/income-document-details-types';
import { WorkEngineIncomeBrandingSidebar } from './WorkEngineIncomeBrandingSidebar';

type Props = {
  step: IncomeDocumentDetailsStep;
  draftId: string;
  brandingCommands: {
    update_branding_profile: string;
    upload_document_logo: string;
    upload_document_signature: string;
  };
  busy: boolean;
  onGeneratePreview: () => void;
  onBrandingCommand: (command: string, body: Record<string, unknown>) => Promise<void>;
};

function settingDisplay(step: IncomeDocumentDetailsStep, key: string): string {
  const field = step.settings_schema.find((f) => f.key === key);
  if (!field?.value) return '—';
  if (field.input_type === 'select' && field.options?.length) {
    const opt = field.options.find((o) => o.value === field.value);
    return opt?.label ?? field.value;
  }
  return field.value;
}

function PreviewSidebarSection({
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

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="nx-we-preview-sidebar__row">
      <span className="nx-we-preview-sidebar__label">{label}</span>
      <span className="nx-we-preview-sidebar__value">{value}</span>
    </div>
  );
}

export function WorkEngineIncomePreviewStep({
  step,
  draftId,
  brandingCommands,
  busy,
  onGeneratePreview,
  onBrandingCommand,
}: Props) {
  const preview = step.document_preview;
  const toolbar = preview?.toolbar_actions ?? [];
  const showPaper = preview?.visible && preview.preview_html?.trim();

  const docMeta = useMemo(
    () => [
      { label: 'סוג מסמך', value: preview?.document_type_label ?? '—' },
      { label: 'מספר מסמך', value: preview?.document_number_preview ?? step.header.document_number_preview ?? 'טיוטה' },
      { label: 'תאריך מסמך', value: preview?.dates.document_date ?? settingDisplay(step, 'document_date') },
      { label: 'תאריך לתשלום', value: preview?.dates.due_date ?? settingDisplay(step, 'due_date') },
      { label: 'מטבע', value: preview?.currency ?? settingDisplay(step, 'currency') },
    ],
    [preview, step],
  );

  const settingsFields = step.settings_schema.filter((f) => f.visible);

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

        <div className="nx-we-preview-canvas">
          {showPaper ? (
            <div className="nx-we-preview-paper">
              <div
                className="nx-we-preview-paper__content"
                dangerouslySetInnerHTML={{ __html: preview!.preview_html }}
              />
            </div>
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

      <aside className="nx-we-preview-sidebar">
        <PreviewSidebarSection title="פרטי המסמך">
          {docMeta.map((row) => (
            <ReadOnlyRow key={row.label} label={row.label} value={row.value} />
          ))}
        </PreviewSidebarSection>

        <PreviewSidebarSection title="הגדרות מסמך (טיוטה)" defaultOpen={false}>
          {settingsFields.map((field) => (
            <ReadOnlyRow
              key={field.key}
              label={field.label}
              value={
                field.input_type === 'select'
                  ? field.options?.find((o) => o.value === field.value)?.label ?? field.value ?? '—'
                  : field.value ?? '—'
              }
            />
          ))}
        </PreviewSidebarSection>

        {step.document_branding_profile ? (
          <WorkEngineIncomeBrandingSidebar
            profile={step.document_branding_profile}
            draftId={draftId}
            commands={brandingCommands}
            busy={busy}
            onCommand={onBrandingCommand}
          />
        ) : null}

        <PreviewSidebarSection title="הנחה לפני מע״מ" defaultOpen={false}>
          <ReadOnlyRow
            label="הנחה פעילה"
            value={step.document_discount.enabled ? 'כן' : 'לא'}
          />
          {step.document_discount.enabled ? (
            <>
              <ReadOnlyRow
                label="סוג"
                value={step.document_discount.type === 'percent' ? 'אחוז' : 'סכום קבוע'}
              />
              <ReadOnlyRow label="ערך" value={step.document_discount.value || '—'} />
              <ReadOnlyRow
                label="סכום מחושב"
                value={step.document_discount.calculated_discount_amount_display ?? '—'}
              />
            </>
          ) : null}
        </PreviewSidebarSection>

        <PreviewSidebarSection title="סיכום">
          <div className="nx-we-preview-sidebar__totals">
            {step.totals_block.rows.map((row) => (
              <div
                key={row.key}
                className={`nx-we-preview-sidebar__total-row${
                  row.emphasized ? ' nx-we-preview-sidebar__total-row--grand' : ''
                }`}
              >
                <span>{row.label}</span>
                <strong>{row.amount_display}</strong>
              </div>
            ))}
          </div>
        </PreviewSidebarSection>
      </aside>
    </div>
  );
}
