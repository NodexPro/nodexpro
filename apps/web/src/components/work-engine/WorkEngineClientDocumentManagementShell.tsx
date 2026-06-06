import { useCallback, useEffect, useState } from 'react';
import type {
  IncomeClientDocumentManagementPanel,
  IncomeCommandResponse,
  IncomeCustomersTableRow,
  IncomeTableModel,
  SelectIncomeIssuerContextCommandResponse,
} from '../../api/income';
import { executeIncomeCommand } from '../../api/income';
import type { IncomeClientDocumentTypeCounter } from '../../income/income-workspace-types';
import {
  IncomeClientDocumentManagementPanelView,
  IncomeClientDocumentMoreMenu,
  IncomeClientDocumentReportsModal,
  IncomeClientEndCustomersModal,
  type IncomeClientDocumentPanelActionResult,
} from '../income/IncomeClientDocumentManagementPanel';
import { IncomeClientIncomeLedgerCardModal } from '../income/IncomeClientIncomeLedgerCardModal';
import { WorkEngineClientDocumentTypeCounters } from './WorkEngineClientDocumentTypeCounters';
import { WorkEngineClientDocumentsByTypeModal } from './WorkEngineClientDocumentsByTypeModal';
import { WorkEngineInvoiceRetainerCustomerModal } from './WorkEngineInvoiceRetainerCustomerModal';
import { WorkEngineInvoiceRetainerSetupModal } from './WorkEngineInvoiceRetainerSetupModal';
import type { WorkEngineInvoiceRetainerSetupAggregate } from '../../income/income-workspace-types';

const EMPTY_CUSTOMERS_TABLE_MODEL: IncomeTableModel<IncomeCustomersTableRow> = {
  columns: [
    { key: 'display_name', label: 'שם' },
    { key: 'phone', label: 'טלפון' },
    { key: 'email', label: 'אימייל' },
  ],
  rows: [],
  empty_state: { visible: false, title: '', description: null },
};

function isSelectIssuerResponse(
  res: unknown,
): res is SelectIncomeIssuerContextCommandResponse {
  return (
    typeof res === 'object' &&
    res != null &&
    'command' in res &&
    (res as { command: string }).command === 'select_income_issuer_context' &&
    'income_workspace_context_aggregate' in res
  );
}

function isIncomeCommandResponse(res: unknown): res is IncomeCommandResponse {
  return typeof res === 'object' && res != null && 'income_workspace_aggregate' in res;
}

type ShellProps = {
  panel: IncomeClientDocumentManagementPanel;
  busy: boolean;
  customersTableModel: IncomeTableModel<IncomeCustomersTableRow>;
  customersAllowedActions?: string[];
  onBusyChange?: (busy: boolean) => void;
  onAfterIssuerSelect?: (response: SelectIncomeIssuerContextCommandResponse) => void;
  onOpenBranding?: () => void;
  onError?: (message: string) => void;
  onEditDraft?: (draftId: string) => void | Promise<void>;
  onInvoicesTabRefresh?: (aggregate: Record<string, unknown>) => void;
};

