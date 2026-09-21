import { useMemo, useState } from 'react';
import {
  buildClientOperationsOperationalPeriodKey,
  formatClientOperationsOperationalPeriodTabLabel,
  isClientOperationsOperationalPeriodKey,
  parseClientOperationsOperationalPeriodKey,
} from '../../lib/client-operations-operational-period-label.pure';

export type ClientOperationsPeriodSheetTabsProps = {
  availablePeriods: string[];
  selectedPeriodKey: string | null;
  defaultPeriodKey: string | null;
  disabled?: boolean;
  onSelectPeriod: (operationalPeriodKey: string) => void;
};

/**
 * Excel-style operational period sheet tabs.
 * Renders backend available_periods only; + opens a compact period picker
 * that requests another YYYY-MM via the parent (GET registry).
 */
export function ClientOperationsPeriodSheetTabs(props: ClientOperationsPeriodSheetTabsProps) {
  const { availablePeriods, selectedPeriodKey, defaultPeriodKey, disabled, onSelectPeriod } = props;
  const [plusOpen, setPlusOpen] = useState(false);

  const seed = parseClientOperationsOperationalPeriodKey(
    selectedPeriodKey || defaultPeriodKey || '',
  );
  const [month, setMonth] = useState<number>(seed?.month ?? 1);
  const [year, setYear] = useState<number>(seed?.year ?? new Date().getFullYear());

  const tabs = useMemo(() => {
    const keys = availablePeriods.filter(isClientOperationsOperationalPeriodKey);
    const ordered = [...keys].sort((a, b) => a.localeCompare(b));
    return ordered;
  }, [availablePeriods]);

  const openPlus = () => {
    const current = parseClientOperationsOperationalPeriodKey(
      selectedPeriodKey || defaultPeriodKey || '',
    );
    if (current) {
      setMonth(current.month);
      setYear(current.year);
    }
    setPlusOpen(true);
  };

  const submitOpenPeriod = () => {
    const key = buildClientOperationsOperationalPeriodKey(month, year);
    if (!key) return;
    setPlusOpen(false);
    onSelectPeriod(key);
  };

  return (
    <div className="nx-co-sheet__period-tabs" data-testid="client-operations-period-tabs" dir="rtl">
      <div className="nx-co-sheet__period-tabs-scroll" role="tablist" aria-label="חודשי תפעול">
        {tabs.map((key) => {
          const active = key === selectedPeriodKey;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`nx-co-sheet__period-tab${active ? ' is-active' : ''}`}
              disabled={disabled || active}
              onClick={() => onSelectPeriod(key)}
              title={key}
            >
              {formatClientOperationsOperationalPeriodTabLabel(key)}
            </button>
          );
        })}
        <button
          type="button"
          className="nx-co-sheet__period-tab nx-co-sheet__period-tab--plus"
          disabled={disabled}
          aria-label="פתיחת חודש תפעול"
          title="פתיחת חודש"
          onClick={openPlus}
        >
          +
        </button>
      </div>

      {plusOpen ? (
        <div className="nx-co-sheet__period-opener" role="dialog" aria-label="בחירת חודש תפעול">
          <label className="nx-co-sheet__period-opener-field">
            <span>חודש</span>
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              aria-label="חודש"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, '0')}
                </option>
              ))}
            </select>
          </label>
          <label className="nx-co-sheet__period-opener-field">
            <span>שנה</span>
            <input
              type="number"
              min={2000}
              max={2100}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label="שנה"
            />
          </label>
          <div className="nx-co-sheet__period-opener-actions">
            <button type="button" className="nx-co-sheet__btn" onClick={() => setPlusOpen(false)}>
              סגור
            </button>
            <button
              type="button"
              className="nx-co-sheet__btn is-active"
              onClick={submitOpenPeriod}
              disabled={!buildClientOperationsOperationalPeriodKey(month, year)}
            >
              פתח
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
