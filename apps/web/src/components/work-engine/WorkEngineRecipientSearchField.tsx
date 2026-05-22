import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { IncomeWorkspaceAggregate } from '../../api/income';
import { executeIncomeCommand } from '../../api/income';
import type { WorkEngineInvoicesDocumentCreationEntrypoint } from '../../api/work-engine';

type RecipientFieldKey =
  | 'display_name'
  | 'tax_id'
  | 'phone'
  | 'email'
  | 'address'
  | 'city'
  | 'save_for_future';

type CreateFieldValues = Record<RecipientFieldKey, string>;

type PendingKind = 'select' | 'create';

type PendingState = {
  kind: PendingKind;
  targetId?: string;
};

const EMPTY_CREATE: CreateFieldValues = {
  display_name: '',
  tax_id: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  save_for_future: '',
};

const DEV = import.meta.env.DEV;

function devLog(message: string, detail?: Record<string, unknown>) {
  if (DEV) {
    // eslint-disable-next-line no-console
    console.debug(`[WE recipient] ${message}`, detail ?? '');
  }
}

export type WorkEngineRecipientSearchFieldHandle = {
  /** Commits inline new recipient via backend command when form is open; otherwise returns current aggregate if selected. */
  commitPendingCreate: () => Promise<IncomeWorkspaceAggregate | null>;
};

type Props = {
  wizard: WorkEngineInvoicesDocumentCreationEntrypoint['wizard'];
  workspaceAgg: IncomeWorkspaceAggregate | null;
  busy: boolean;
  onWorkspaceAgg: (agg: IncomeWorkspaceAggregate) => void;
  onError: (msg: string | null) => void;
  onPendingChange: (pending: boolean) => void;
};

export const WorkEngineRecipientSearchField = forwardRef<
  WorkEngineRecipientSearchFieldHandle,
  Props
