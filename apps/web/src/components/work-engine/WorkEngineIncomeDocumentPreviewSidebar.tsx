import { useMemo, useState, type ReactNode } from 'react';
import type { IncomeDocumentDetailsStep } from '../../income/income-document-details-types';

type Props = {
  step: IncomeDocumentDetailsStep;
};

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

export function WorkEngineIncomeDocumentPreviewSidebar({ step }: Props) {
  const preview = step.document_preview;

  const paymentTermsLabel = useMemo(() => {
    const field = step.settings_schema.find((f) => f.key === 'payment_terms');
    if (!field?.visible || !field.value) return null;
    const option = field.options?.find((o) => o.value === field.value);
    return option?.label ?? field.value;
  }, [step.settings_schema]);

  const docMetaHead = useMemo(
    () => [
      { label: 'סוג מסמך', value: preview?.document_type_label ?? '—' },
      {
        label: 'מספר מסמך',
        value: preview?.document_number_preview ?? step.header.document_number_preview ?? 'טיוטה',
      },
      { label: 'תאריך מסמך', value: preview?.dates.document_date ?? '—' },
      { label: 'תאריך לתשלום', value: preview?.dates.due_date ?? '—' },
    ],
    [preview, step],
  );

  const docMetaTail = useMemo(
    () => [{ label: 'מטבע', value: preview?.currency ?? '—' }],
    [preview],
  );

  return (
    <aside className="nx-we-preview-sidebar">
      <PreviewSidebarSection title="פרטי המסמך">
        {docMetaHead.map((row) => (
          <ReadOnlyRow key={row.label} label={row.label} value={row.value} />
        ))}
        {paymentTermsLabel ? (
          <ReadOnlyRow label="תנאי תשלום" value={paymentTermsLabel} />
        ) : null}
        {docMetaTail.map((row) => (
          <ReadOnlyRow key={row.label} label={row.label} value={row.value} />
        ))}
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
  );
}
