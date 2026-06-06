import { useCallback, useEffect, useState } from 'react';
import type {
  IncomeClientDocumentManagementPanel,
  IncomeCommandResponse,
  IncomeCustomersTableRow,
  IncomeTableModel,
  SelectIncomeIssuerContextCommandResponse,
} from '../../api/income';
import { executeIncomeCommand } from '../../api/income';
import {
  IncomeClientDocumentManagementPanelView,
  IncomeClientDocumentMoreMenu,
  IncomeClientDocumentReportsModal,
  IncomeClientEndCustomersModal,
  type IncomeClientDocumentPanelActionResult,
} from './IncomeClientDocumentManagementPanel';
import { IncomeClientIncomeLedgerCardModal } from './IncomeClientIncomeLedgerCardModal';

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
};

export function IncomeClientDocumentManagementShell({
  panel,
  busy,
  customersTableModel,
  customersAllowedActions = [],
  onBusyChange,
  onAfterIssuerSelect,
  onOpenBranding,
  onError,
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

  if (!panel?.visible) return null;

  return (
    <>
      <IncomeClientDocumentManagementPanelView
        panel={panel}
        busy={busy}
        onAction={(result) => void handlePanelAction(result)}
      />

      <IncomeClientEndCustomersModal
        open={endCustomersOpen}
        clientName={endCustomersClientName}
        model={endCustomersModel}
        busy={busy}
        canCreate={canCreateCustomer}
        canEdit={canEditCustomer}
        onClose={() => setEndCustomersOpen(false)}
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
    </>
  );
}
