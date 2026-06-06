import { useCallback, useEffect, useState } from 'react';
import type {
  IncomeClientDocumentManagementPanel,
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

type ShellProps = {
  panel: IncomeClientDocumentManagementPanel;
  busy: boolean;
  customersTableModel: IncomeTableModel<IncomeCustomersTableRow>;
  onBusyChange?: (busy: boolean) => void;
  onAfterIssuerSelect?: (response: SelectIncomeIssuerContextCommandResponse) => void;
  onOpenBranding?: () => void;
  onError?: (message: string) => void;
};

export function IncomeClientDocumentManagementShell({
  panel,
  busy,
  customersTableModel,
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

  useEffect(() => {
    setEndCustomersModel(customersTableModel);
  }, [customersTableModel]);

  const handlePanelAction = useCallback(
    async (result: IncomeClientDocumentPanelActionResult) => {
      if (result.kind === 'reports') {
        setReportsClientName(result.clientName);
        setReportsOpen(true);
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
        if (isSelectIssuerResponse(res)) {
          onAfterIssuerSelect?.(res);
          setEndCustomersModel(res.income_workspace_aggregate.customers_table_model);
        }
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
    [onAfterIssuerSelect, onBusyChange, onError, onOpenBranding],
  );

  if (!panel.visible) return null;

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
        onClose={() => setEndCustomersOpen(false)}
      />

      <IncomeClientDocumentReportsModal
        open={reportsOpen}
        clientName={reportsClientName}
        catalog={panel.report_catalog}
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
    </>
  );
}
