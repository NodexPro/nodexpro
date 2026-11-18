import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addCalendarMonths,
  buildFilingCalendarCells,
  formatCalendarMonthLabel,
  formatFilingDateDisplay,
  calendarWeekdayLabels,
  parseIsoDate,
  placeFilingCalendar,
  type FilingCalendarPlacement,
} from '../../lib/client-operations-filing-date-field.pure';

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ClientOperationsFilingDateField(props: {
  id: string;
  label: string;
  value: string;
  lang: string;
  dir: 'rtl' | 'ltr';
  disabled?: boolean;
  required?: boolean;
  pending?: boolean;
  calendarClassName?: string;
  onChange: (iso: string) => void;
}) {
  const { id, label, value, lang, dir, disabled, required, pending, calendarClassName, onChange } = props;
  const parsed = parseIsoDate(value);
  const today = new Date();
  const initial = parsed ?? { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState({ year: initial.year, month: initial.month });
  const [placement, setPlacement] = useState<FilingCalendarPlacement | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const weekdayLabels = useMemo(() => calendarWeekdayLabels(lang), [lang]);
  const cells = useMemo(
    () => buildFilingCalendarCells(visible.year, visible.month, lang),
    [visible.year, visible.month, lang],
  );
  const display = formatFilingDateDisplay(value, lang);

  useEffect(() => {
    if (!open) return;
    const next = parseIsoDate(value);
    if (next) setVisible({ year: next.year, month: next.month });
  }, [open, value]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      setPlacement(
        placeFilingCalendar({
          anchor: el.getBoundingClientRect(),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          dir,
        }),
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, dir, visible.year, visible.month]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        anchorRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [open]);

  return (
    <div className="nx-co-filing-date">
      <label className="nx-co-filing-date__label" htmlFor={id}>
        {label}
      </label>
      <button
        ref={anchorRef}
        id={id}
        type="button"
        className={`nx-co-filing-date__control${pending ? ' is-pending' : ''}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-required={required || undefined}
        data-testid="client-operations-filing-date-field"
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
      >
        <span className={`nx-co-filing-date__value${display ? '' : ' is-empty'}`}>{display}</span>
        <span className="nx-co-filing-date__icon">
          <CalendarGlyph />
        </span>
      </button>
      {open && placement && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              className={`nx-co-filing-calendar${calendarClassName ? ` ${calendarClassName}` : ''}`}
              role="dialog"
              dir={dir}
              aria-label={label}
              data-testid="client-operations-filing-calendar"
              style={{ left: placement.left, top: placement.top, width: placement.width }}
            >
              <div className="nx-co-filing-calendar__nav">
                <button
                  type="button"
                  className="nx-co-filing-calendar__nav-btn"
                  aria-label={formatCalendarMonthLabel(visible.year, visible.month, lang)}
                  onClick={() => setVisible((current) => addCalendarMonths(current.year, current.month, -1))}
                >
                  {dir === 'rtl' ? '›' : '‹'}
                </button>
                <div className="nx-co-filing-calendar__month">{formatCalendarMonthLabel(visible.year, visible.month, lang)}</div>
                <button
                  type="button"
                  className="nx-co-filing-calendar__nav-btn"
                  onClick={() => setVisible((current) => addCalendarMonths(current.year, current.month, 1))}
                >
                  {dir === 'rtl' ? '‹' : '›'}
                </button>
              </div>
              <div className="nx-co-filing-calendar__weekdays">
                {weekdayLabels.map((day, index) => (
                  <span key={`${day}-${index}`}>{day}</span>
                ))}
              </div>
              <div className="nx-co-filing-calendar__grid">
                {cells.map((cell) => (
                  <button
                    key={cell.iso}
                    type="button"
                    className={`nx-co-filing-calendar__day${cell.inMonth ? '' : ' is-outside'}${
                      cell.iso === value ? ' is-selected' : ''
                    }`}
                    onClick={() => {
                      onChange(cell.iso);
                      setOpen(false);
                    }}
                  >
                    {cell.day}
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
