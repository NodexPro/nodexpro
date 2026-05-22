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

type PendingKind = 'search' | 'select' | 'create';

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
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectInFlight = useRef(false);

  const interactionsLocked = busy || pending !== null;

  useEffect(() => {
    onPendingChange(pending !== null);
  }, [pending, onPendingChange]);

  const setPendingSafe = useCallback((next: PendingState | null) => {
    setPending(next);
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      if (!cmds.search_recipients || interactionsLocked) return;
      setPendingSafe({ kind: 'search' });
      onError(null);
      try {
        const res = await executeIncomeCommand(cmds.search_recipients, { query: q });
        if ('income_workspace_aggregate' in res) {
          onWorkspaceAgg(res.income_workspace_aggregate);
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : 'שגיאת חיפוש');
      } finally {
        setPendingSafe(null);
      }
    },
    [cmds.search_recipients, interactionsLocked, onError, onWorkspaceAgg, setPendingSafe],
  );

  useEffect(() => {
    if (!model || interactionsLocked) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void runSearch(query);
    }, 280);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query, model, runSearch, interactionsLocked]);

  const listRows = useMemo(() => {
    if (!model) return [];
    const q = query.trim();
    return q.length > 0 ? model.search_results : model.recent_recipients;
  }, [model, query]);

  const fieldErrors = model?.field_errors ?? {};
  const selectedLine = model?.selected?.display_line ?? null;
  const selectedCustomerId =
    model?.selected?.kind === 'saved' ? model.selected.income_customer_id : null;

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
    if (selectInFlight.current) return null;
    const saveForFuture = createValues.save_for_future === 'true';
    const command = saveForFuture ? cmds.save_recipient_for_future : cmds.set_recipient_snapshot;
    if (!command) return null;
    selectInFlight.current = true;
    setPendingSafe({ kind: 'create' });
    onError(null);
    try {
      const res = await executeIncomeCommand(command, buildCreateBody());
      if (!('income_workspace_aggregate' in res)) return null;
      const agg = res.income_workspace_aggregate;
      onWorkspaceAgg(agg);
      const errs = agg.recipient_search?.field_errors ?? {};
      if (Object.keys(errs).length > 0) return null;
      if (!agg.recipient_search?.selected) return null;
      setQuery(agg.recipient_search.selected.display_line);
      setShowCreateInline(false);
      setCreateValues(EMPTY_CREATE);
      return agg;
    } catch (e) {
      onError(e instanceof Error ? e.message : 'שגיאה');
      return null;
    } finally {
      selectInFlight.current = false;
      setPendingSafe(null);
    }
  }, [
    buildCreateBody,
    cmds.save_recipient_for_future,
    cmds.set_recipient_snapshot,
    createValues.save_for_future,
    onError,
    onWorkspaceAgg,
    setPendingSafe,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      commitPendingCreate: async () => {
        if (showCreateInline && createValues.display_name.trim()) {
          return commitInlineCreate();
        }
        if (workspaceAgg?.recipient_search?.selected) {
          return workspaceAgg;
        }
        return null;
      },
    }),
    [commitInlineCreate, createValues.display_name, showCreateInline, workspaceAgg],
  );

  const handleSelectRecipient = async (incomeCustomerId: string) => {
    if (selectInFlight.current || pending !== null) return;
    selectInFlight.current = true;
    setPendingSafe({ kind: 'select', targetId: incomeCustomerId });
    onError(null);
    try {
      const res = await executeIncomeCommand(cmds.select_recipient, {
        income_customer_id: incomeCustomerId,
      });
      if ('income_workspace_aggregate' in res) {
        onWorkspaceAgg(res.income_workspace_aggregate);
        setQuery(res.income_workspace_aggregate.recipient_search.selected?.display_line ?? '');
        setShowCreateInline(false);
        setCreateValues(EMPTY_CREATE);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      selectInFlight.current = false;
      setPendingSafe(null);
    }
  };

  const showPanelLoading = pending?.kind === 'search' || pending?.kind === 'select';

  return (
    <div className="nx-we-recipient-search nx-we-recipient-search--wizard" dir="rtl">
      <div className="nx-we-recipient-search__search-row">
        <div className="nx-income-field nx-we-recipient-search__search-field">
          <label>{shell.label}</label>
          <input
            type="search"
            value={query}
            placeholder={shell.placeholder}
            disabled={interactionsLocked || !workspaceAgg}
            aria-busy={pending?.kind === 'search'}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {pending?.kind === 'search' ? (
          <span className="nx-we-recipient-search__status" role="status">
            <span className="nx-we-recipient-search__spinner" aria-hidden />
            טוען...
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
          className={`nx-we-recipient-search__panel ${showPanelLoading ? 'nx-we-recipient-search__panel--loading' : ''}`}
          aria-busy={showPanelLoading}
        >
          {listRows.map((row) => {
            const isPendingRow = pending?.kind === 'select' && pending.targetId === row.income_customer_id;
            const isSelectedRow = selectedCustomerId === row.income_customer_id && !pending;
            return (
              <button
                key={row.income_customer_id}
                type="button"
                className={`nx-we-recipient-search__option ${isSelectedRow ? 'nx-we-recipient-search__option--selected' : ''} ${isPendingRow ? 'nx-we-recipient-search__option--pending' : ''}`}
                disabled={interactionsLocked}
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
          {model.empty_state.visible && listRows.length === 0 && pending?.kind !== 'search' ? (
            <div className="nx-we-recipient-search__empty">{model.empty_state.message}</div>
          ) : null}
          <button
            type="button"
            className="nx-we-recipient-search__option nx-we-recipient-search__option--create"
            disabled={interactionsLocked || !model.create_new_action.enabled}
            title={model.create_new_action.disabled_reason ?? undefined}
            onClick={() => {
              if (interactionsLocked) return;
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
                  disabled={interactionsLocked}
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
                disabled={interactionsLocked}
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