export function WorkEngineClientDocumentManagementShell({
  panel,
  busy,
  customersTableModel,
  customersAllowedActions = [],
  onBusyChange,
  onAfterIssuerSelect,
  onOpenBranding,
  onError,
  onEditDraft,
  onInvoicesTabRefresh,
}: ShellProps) {
  const [endCustomersOpen, setEndCustomersOpen] = useState(false);
  const [endCustomersClientName, setEndCustomersClientName] = useState('');
  const [endCustomersModel, setEndCustomersModel] = useState(customersTableModel);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportsClientName, setReportsClientName] = useState('');
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moreMenuClientName, setMoreMenuClientName] = useState('');
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerClientId, setLedgerClientId] = useState<string | null>(null);
  const [ledgerClientName, setLedgerClientName] = useState('');
  const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
  const [documentsModalParams, setDocumentsModalParams] = useState<{
    representedClientId: string;
    clientDisplayName: string;
    documentTypeKey: IncomeClientDocumentTypeCounter['key'];
    documentTypeLabel: string;
  } | null>(null);
  const [retainerCustomerOpen, setRetainerCustomerOpen] = useState(false);
  const [retainerClientId, setRetainerClientId] = useState<string | null>(null);
  const [retainerClientName, setRetainerClientName] = useState('');
  const [retainerSetupOpen, setRetainerSetupOpen] = useState(false);
  const [retainerSetupAggregate, setRetainerSetupAggregate] =
    useState<WorkEngineInvoiceRetainerSetupAggregate | null>(null);
  const [retainerAddCustomerPending, setRetainerAddCustomerPending] = useState(false);
  const [retainerListRefreshKey, setRetainerListRefreshKey] = useState(0);

  useEffect(() => {
    setEndCustomersModel(customersTableModel);
  }, [customersTableModel]);

  const applyCustomersTableFromResponse = useCallback((res: unknown) => {
    if (isSelectIssuerResponse(res)) {
      onAfterIssuerSelect?.(res);
      setEndCustomersModel(
        res.income_workspace_aggregate.customers_table_model ?? EMPTY_CUSTOMERS_TABLE_MODEL,
      );
      return;
    }
    if (isIncomeCommandResponse(res)) {
      setEndCustomersModel(
        res.income_workspace_aggregate.customers_table_model ?? EMPTY_CUSTOMERS_TABLE_MODEL,
      );
    }
  }, [onAfterIssuerSelect]);

  const canCreateCustomer =
    customersAllowedActions.includes('create_income_customer_for_issuer') ||
    customersAllowedActions.includes('create_income_customer');
  const canEditCustomer = customersAllowedActions.includes('update_income_customer_for_issuer');

  const handleCreateCustomer = useCallback(
    async (payload: {
      display_name: string;
      phone: string | null;
      email: string | null;
      tax_id: string | null;
    }) => {
      onBusyChange?.(true);
      try {
        const res = await executeIncomeCommand('create_income_customer_for_issuer', payload);
        applyCustomersTableFromResponse(res);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        onBusyChange?.(false);
      }
    },
    [applyCustomersTableFromResponse, onBusyChange, onError],
  );

  const handleUpdateCustomer = useCallback(
    async (
      customerId: string,
      payload: {
        display_name: string;
        phone: string | null;
        email: string | null;
        tax_id: string | null;
      },
    ) => {
      onBusyChange?.(true);
      try {
        const res = await executeIncomeCommand('update_income_customer_for_issuer', {
          income_customer_id: customerId,
          ...payload,
        });
        applyCustomersTableFromResponse(res);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        onBusyChange?.(false);
      }
    },
    [applyCustomersTableFromResponse, onBusyChange, onError],
  );

  const handlePanelAction = useCallback(
    async (result: IncomeClientDocumentPanelActionResult) => {
      if (result.kind === 'reports') {
        setReportsClientName(result.clientName);
        setReportsOpen(true);
        return;
      }
      if (result.kind === 'ledger') {
        setLedgerClientId(result.clientId);
        setLedgerClientName(result.clientName);
        setLedgerOpen(true);
        return;
      }
      if (result.kind === 'more') {
        setMoreMenuClientName(result.clientName);
        setMoreMenuAnchor(result.anchor);
        setMoreMenuOpen(true);
        return;
      }
      if (result.kind === 'retainer') {
        setRetainerClientId(result.clientId);
        setRetainerClientName(result.clientName);
        setRetainerSetupAggregate(null);
        setRetainerSetupOpen(false);
        setRetainerCustomerOpen(true);
        return;
      }

      const { action } = result;
      if (!action.command) return;

      const payload = { ...action.command_payload };
      const openBranding = payload.open_document_branding_studio === true;
      const openEndCustomers = payload.open_end_customers_panel === true;
      delete payload.open_document_branding_studio;
      delete payload.open_end_customers_panel;

      onBusyChange?.(true);
      try {
        const res = await executeIncomeCommand(action.command, payload);
        applyCustomersTableFromResponse(res);
        if (openBranding) onOpenBranding?.();
        if (openEndCustomers) {
          setEndCustomersClientName(result.clientName);
          setEndCustomersOpen(true);
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
      } finally {
        onBusyChange?.(false);
      }
    },
    [applyCustomersTableFromResponse, onBusyChange, onError, onOpenBranding],
  );

  const handleCounterClick = useCallback(
    (params: {
      representedClientId: string;
      clientDisplayName: string;
      counter: IncomeClientDocumentTypeCounter;
    }) => {
      setDocumentsModalParams({
        representedClientId: params.representedClientId,
        clientDisplayName: params.clientDisplayName,
        documentTypeKey: params.counter.key,
        documentTypeLabel: params.counter.label,
      });
      setDocumentsModalOpen(true);
    },
    [],
  );

  if (!panel?.visible) return null;

  return (
    <>
      <IncomeClientDocumentManagementPanelView
        panel={panel}
        busy={busy}
        hideStatusColumn
        onAction={(result) => void handlePanelAction(result)}
        renderDocumentsCell={(row) => (
          <WorkEngineClientDocumentTypeCounters
            row={row}
            busy={busy}
            onCounterClick={handleCounterClick}
          />
        )}
      />

      <WorkEngineClientDocumentsByTypeModal
        open={documentsModalOpen}
        params={documentsModalParams}
        busy={busy}
        onBusyChange={onBusyChange}
        onClose={() => {
          setDocumentsModalOpen(false);
          setDocumentsModalParams(null);
        }}
        onError={onError}
        onEditDraft={async (draftId) => {
          if (onEditDraft) {
            await onEditDraft(draftId);
          }
          setDocumentsModalOpen(false);
          setDocumentsModalParams(null);
        }}
      />

      <IncomeClientEndCustomersModal
        open={endCustomersOpen}
        clientName={endCustomersClientName}
        model={endCustomersModel}
        busy={busy}
        canCreate={canCreateCustomer}
        canEdit={canEditCustomer}
        onClose={() => {
          setEndCustomersOpen(false);
          if (retainerCustomerOpen) setRetainerListRefreshKey((k) => k + 1);
        }}
        onCreateCustomer={handleCreateCustomer}
        onUpdateCustomer={handleUpdateCustomer}
      />

      <IncomeClientDocumentReportsModal
        open={reportsOpen}
        clientName={reportsClientName}
        catalog={panel.report_catalog ?? []}
        busy={busy}
        onClose={() => setReportsOpen(false)}
      />

      <IncomeClientDocumentMoreMenu
        open={moreMenuOpen}
        clientName={moreMenuClientName}
        anchorEl={moreMenuAnchor}
        busy={busy}
        onClose={() => setMoreMenuOpen(false)}
      />

      <IncomeClientIncomeLedgerCardModal
        open={ledgerOpen}
        representedClientId={ledgerClientId}
        representedClientDisplayName={ledgerClientName}
        busy={busy}
        onBusyChange={onBusyChange}
        onClose={() => {
          setLedgerOpen(false);
          setLedgerClientId(null);
          setLedgerClientName('');
        }}
        onError={onError}
      />

      <WorkEngineInvoiceRetainerCustomerModal
        open={retainerCustomerOpen}
        representedClientId={retainerClientId}
        clientDisplayName={retainerClientName}
        busy={busy}
        canAddCustomer={canCreateCustomer}
        onBusyChange={onBusyChange}
        onClose={() => {
          setRetainerCustomerOpen(false);
          setRetainerClientId(null);
          setRetainerClientName('');
        }}
        onSelectCustomer={(_endCustomerId, aggregate) => {
          setRetainerSetupAggregate(aggregate);
          setRetainerSetupOpen(true);
        }}
        onAddCustomer={async () => {
          if (!retainerClientId) return;
          setRetainerAddCustomerPending(true);
          onBusyChange?.(true);
          try {
            const res = await executeIncomeCommand('select_income_issuer_context', {
              represented_client_id: retainerClientId,
              acting_mode: 'office_representative',
            });
            applyCustomersTableFromResponse(res);
            setEndCustomersClientName(retainerClientName);
            setEndCustomersOpen(true);
          } catch (e) {
            onError?.(e instanceof Error ? e.message : String(e));
          } finally {
            setRetainerAddCustomerPending(false);
            onBusyChange?.(false);
          }
        }}
        onError={onError}
        refreshKey={retainerListRefreshKey}
      />

      <WorkEngineInvoiceRetainerSetupModal
        open={retainerSetupOpen}
        aggregate={retainerSetupAggregate}
        busy={busy || retainerAddCustomerPending}
        onBusyChange={onBusyChange}
        onClose={() => {
          setRetainerSetupOpen(false);
          setRetainerSetupAggregate(null);
        }}
        onSaved={(aggregate, invoicesTabAggregate) => {
          setRetainerSetupAggregate(aggregate);
          if (invoicesTabAggregate) onInvoicesTabRefresh?.(invoicesTabAggregate);
        }}
        onError={onError}
      />
    </>
  );
}
