/**
 * ToDo client picker — type-to-search combobox (presentation only).
 *
 * Candidates are the backend-authorized clients of the selected workspace (`todo/client-options`);
 * this component only renders them, narrows them by the typed text for instant feedback, and reports
 * the chosen canonical client_id. It never invents, creates or filters by ACL.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  filterTodoClientOptionsForDisplay,
  moveTodoClientPickerIndex,
  TODO_CLIENT_PICKER_VISIBLE_LIMIT,
  type TodoClientPickerOption,
} from '../../lib/client-operations-todo-client-picker.pure';

export type ClientOperationsTodoClientPickerProps = {
  /** Canonical client id once an authorized client is chosen; '' while still searching. */
  selectedClientId: string;
  selectedLabel: string;
  /** Text typed while no client is selected. */
  text: string;
  /** Backend-authorized options for the current workspace (already limited by the backend). */
  options: readonly TodoClientPickerOption[];
  loading: boolean;
  hasMore: boolean;
  onTextChange: (text: string) => void;
  onSelect: (option: TodoClientPickerOption) => void;
  onClearSelection: () => void;
};

export function ClientOperationsTodoClientPicker(props: ClientOperationsTodoClientPickerProps) {
  const {
    selectedClientId,
    selectedLabel,
    text,
    options,
    loading,
    hasMore,
    onTextChange,
    onSelect,
    onClearSelection,
  } = props;
  const uid = useId();
  const inputId = `${uid}-input`;
  const listboxId = `${uid}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLUListElement | null>(null);

  const hasSelection = Boolean(selectedClientId);
  const visible = useMemo(
    () => (hasSelection ? [] : filterTodoClientOptionsForDisplay(options, text, TODO_CLIENT_PICKER_VISIBLE_LIMIT)),
    [hasSelection, options, text],
  );
  const visibleKey = visible.map((o) => o.client_id).join('|');
  const showList = open && !hasSelection;

  // First match is highlighted so Enter picks it; reset whenever the visible set changes.
  useEffect(() => {
    setActiveIndex(visible.length ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the visible id list
  }, [visibleKey]);

  useEffect(() => {
    if (!showList || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, showList]);

  const choose = (option: TodoClientPickerOption) => {
    onSelect(option);
    setOpen(false);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (hasSelection) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((cur) => moveTodoClientPickerIndex(cur, e.key === 'ArrowDown' ? 1 : -1, visible.length));
      return;
    }
    if (e.key === 'Enter' && open && activeIndex >= 0 && visible[activeIndex]) {
      // Pick the highlighted client instead of submitting the form.
      e.preventDefault();
      choose(visible[activeIndex]);
      return;
    }
    if (e.key === 'Escape' && open) {
      // Close the list only — not the whole ToDo form.
      e.stopPropagation();
      setOpen(false);
    }
  };

  const noResults = !loading && visible.length === 0 && text.trim().length > 0;
  const activeOptionId = activeIndex >= 0 ? `${uid}-opt-${activeIndex}` : undefined;

  return (
    <div className="nx-co-todo-form__field nx-co-todo-client-picker">
      <label htmlFor={inputId}>לקוח</label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? activeOptionId : undefined}
        autoComplete="off"
        spellCheck={false}
        value={hasSelection ? selectedLabel : text}
        placeholder="הקלד שם לקוח או ת.ז./ח.פ."
        required
        data-testid="client-operations-todo-client-input"
        onFocus={(e) => {
          setOpen(true);
          // A chosen client is replaced by simply typing over it.
          if (hasSelection) e.currentTarget.select();
        }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          if (hasSelection) onClearSelection();
          setOpen(true);
          onTextChange(e.target.value);
        }}
      />
      {showList ? (
        <ul id={listboxId} ref={listRef} className="nx-co-todo-form__suggest" role="listbox" aria-label="לקוחות">
          {visible.map((o, index) => (
            <li
              key={o.client_id}
              id={`${uid}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              data-option-index={index}
              className={index === activeIndex ? 'is-active' : undefined}
              // Keep input focus (no blur-close) until the click handler selects.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(o)}
            >
              <button type="button" tabIndex={-1}>
                <strong>{o.display_name ?? o.client_id}</strong>
                <span>{o.tax_id ?? ''}</span>
              </button>
            </li>
          ))}
          {loading && visible.length === 0 ? (
            <li role="presentation" className="nx-co-todo-form__suggest-note">
              טוען…
            </li>
          ) : null}
          {noResults ? (
            <li role="presentation" className="nx-co-todo-form__suggest-note">
              לא נמצאו לקוחות מתאימים
            </li>
          ) : null}
          {hasMore && visible.length > 0 ? (
            <li role="presentation" className="nx-co-todo-form__suggest-note">
              יש עוד לקוחות — המשך להקליד כדי לצמצם
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
