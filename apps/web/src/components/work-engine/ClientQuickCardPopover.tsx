import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  IncomeClientQuickCard,
  IncomeClientQuickCardAction,
  IncomeClientQuickCardRow,
} from '../../api/income';

type Props = {
  card: IncomeClientQuickCard;
  anchorEl: HTMLElement;
  busy: boolean;
  onClose: () => void;
  onAction: (action: IncomeClientQuickCardAction) => void | Promise<void>;
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
        <path
          d="M5 15V5a2 2 0 0 1 2-2h10"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

function IdentityRow({ row }: { row: IncomeClientQuickCardRow }) {
  return (
    <div className="nx-client-quick-card__row">
      <dt className="nx-client-quick-card__label">{row.label}</dt>
      <dd className="nx-client-quick-card__value-wrap">
        <span
          className={
            row.key === 'client_name'
              ? 'nx-client-quick-card__value nx-client-quick-card__value--wrap'
              : 'nx-client-quick-card__value'
          }
          title={row.display_value}
        >
          {row.display_value}
        </span>
        {row.copy_enabled && row.copy_value ? (
          <CopyButton value={row.copy_value} label={row.label} />
        ) : null}
      </dd>
    </div>
  );
}

/**
 * Shared Quick Card renderer — same component for office clients and end customers.
 * Renders only backend `rows` + `actions` (no population branching).
 */
export function ClientQuickCardPopover({ card, anchorEl, busy, onClose, onAction }: Props) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchorEl.getBoundingClientRect();
      const cardEl = cardRef.current;
      const width = cardEl?.offsetWidth ?? 400;
      const height = cardEl?.offsetHeight ?? 320;
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
  }, [anchorEl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

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
        className="nx-client-quick-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        dir="rtl"
        style={{ top: pos.top, left: pos.left }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="nx-client-quick-card__title">
          כרטיס לקוח
        </h2>
        <dl className="nx-client-quick-card__rows">
          {(card.rows ?? []).map((row) => (
            <IdentityRow key={row.key} row={row} />
          ))}
        </dl>
        {(card.actions ?? []).length > 0 ? (
          <div className="nx-client-quick-card__actions">
            {(card.actions ?? []).map((action) => (
              <button
                key={action.action_key}
                type="button"
                className="nx-btn nx-btn-taxes-compact nx-client-quick-card__action-btn"
                disabled={busy || !action.enabled}
                title={
                  action.enabled
                    ? action.label
                    : (action.disabled_reason ?? action.label)
                }
                onClick={() => void onAction(action)}
              >
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </>,
    document.body,
  );
}
