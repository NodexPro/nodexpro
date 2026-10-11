/**
 * ToDo client picker — type-to-search combobox (presentation only).
 *
 * Candidates are the backend-authorized clients of the selected workspace (`todo/client-options`);
 * this component only renders them, narrows them by the typed text for instant feedback, and reports
 * the chosen canonical client_id. It never invents, creates or filters by ACL.
 *
 * When the typed text is not an existing client, the last row lets the user keep the typed name as a
 * ONE-TIME client (stored on the ToDo itself by the backend — never a Core client).
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  buildTodoClientPickerRows,
  moveTodoClientPickerIndex,
  todoOneTimeClientOptionLabel,
  TODO_CLIENT_PICKER_VISIBLE_LIMIT,
  type TodoClientPickerOption,
  type TodoClientPickerRow,
} from '../../lib/client-operations-todo-client-picker.pure';

export type ClientOperationsTodoClientPickerProps = {
  /** Canonical client id once an authorized client is chosen; '' otherwise. */
  selectedClientId: string;
  selectedLabel: string;
  /** One-time client name once the typed-name option is chosen; '' otherwise. */
  oneTimeName: string;
  /** Backend flag (`available_clients_hint.one_time_client.allowed`). */
  oneTimeAllowed: boolean;
  /** Backend max length for the one-time client name. */
  oneTimeNameMaxLength?: number;
  /** Text typed while nothing is selected. */
  text: string;
  /** Backend-authorized options for the current workspace (already limited by the backend). */
  options: readonly TodoClientPickerOption[];
  loading: boolean;
  hasMore: boolean;
  onTextChange: (text: string) => void;
  onSelect: (option: TodoClientPickerOption) => void;
  onSelectOneTime: (name: string) => void;
  onClearSelection: () => void;
};

export function ClientOperationsTodoClientPicker(props: ClientOperationsTodoClientPickerProps) {
  const {
    selectedClientId,
    selectedLabel,
    oneTimeName,
    oneTimeAllowed,
    oneTimeNameMaxLength,
    text,
    options,
    loading,
    hasMore,
    onTextChange,
    onSelect,
    onSelectOneTime,
    onClearSelection,
  } = props;
  const uid = useId();
  const inputId = `${uid}-input`;
  const listboxId = `${uid}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLUListElement | null>(null);

  const isOneTime = Boolean(oneTimeName);
  const hasSelection = Boolean(selectedClientId) || isOneTime;
  const rows = useMemo<TodoClientPickerRow[]>(
    () =>
      hasSelection
        ? []
        : buildTodoClientPickerRows(options, text, {
            allowOneTime: oneTimeAllowed,
            limit: TODO_CLIENT_PICKER_VISIBLE_LIMIT,
          }),
    [hasSelection, oneTimeAllowed, options, text],
  );
  const rowsKey = rows.map((r) => (r.kind === 'client' ? r.option.client_id : `one-time:${r.name}`)).join('|');
  const showList = open && !hasSelection;

  // First row is highlighted so Enter picks it (an existing client when there is one, else the typed name).
  useEffect(() => {
    setActiveIndex(rows.length ? 0 : -1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the visible row list
  }, [rowsKey]);

  useEffect(() => {
    if (!showList || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, showList]);

  const choose = (row: TodoClientPickerRow) => {
    if (row.kind === 'client') onSelect(row.option);
    else onSelectOneTime(row.name);
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
      setActiveIndex((cur) => moveTodoClientPickerIndex(cur, e.key === 'ArrowDown' ? 1 : -1, rows.length));
      return;
    }
    if (e.key === 'Enter' && open && activeIndex >= 0 && rows[activeIndex]) {
      // Pick the highlighted row instead of submitting the form.
      e.preventDefault();
      choose(rows[activeIndex]);
      return;
    }
    if (e.key === 'Escape' && open) {
      // Close the list only — not the whole ToDo form.
      e.stopPropagation();
      setOpen(false);
    }
  };

  const clientRowCount = rows.filter((r) => r.kind === 'client').length;
  const noResults = !loading && clientRowCount === 0 && text.trim().length > 0;
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
        value={hasSelection ? (isOneTime ? oneTimeName : selectedLabel) : text}
        placeholder="הקלד שם לקוח או ת.ז./ח.פ."
        maxLength={oneTimeNameMaxLength}
        required
        data-testid="client-operations-todo-client-input"
        data-client-mode={isOneTime ? 'one_time' : selectedClientId ? 'canonical' : 'searching'}
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
      {isOneTime ? (
        <span className="nx-co-todo-client-picker__mode" data-testid="client-operations-todo-one-time-badge">
          לקוח חד פעמי
        </span>
      ) : null}
      {showList ? (
        <ul id={listboxId} ref={listRef} className="nx-co-todo-form__suggest" role="listbox" aria-label="לקוחות">
          {rows.map((row, index) => (
            <li
              key={row.kind === 'client' ? row.option.client_id : 'one-time'}
              id={`${uid}-opt-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              data-option-index={index}
              data-option-kind={row.kind}
              className={[
                index === activeIndex ? 'is-active' : '',
                row.kind === 'one_time' ? 'nx-co-todo-form__suggest-one-time' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              // Keep input focus (no blur-close) until the click handler selects.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(row)}
            >
              <button type="button" tabIndex={-1}>
                {row.kind === 'client' ? (
                  <>
                    <strong>{row.option.display_name ?? row.option.client_id}</strong>
                    <span>{row.option.tax_id ?? ''}</span>
                  </>
                ) : (
                  <strong>{todoOneTimeClientOptionLabel(row.name)}</strong>
                )}
              </button>
            </li>
          ))}
          {loading && clientRowCount === 0 ? (
            <li role="presentation" className="nx-co-todo-form__suggest-note">
              טוען…
            </li>
          ) : null}
          {noResults ? (
            <li role="presentation" className="nx-co-todo-form__suggest-note">
              לא נמצאו לקוחות מתאימים
            </li>
          ) : null}
          {hasMore && clientRowCount > 0 ? (
            <li role="presentation" className="nx-co-todo-form__suggest-note">
              יש עוד לקוחות — המשך להקליד כדי לצמצם
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
