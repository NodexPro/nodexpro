import type { CSSProperties } from 'react';
import type { IncomeClientDocumentManagementRow, IncomeClientDocumentTypeCounter } from '../../income/income-workspace-types';

const COUNTER_STYLES: Record<
  string,
  { accent: string; background: string; icon: string }
> = {
  quote: {
    accent: '#2563EB',
    background: 'rgba(37,99,235,0.08)',
    icon: 'quote',
  },
  deal_invoice: {
    accent: '#7C3AED',
    background: 'rgba(124,58,237,0.08)',
    icon: 'deal',
  },
  tax_invoice: {
    accent: '#0891B2',
    background: 'rgba(8,145,178,0.08)',
    icon: 'tax',
  },
  tax_invoice_receipt: {
    accent: '#0D9488',
    background: 'rgba(13,148,136,0.08)',
    icon: 'tax_receipt',
  },
  receipt: {
    accent: '#16A34A',
    background: 'rgba(22,163,74,0.08)',
    icon: 'receipt',
  },
  credit_tax_invoice: {
    accent: '#DC2626',
    background: 'rgba(220,38,38,0.08)',
    icon: 'credit',
  },
  draft: {
    accent: '#64748B',
    background: 'rgba(100,116,139,0.08)',
    icon: 'draft',
  },
};

function CounterIcon({ iconKey }: { iconKey: string }) {
  switch (iconKey) {
    case 'quote':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 7h10M7 11h8M7 15h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M5 4h14a2 2 0 0 1 2 2v12l-3-2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case 'deal':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M8 7h8v10H8V7Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M10 4h4v3h-4V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M10 11h4M10 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'tax':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 4h12v16H6V4Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'tax_receipt':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 4h8v8H6V4Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M14 8h4v12h-4V8Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 8h2M8 11h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'receipt':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 4h10v16l-2-1.5L13 20l-2-1.5L9 20 7 18.5 5 20V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M9 8h6M9 11h6M9 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'credit':
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M12 5v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    default:
      return (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M7 4h10v16H7V4Z" stroke="currentColor" strokeWidth="1.8" strokeDasharray="3 2" />
          <path d="M9 8h6M9 11h6M9 14h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
  }
}

function DocumentTypeCounterButton({
  counter,
  busy,
  onClick,
}: {
  counter: IncomeClientDocumentTypeCounter;
  busy: boolean;
  onClick: (counter: IncomeClientDocumentTypeCounter) => void;
}) {
  const style = COUNTER_STYLES[counter.key] ?? COUNTER_STYLES.draft;
  const muted = counter.count === 0;

  return (
    <button
      type="button"
      className={`nx-we-doc-counter${muted ? ' nx-we-doc-counter--muted' : ''}`}
      style={
        {
          '--nx-we-doc-counter-accent': style.accent,
          '--nx-we-doc-counter-bg': style.background,
        } as CSSProperties
      }
      disabled={busy}
      title={counter.tooltip_label}
      aria-label={`${counter.tooltip_label}: ${counter.count}`}
      onClick={() => onClick(counter)}
    >
      <span className="nx-we-doc-counter__icon" aria-hidden>
        <CounterIcon iconKey={style.icon} />
      </span>
      <span className="nx-we-doc-counter__count">{counter.count}</span>
    </button>
  );
}

type Props = {
  row: IncomeClientDocumentManagementRow;
  busy: boolean;
  onCounterClick: (params: {
    representedClientId: string;
    clientDisplayName: string;
    counter: IncomeClientDocumentTypeCounter;
  }) => void;
};

export function WorkEngineClientDocumentTypeCounters({ row, busy, onCounterClick }: Props) {
  const counters = row.document_type_counters ?? [];

  return (
    <div className="nx-we-doc-counters" role="group" aria-label="מסמכים לפי סוג">
      {counters.map((counter) => (
        <DocumentTypeCounterButton
          key={counter.key}
          counter={counter}
          busy={busy}
          onClick={(selected) =>
            onCounterClick({
              representedClientId: row.represented_client_id,
              clientDisplayName: row.client_display_name,
              counter: selected,
            })
          }
        />
      ))}
    </div>
  );
}