>(function WorkEngineRecipientSearchField(
  { wizard, workspaceAgg, busy, onWorkspaceAgg, onError, onPendingChange },
  ref,
) {
  const shell = wizard.recipient_search;
  const model = workspaceAgg?.recipient_search;
  const cmds = wizard.income_commands;

  const [query, setQuery] = useState('');
  const [showCreateInline, setShowCreateInline] = useState(false);
  const [createValues, setCreateValues] = useState<CreateFieldValues>(EMPTY_CREATE);
  const [pending, setPending] = useState<PendingState | null>(null);
  const [searching, setSearching] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectInFlight = useRef(false);
  const createInFlight = useRef(false);
  const searchInFlight = useRef(false);
  const skipSearchEffectRef = useRef(false);
  const initialSearchDone = useRef(false);
  const mountedRef = useRef(true);

  const selectedCustomerId =
    model?.selected?.kind === 'saved' ? model.selected.income_customer_id : null;

  const recipientCommandLocked = busy || pending !== null;

  const clearRecipientPending = useCallback(() => {
    if (!mountedRef.current) return;
    setPending(null);
    onPendingChange(false);
  }, [onPendingChange]);

  const setRecipientPending = useCallback(
    (next: PendingState) => {
      if (!mountedRef.current) return;
      setPending(next);
      onPendingChange(true);
    },
    [onPendingChange],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (searchTimer.current) clearTimeout(searchTimer.current);
      selectInFlight.current = false;
      createInFlight.current = false;
      searchInFlight.current = false;
      onPendingChange(false);
    };
  }, [onPendingChange]);

  const runSearch = useCallback(
    async (q: string) => {
      if (!cmds.search_recipients || !mountedRef.current) return;
      if (selectInFlight.current || createInFlight.current || searchInFlight.current) {
        devLog('search_income_recipients skipped — command already in flight');
        return;
      }
      searchInFlight.current = true;
      setSearching(true);
      devLog('search_income_recipients', { query: q });
      onError(null);
      try {
        const res = await executeIncomeCommand(cmds.search_recipients, { query: q });
        if ('income_workspace_aggregate' in res) {
          onWorkspaceAgg(res.income_workspace_aggregate);
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : 'שגיאת חיפוש');
      } finally {
        searchInFlight.current = false;
        if (mountedRef.current) setSearching(false);
      }
    },
    [cmds.search_recipients, onError, onWorkspaceAgg],
  );

  useEffect(() => {
    if (!model || selectInFlight.current || createInFlight.current) return;

    if (skipSearchEffectRef.current) {
      skipSearchEffectRef.current = false;
      return;
    }

    if (!initialSearchDone.current) {
      initialSearchDone.current = true;
      void runSearch(query);
      return;
    }

    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void runSearch(query);
    }, 280);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, model, runSearch]);

  const listRows = useMemo(() => {
    if (!model) return [];
    const q = query.trim();
    return q.length > 0 ? model.search_results : model.recent_recipients;
  }, [model, query]);

  const fieldErrors = model?.field_errors ?? {};
  const selectedLine = model?.selected?.display_line ?? null;

  const textFields = shell.create_fields_schema.filter((f) => f.input_type === 'text');
  const saveField = shell.create_fields_schema.find((f) => f.key === 'save_for_future');

  const buildCreateBody = useCallback(
    (): Record<string, unknown> => ({
      display_name: createValues.display_name.trim(),
      tax_id: createValues.tax_id.trim() || null,
      phone: createValues.phone.trim() || null,
      email: createValues.email.trim() || null,
      address: createValues.address.trim() || null,
      city: createValues.city.trim() || null,
    }),
    [createValues],
  );

  const commitInlineCreate = useCallback(async (): Promise<IncomeWorkspaceAggregate | null> => {
    if (createInFlight.current || selectInFlight.current) {
      devLog('create recipient skipped — command already in flight');
      return null;
    }
    const saveForFuture = createValues.save_for_future === 'true';
    const command = saveForFuture ? cmds.save_recipient_for_future : cmds.set_recipient_snapshot;
    if (!command) return null;

    createInFlight.current = true;
    setRecipientPending({ kind: 'create' });
    devLog(saveForFuture ? 'save_income_recipient_for_future' : 'set_income_recipient_snapshot');
    onError(null);
    try {
      const res = await executeIncomeCommand(command, buildCreateBody());
      if (!('income_workspace_aggregate' in res)) return null;
      const agg = res.income_workspace_aggregate;
      onWorkspaceAgg(agg);
      const errs = agg.recipient_search?.field_errors ?? {};
      if (Object.keys(errs).length > 0) return null;
      if (!agg.recipient_search?.selected) {
        onError('מקבל לא נשמר');
        return null;
      }
      skipSearchEffectRef.current = true;
      setQuery(agg.recipient_search.selected.display_line);
      setShowCreateInline(false);
      setCreateValues(EMPTY_CREATE);
      return agg;
    } catch (e) {
      onError(e instanceof Error ? e.message : 'שגיאה');
      return null;
    } finally {
      createInFlight.current = false;
      clearRecipientPending();
    }
  }, [
    buildCreateBody,
    clearRecipientPending,
    cmds.save_recipient_for_future,
    cmds.set_recipient_snapshot,
    createValues.save_for_future,
    onError,
    onWorkspaceAgg,
    setRecipientPending,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      commitPendingCreate: async () => {
        if (selectInFlight.current || createInFlight.current) {
          devLog('commitPendingCreate skipped — command in flight');
          return null;
        }
        if (showCreateInline && createValues.display_name.trim()) {
          devLog('commitPendingCreate → inline create command only');
          return commitInlineCreate();
        }
        if (workspaceAgg?.recipient_search?.selected) {
          devLog('commitPendingCreate → already selected, no command');
          return workspaceAgg;
        }
        return null;
      },
    }),
    [commitInlineCreate, createValues.display_name, showCreateInline, workspaceAgg],
  );

  const handleSelectRecipient = async (incomeCustomerId: string) => {
    if (selectInFlight.current) {
      devLog('select_income_recipient ignored — already in flight');
      return;
    }
    if (selectedCustomerId === incomeCustomerId && model?.selected) {
      devLog('select_income_recipient skipped — already selected', { incomeCustomerId });
      return;
    }

    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
    }

    selectInFlight.current = true;
    setRecipientPending({ kind: 'select', targetId: incomeCustomerId });
    devLog('select_income_recipient', { income_customer_id: incomeCustomerId });
    onError(null);

    try {
      const res = await executeIncomeCommand(cmds.select_recipient, {
        income_customer_id: incomeCustomerId,
      });
      if (!('income_workspace_aggregate' in res)) {
        onError('תגובת שרת לא תקינה');
        return;
      }
      const agg = res.income_workspace_aggregate;
      onWorkspaceAgg(agg);
      const selected = agg.recipient_search?.selected;
      if (!selected) {
        onError('מקבל לא נבחר');
        return;
      }
      skipSearchEffectRef.current = true;
      setQuery(selected.display_line);
      setShowCreateInline(false);
      setCreateValues(EMPTY_CREATE);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      selectInFlight.current = false;
      clearRecipientPending();
    }
  };

  return (
    <div className="nx-we-recipient-search nx-we-recipient-search--wizard" dir="rtl">
      <div className="nx-we-recipient-search__search-row">
        <div className="nx-income-field nx-we-recipient-search__search-field">
          <label>{shell.label}</label>
          <input
            type="search"
            value={query}
            placeholder={shell.placeholder}
            disabled={recipientCommandLocked || !workspaceAgg}
            aria-busy={searching}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {searching && !pending ? (
          <span className="nx-we-recipient-search__status" role="status">
            <span className="nx-we-recipient-search__spinner" aria-hidden />
            מחפש...
          </span>
        ) : null}
      </div>

      {pending?.kind === 'select' ? (
        <p className="nx-we-recipient-search__status nx-we-recipient-search__status--bar" role="status">
          <span className="nx-we-recipient-search__spinner" aria-hidden />
          טוען מקבל...
        </p>
      ) : selectedLine ? (
        <p className="nx-we-recipient-search__selected">נבחר: {selectedLine}</p>
      ) : null}

      {model ? (
        <div
          className={`nx-we-recipient-search__panel ${pending || searching ? 'nx-we-recipient-search__panel--loading' : ''}`}
          aria-busy={pending?.kind === 'select' || searching}
        >
          {listRows.map((row) => {
            const isPendingRow = pending?.kind === 'select' && pending.targetId === row.income_customer_id;
            const isSelectedRow = selectedCustomerId === row.income_customer_id && !pending;
            return (
              <button
                key={row.income_customer_id}
                type="button"
                className={`nx-we-recipient-search__option ${isSelectedRow ? 'nx-we-recipient-search__option--selected' : ''} ${isPendingRow ? 'nx-we-recipient-search__option--pending' : ''}`}
                disabled={recipientCommandLocked}
                onClick={() => void handleSelectRecipient(row.income_customer_id)}
              >
                <span className="nx-we-recipient-search__option-text">{row.display_line}</span>
                {isPendingRow ? (
                  <span className="nx-we-recipient-search__option-spinner">
                    <span className="nx-we-recipient-search__spinner" aria-hidden />
                    טוען...
                  </span>
                ) : null}
              </button>
            );
          })}
          {model.empty_state.visible && listRows.length === 0 && !searching ? (
            <div className="nx-we-recipient-search__empty">{model.empty_state.message}</div>
          ) : null}
          <button
            type="button"
            className="nx-we-recipient-search__option nx-we-recipient-search__option--create"
            disabled={recipientCommandLocked || !model.create_new_action.enabled}
            title={model.create_new_action.disabled_reason ?? undefined}
            onClick={() => {
              if (recipientCommandLocked) return;
              setShowCreateInline(true);
            }}
          >
            {model.create_new_action.label}
          </button>
        </div>
      ) : null}

      {showCreateInline ? (
        <div className="nx-we-recipient-search__create">
          {pending?.kind === 'create' ? (
            <p className="nx-we-recipient-search__status" role="status">
              <span className="nx-we-recipient-search__spinner" aria-hidden />
              שומר מקבל...
            </p>
          ) : null}
          <div className="nx-we-recipient-search__create-grid">
            {textFields.map((field) => (
              <div key={field.key} className="nx-income-field">
                <label>
                  {field.label}
                  {field.required ? ' *' : ''}
                </label>
                <input
                  value={createValues[field.key as RecipientFieldKey] ?? ''}
                  disabled={recipientCommandLocked}
                  onChange={(e) =>
                    setCreateValues((v) => ({ ...v, [field.key]: e.target.value }))
                  }
                />
                {fieldErrors[field.key] ? (
                  <span className="nx-we-recipient-search__field-error">{fieldErrors[field.key]}</span>
                ) : null}
              </div>
            ))}
          </div>
          {saveField && model?.save_for_future_available ? (
            <label className="nx-we-recipient-search__checkbox">
              <input
                type="checkbox"
                checked={createValues.save_for_future === 'true'}
                disabled={recipientCommandLocked}
                onChange={(e) =>
                  setCreateValues((v) => ({
                    ...v,
                    save_for_future: e.target.checked ? 'true' : '',
                  }))
                }
              />
              {shell.save_for_future_label}
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
