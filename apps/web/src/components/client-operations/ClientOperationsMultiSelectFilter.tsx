import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  clientOperationsMultiSelectTriggerLabel,
  isClientOperationsMultiSelectAll,
  parseClientOperationsMultiSelectCsv,
  toggleClientOperationsMultiSelectCsv,
} from '../../lib/client-operations-filter-multi-select.pure';

export type ClientOperationsMultiSelectFilterOption = {
  id: string;
  label_he: string;
  enabled: boolean;
};

type Props = {
  filterId: string;
  labelHe: string;
  options: ClientOperationsMultiSelectFilterOption[];
  value: string;
  disabled?: boolean;
  onChange: (nextCsv: string) => void;
};

export function ClientOperationsMultiSelectFilter({
  filterId,
  labelHe,
  options,
  value,
  disabled = false,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId();
  const listId = `co-filter-multi-${filterId}-${reactId}`;
  const selectedIds = parseClientOperationsMultiSelectCsv(value);
  const allSelected = isClientOperationsMultiSelectAll(value);
  const allOption = options.find((o) => o.id === 'all');
  const allLabel = allOption?.label_he ?? 'הכל';
  const triggerLabel = clientOperationsMultiSelectTriggerLabel(labelHe, allLabel, selectedIds);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelectorAll<HTMLElement>('[data-filter-option]')[highlight];
    el?.focus();
  }, [open, highlight]);

  const commitOption = (optionId: string) => {
    const next = toggleClientOperationsMultiSelectCsv(value, optionId);
    onChange(next ?? 'all');
  };

  const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
      setHighlight(0);
    }
  };

  const onOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((index + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((index - 1 + options.length) % options.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHighlight(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setHighlight(options.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const opt = options[index];
      if (opt && opt.enabled !== false) commitOption(opt.id);
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className="nx-co-sheet__filter-multi" ref={wrapRef}>
      <button
        type="button"
        className="nx-co-sheet__filter-select nx-co-sheet__filter-multi-trigger"
        disabled={disabled}
        title={triggerLabel}
        aria-label={labelHe}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        data-filter-multi-trigger={filterId}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          setHighlight(0);
        }}
        onKeyDown={onTriggerKeyDown}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div
          ref={listRef}
          id={listId}
          className="nx-co-sheet__filter-multi-menu"
          role="listbox"
          aria-multiselectable="true"
          aria-label={labelHe}
        >
          {options.map((opt, index) => {
            const checked = opt.id === 'all' ? allSelected : selectedIds.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                data-filter-option={opt.id}
                className={`nx-co-sheet__filter-multi-option${highlight === index ? ' is-highlight' : ''}`}
                aria-selected={checked}
                disabled={opt.enabled === false}
                tabIndex={highlight === index ? 0 : -1}
                onMouseEnter={() => setHighlight(index)}
                onKeyDown={(event) => onOptionKeyDown(event, index)}
                onClick={() => {
                  if (opt.enabled === false) return;
                  commitOption(opt.id);
                }}
              >
                <input
                  type="checkbox"
                  className="nx-co-sheet__checkbox"
                  checked={checked}
                  disabled={opt.enabled === false}
                  tabIndex={-1}
                  aria-hidden="true"
                  readOnly
                />
                <span>{opt.label_he}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
