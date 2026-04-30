import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiJson } from '../api/client';
import { moduleClientOperationsCase } from '../api/endpoints';
import { ClientWorkspacePage } from '../components/ClientWorkspacePanel';
import type { ClientTaxSettingsBundle } from '../components/ClientTaxesTab';
import type { ClientBusinessProfileSectionResponse } from '../components/ClientBusinessProfileTab';
import type { AccountingTabResponse } from '../components/ClientAccountingSettingsTab';

type ClientOperationsCaseResponse = {
  client: {
    id: string;
    client_name: string | null;
    tax_id: string | null;
    status: string | null;
    started_at: string | null;
    ended_at: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    notes: string | null;
  };
  primary_contact: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    title: string | null;
  } | null;
  handler_user_options: Array<{
    user_id: string;
    email: string;
    display_name: string;
  }>;
  profile: {
    business_type: string | null;
    payroll_flag: boolean | null;
    material_brought_flag: boolean | null;
    vat_status: string | null;
    income_tax_advance_status: string | null;
    national_insurance_status: string | null;
    national_insurance_deductions_status: string | null;
    income_tax_deductions_status: string | null;
    assigned_handler_user_id: string | null;
    assigned_handler_user_full_name: string | null;
    notes_summary: string | null;
  };
  tax_settings: ClientTaxSettingsBundle;
  accounting: ClientBusinessProfileSectionResponse;
  accounting_settings_tab?: AccountingTabResponse | null;
  fees_tab?: import('../components/fees-tab-types').FeesTabModel | null;
  payroll_tab?: import('../components/payroll-tab-types').PayrollTabModel | null;
  annual_tab?: import('../components/annual-tab-types').AnnualTabModel | null;
  client_documents_tab?: import('../components/client-documents-tab-types').ClientDocumentsTabModel | null;
  client_history_tab?: import('../components/client-history-tab-types').ClientHistoryTabModel | null;
};

export function ClientOperationsClientCase() {
  const { clientId } = useParams();
  const [data, setData] = useState<ClientOperationsCaseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);
    setError('');

    apiJson<ClientOperationsCaseResponse>(moduleClientOperationsCase(clientId))
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);
  return <ClientWorkspacePage workspace={data} loading={loading} error={error} />;
}

