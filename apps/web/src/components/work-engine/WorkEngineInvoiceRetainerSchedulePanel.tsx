import { useEffect, useRef, useState } from 'react';
import type {
  WorkEngineInvoiceRetainerScheduleProjection,
  WorkEngineInvoiceRetainerScheduleProjectionAction,
} from '../../income/income-workspace-types';

type Props = {
  projection: WorkEngineInvoiceRetainerScheduleProjection;
};

function initialExpandedYears(projection: WorkEngineInvoiceRetainerScheduleProjection): Set<number> {
  return new Set(
    projection.years.filter((year) => year.expanded_by_default).map((year) => year.year),
  );
}

function ScheduleRowMenu({ actions }: { actions: WorkEngineInvoiceRetainerScheduleProjectionAction[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div className="nx-we-retainer-schedule__menu" ref={rootRef}>
      <button
        type="button"
        className="nx-we-retainer-schedule__menu-trigger"
        aria-label="פעולות"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ⋮
      </button>
      {open ? (
        <div className="nx-we-retainer-schedule__menu-panel" role="menu">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className="nx-we-retainer-schedule__menu-item"
              disabled={action.disabled}
              title={action.disabled_reason ?? undefined}
              onClick={() => setOpen(false)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function WorkEngineInvoiceRetainerSchedulePanel({ projection }: Props) {
  const [expandedYears, setExpandedYears] = useState<Set<number>>(() =>
    initialExpandedYears(projection),
  );

  useEffect(() => {
    setExpandedYears(initialExpandedYears(projection));
  }, [projection.default_expanded_year, projection.years]);

  if (projection.status !== 'ready') {
    return (
      <div className="nx-we-retainer-schedule__unavailable">
        <p>{projection.unavailable_message ?? 'לוח הזמנים אינו זמין.'}</p>
      </div>
    );
  }

  if (projection.years.length === 0) {
    return (
      <div className="nx-we-retainer-schedule__unavailable">
        <p>אין מסמכים מתוכננים להצגה.</p>
      </div>
    );
  }

  const summary = projection.summary;

  return (
    <div className="nx-we-retainer-schedule" dir="rtl">
      {summary ? (
        <section className="nx-we-retainer-schedule__summary">
          <h3 className="nx-we-retainer-schedule__summary-title">{summary.title}</h3>
          <dl className="nx-we-retainer-schedule__summary-grid">
            <div className="nx-we-retainer-schedule__summary-row">
              <dt>{summary.cycle_label}</dt>
              <dd>{summary.cycle_display}</dd>
            </div>
            <div className="nx-we-retainer-schedule__summary-row">
              <dt>סטטוס</dt>
              <dd>{summary.status_label}</dd>
            </div>
            <div className="nx-we-retainer-schedule__summary-row">
              <dt>{summary.documents_in_horizon_label}</dt>
              <dd>{summary.documents_in_horizon_count}</dd>
            </div>
            <div className="nx-we-retainer-schedule__summary-row">
              <dt>{summary.next_document_label}</dt>
              <dd>{summary.next_document_date_display}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {projection.recurrence_rule_display ? (
        <p className="nx-we-retainer-schedule__recurrence">{projection.recurrence_rule_display}</p>
      ) : null}

      <div className="nx-we-retainer-schedule__years">
        {projection.years.map((yearGroup) => {
          const expanded = expandedYears.has(yearGroup.year);
          return (
            <section key={yearGroup.year} className="nx-we-retainer-schedule__year">
              <button
                type="button"
                className="nx-we-retainer-schedule__year-toggle"
                aria-expanded={expanded}
                onClick={() =>
                  setExpandedYears((prev) => {
                    const next = new Set(prev);
                    if (next.has(yearGroup.year)) next.delete(yearGroup.year);
                    else next.add(yearGroup.year);
                    return next;
                  })
                }
              >
                <span className="nx-we-retainer-schedule__year-chevron" aria-hidden>
                  {expanded ? '▼' : '▶'}
                </span>
                <span className="nx-we-retainer-schedule__year-title">{yearGroup.label}</span>
                <span className="nx-we-retainer-schedule__year-meta">
                  <span className="nx-we-retainer-schedule__year-count">
                    {yearGroup.total_count_label}
                  </span>
                  <span className="nx-we-retainer-schedule__year-total">
                    {yearGroup.yearly_total_amount_display}
                  </span>
                </span>
              </button>

              {expanded ? (
                <ul className="nx-we-retainer-schedule__rows">
                  {yearGroup.rows.map((row) => (
                    <li
                      key={row.projection_key}
                      className={`nx-we-retainer-schedule__row nx-we-retainer-schedule__row--${row.status_tone}`}
                    >
                      <span
                        className={`nx-we-retainer-schedule__icon nx-we-retainer-schedule__icon--${row.icon_key}`}
                        aria-hidden
                      >
                        {row.icon_display}
                      </span>
                      <span className="nx-we-retainer-schedule__date">
                        {row.scheduled_document_date_display}
                      </span>
                      <span className="nx-we-retainer-schedule__amount">{row.amount_display}</span>
                      <span className="nx-we-retainer-schedule__type">{row.document_type_label}</span>
                      <span className="nx-we-retainer-schedule__status">{row.status_label}</span>
                      <ScheduleRowMenu actions={row.actions} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
