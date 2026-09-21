import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../../styles/nx-client-quick-card.css';
import '../../styles/nx-co-client-quick-profile.css';

export type ClientOperationsQuickProfileRow = {
  key: string;
  label_he: string;
  display_value: string;
  visible: boolean;
  copy_enabled: boolean;
  copy_value: string | null;
};

export type ClientOperationsQuickProfileExpenseRow = {
  key: string;
  label_he: string;
  display_value: string;
  visible: boolean;
};

export type ClientOperationsClientQuickProfileAggregate = {
  aggregate_key: string;
  client_id: string;
  title: string;
  reporting_period_key: string | null;
  identity_rows: ClientOperationsQuickProfileRow[];
  accounting_rows: ClientOperationsQuickProfileRow[];
  reporting_rows: ClientOperationsQuickProfileRow[];
  recurring_expense_rows: ClientOperationsQuickProfileExpenseRow[];
  expense_section_title_he: string;
  expense_section_visible: boolean;
  allowed_actions: string[];
};

type Props = {
  profile: ClientOperationsClientQuickProfileAggregate;
  anchorEl: HTMLElement;
  onClose: () => void;
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="nx-client-quick-card__copy"
      aria-label={`העתק ${label}`}
      title={copied ? 'הועתק' : 'העתק'}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function ProfileRow({ row }: { row: ClientOperationsQuickProfileRow }) {
  if (!row.visible) return null;
  return (
    <div className="nx-client-quick-card__row">
      <dt className="nx-client-quick-card__label">{row.label_he}</dt>
      <dd className="nx-client-quick-card__value-wrap">
        <span className="nx-client-quick-card__value" title={row.display_value}>
          {row.display_value}
        </span>
        {row.copy_enabled && row.copy_value ? (
          <CopyButton value={row.copy_value} label={row.label_he} />
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Compact Client Operations Quick Profile popover.
 * Renders only backend-ready rows — no domain branching.
 */
export function ClientOperationsClientQuickProfilePopover({ profile, anchorEl, onClose }: Props) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchorEl.getBoundingClientRect();
      const cardEl = cardRef.current;
      const width = cardEl?.offsetWidth ?? 360;
      const height = cardEl?.offsetHeight ?? 280;
      const margin = 8;
      let left = rect.left;
      let top = rect.bottom + margin;
      if (left + width > window.innerWidth - margin) {
        left = Math.max(margin, window.innerWidth - width - margin);
      }
      if (left < margin) left = margin;
      if (top + height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - height - margin);
      }
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorEl, profile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const identity = (profile.identity_rows ?? []).filter((r) => r.visible);
  const accounting = (profile.accounting_rows ?? []).filter((r) => r.visible);
  const reporting = (profile.reporting_rows ?? []).filter((r) => r.visible);
  const expenses = (profile.recurring_expense_rows ?? []).filter((r) => r.visible);
  const showExpenses = Boolean(profile.expense_section_visible) && expenses.length > 0;

  return createPortal(
    <>
      <div
        className="nx-client-quick-card__backdrop"
        aria-hidden
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={cardRef}
        className="nx-client-quick-card nx-co-client-quick-profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir="rtl"
        style={{ top: pos.top, left: pos.left }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="nx-co-client-quick-profile__header">
          <h2 id={titleId} className="nx-client-quick-card__title">
            {profile.title}
          </h2>
          <button
            type="button"
            className="nx-co-client-quick-profile__close"
            aria-label="סגור"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <dl className="nx-client-quick-card__rows">
          {identity.length > 0 ? (
            <div className="nx-co-client-quick-profile__section">
              <div className="nx-co-client-quick-profile__section-title">פרטי לקוח</div>
              {identity.map((row) => (
                <ProfileRow key={row.key} row={row} />
              ))}
            </div>
          ) : null}
          {accounting.length > 0 ? (
            <div className="nx-co-client-quick-profile__section">
              <div className="nx-co-client-quick-profile__section-title">הנה״ח</div>
              {accounting.map((row) => (
                <ProfileRow key={row.key} row={row} />
              ))}
            </div>
          ) : null}
          {reporting.length > 0 ? (
            <div className="nx-co-client-quick-profile__section">
              <div className="nx-co-client-quick-profile__section-title">מועדי דיווח</div>
              {reporting.map((row) => (
                <ProfileRow key={row.key} row={row} />
              ))}
            </div>
          ) : null}
        </dl>
        {showExpenses ? (
          <div className="nx-co-client-quick-profile__expenses">
            <div className="nx-co-client-quick-profile__expenses-title">
              {profile.expense_section_title_he}
            </div>
            <ul className="nx-co-client-quick-profile__expenses-list">
              {expenses.map((row) => (
                <li key={row.key} className="nx-co-client-quick-profile__expense-row">
                  <span className="nx-co-client-quick-profile__expense-label">{row.label_he}</span>
                  {row.display_value ? (
                    <span className="nx-co-client-quick-profile__expense-value">{row.display_value}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>,
    document.body
  );
}
