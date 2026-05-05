import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, apiJson } from '../api/client';
import { docflowClientTabAggregate, moduleClientOperationsUpdateClientProfile } from '../api/endpoints';
import logoSrc from '../templates/template-1/assets/nodexpro-logo.png';
import { ClientTaxesTab, type ClientTaxSettingsBundle } from './ClientTaxesTab';
import type { TaxTabWorkspaceResponse } from './tax-tab-types';
import { ClientBusinessProfileTab, type ClientBusinessProfileSectionResponse } from './ClientBusinessProfileTab';
import { ClientAccountingSettingsTab, type AccountingTabResponse } from './ClientAccountingSettingsTab';
import { ClientFeesTab } from './ClientFeesTab';
import type { FeesTabModel } from './fees-tab-types';
import { ClientPayrollTab } from './ClientPayrollTab';
import type { PayrollTabModel } from './payroll-tab-types';
import { ClientAnnualReportTab } from './ClientAnnualReportTab';
import type { AnnualTabModel } from './annual-tab-types';
import { ClientDocumentsTab } from './ClientDocumentsTab';
import type { ClientDocumentsTabModel } from './client-documents-tab-types';
import { ClientHistoryTab } from './ClientHistoryTab';
import type { ClientHistoryTabModel } from './client-history-tab-types';
import { ClientObligationsTab, type ClientObligationsTabModel } from './ClientObligationsTab';
import { ClientDocflowTab } from './ClientDocflowTab';

function feesTabVersion(tab: FeesTabModel | null | undefined): number {
  const v = tab?.read_model_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : -1;
}

function annualTabVersion(tab: AnnualTabModel | null | undefined): number {
  const v = tab?.read_model_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : -1;
}

function payrollTabVersion(tab: PayrollTabModel | null | undefined): number {
  const v = tab?.read_model_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : -1;
}

function clientDocumentsTabVersion(tab: ClientDocumentsTabModel | null | undefined): number {
  const v = tab?.read_model_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : -1;
}

function historyTabVersion(tab: ClientHistoryTabModel | null | undefined): number {
  const v = tab?.read_model_version;
  return typeof v === 'number' && Number.isFinite(v) ? v : -1;
}

export type ClientOperationsCaseResponse = {
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
  /** Workspace display aggregate for מיסים — from full case; optional in placeholder shell. */
  tax_tab?: TaxTabWorkspaceResponse;
  accounting: ClientBusinessProfileSectionResponse;
  /** כרטיסיות סיכום הגדרות הנה״ח — מהאגרגט; null בלי הרשאת צפייה; חסר = ירושה / fetch גיבוי ללשונית. */
  accounting_settings_tab?: AccountingTabResponse | null;
  /** שכ״ט — מהאגרגט; null בלי הרשאה. */
  fees_tab?: FeesTabModel | null;
  /** שכר — מהאגרגט; null בלי הרשאה. */
  payroll_tab?: PayrollTabModel | null;
  /** דוח שנתי — מהאגרגט; null בלי הרשאה. */
  annual_tab?: AnnualTabModel | null;
  /** הצהרת הון — מהאגרגט; null בלי הרשאה. */
  capital_declaration_tab?: AnnualTabModel | null;
  /** מסמכי לקוח — מהאגרגט; null בלי הרשאה. */
  client_documents_tab?: ClientDocumentsTabModel | null;
  /** היסטוריית פעולות — read model מהאגרגט; null בלי הרשאה. */
  client_history_tab?: ClientHistoryTabModel | null;
  /** התחייבויות — read model מהאגרגט; null בלי הרשאה. */
  client_obligations_tab?: ClientObligationsTabModel | null;
};

type WorkspaceTabKey =
  | 'client'
  | 'taxes'
  | 'accounting'
  | 'obligations'
  | 'docflow'
  | 'documents'
  | 'annual'
  | 'equity'
  | 'fees'
  | 'salary'
  | 'history';

const TAB_ORDER: Array<{ key: WorkspaceTabKey; label: string }> = [
  { key: 'client', label: 'פרטי לקוח' },
  { key: 'taxes', label: 'מיסים' },
  { key: 'accounting', label: 'הגדרות הנה״ח' },
  { key: 'obligations', label: 'התחייבויות' },
  { key: 'docflow', label: 'DocFlow' },
  { key: 'documents', label: 'מסמכים' },
  { key: 'annual', label: 'דוח שנתי' },
  { key: 'equity', label: 'הצהרת הון' },
  { key: 'fees', label: 'שכ״ט' },
  { key: 'salary', label: 'שכר' },
  { key: 'history', label: 'היסטוריה' },
];

/** Registry row fields used to paint the workspace immediately while the case aggregate HTTP request is in flight. */
export type RegistryRowForPlaceholderCase = {
  client_id: string;
  client_name: string | null;
  tax_id: string | null;
  business_type: string | null;
  payroll_flag: boolean | null;
  material_brought_flag: boolean | null;
  vat_status: string | null;
  income_tax_advance_status: string | null;
  national_insurance_status: string | null;
  national_insurance_deductions_status: string | null;
  income_tax_deductions_status: string | null;
  assigned_handler_user_id: string | null;
  vat_due_registry_display_he: string | null;
};

function emptyTaxPlaceholderBundle(row: RegistryRowForPlaceholderCase): ClientTaxSettingsBundle {
  return {
    settings: {
      vat_type: null,
      vat_frequency: null,
      vat_due_type: null,
      income_tax_advance_enabled: false,
      income_tax_advance_percent: null,
      income_tax_advance_frequency: null,
      income_tax_advance_ui_selection: 'choose',
      income_tax_deductions_enabled: false,
      income_tax_deductions_file_number: null,
      income_tax_deductions_frequency: null,
      income_tax_deductions_ui_selection: 'choose',
      national_insurance_type: null,
      national_insurance_monthly_amount: null,
      national_insurance_deductions_file_number: null,
      vat_payment_method: null,
      vat_payment_masked: { last4: null, expiry: null, card_number_masked: null, brand: null },
      income_tax_payment_method: null,
      income_tax_payment_masked: { last4: null, expiry: null, card_number_masked: null, brand: null },
      vat_card_holder_name: null,
      income_tax_card_holder_name: null,
      client_tax_id: row.tax_id,
      client_display_name: row.client_name,
      payment_secure_sessions: {
        vat: { active: false, expires_at: null },
        income_tax: { active: false, expires_at: null },
      },
      vat_other_payment_text: null,
      income_tax_other_payment_text: null,
      notes: null,
      vat_divuach_next_due_at: null,
      vat_divuach_next_due_display_he: null,
      vat_due_registry_display_he: row.vat_due_registry_display_he,
    },
    ui: {
      income_tax_advance_modal: false,
      income_tax_deductions_modal: false,
      national_insurance_modal: false,
      vat_credit_modal: false,
      income_tax_credit_modal: false,
      vat_other_modal: false,
      income_tax_other_modal: false,
      vat_frequency_disabled: false,
      osek_patur_vat_due: null,
      national_insurance_deductions_disabled: false,
    },
  };
}

function emptyAccountingSectionPlaceholder(): ClientBusinessProfileSectionResponse {
  return {
    section_key: 'business_profile',
    section_label: 'פרופיל עסקי',
    permissions: { can_view_business_profile: false, can_edit_business_profile: false },
    version: 0,
    fields: [],
  };
}

/** Instant workspace shell from the registry row — replaced by the server aggregate when it arrives. */
export function buildPlaceholderClientCaseFromRegistryRow(row: RegistryRowForPlaceholderCase): ClientOperationsCaseResponse {
  return {
    client: {
      id: row.client_id,
      client_name: row.client_name,
      tax_id: row.tax_id,
      status: 'active',
      started_at: null,
      ended_at: null,
      email: null,
      phone: null,
      address: null,
      city: null,
      notes: null,
    },
    primary_contact: null,
    handler_user_options: [],
    profile: {
      business_type: row.business_type,
      payroll_flag: row.payroll_flag,
      material_brought_flag: row.material_brought_flag,
      vat_status: row.vat_status,
      income_tax_advance_status: row.income_tax_advance_status,
      national_insurance_status: row.national_insurance_status,
      national_insurance_deductions_status: row.national_insurance_deductions_status,
      income_tax_deductions_status: row.income_tax_deductions_status,
      assigned_handler_user_id: row.assigned_handler_user_id,
      assigned_handler_user_full_name: null,
      notes_summary: null,
    },
    tax_settings: emptyTaxPlaceholderBundle(row),
    accounting: emptyAccountingSectionPlaceholder(),
    accounting_settings_tab: undefined,
    fees_tab: undefined,
    payroll_tab: undefined,
    annual_tab: undefined,
    capital_declaration_tab: undefined,
    client_documents_tab: undefined,
    client_history_tab: undefined,
    client_obligations_tab: undefined,
  };
}

const BUSINESS_TYPE_OPTIONS = ['עוסק פטור', 'עוסק מורשה', 'חברה', 'תאגיד', 'אחר'] as const;

const CLIENT_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'active', label: 'פעיל' },
  { value: 'inactive', label: 'לא פעיל' },
  { value: 'pending', label: 'ממתין' },
];

function isoToDateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateHe(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('he-IL');
}

type ClientProfileDraft = {
  client_name: string;
  government_id: string;
  business_type: string;
  status: string;
  contact_person: string;
  phone: string;
  email: string;
  address_text: string;
  assigned_handler_user_id: string | null;
  ended_at: string; // YYYY-MM-DD or ''
};

export function ClientWorkspacePanel({
  workspace,
  showClose,
  onClose,
  onSaveSuccess,
  onTaxSettingsSaved,
  caseHydrating,
  hydrationError,
}: {
  workspace: ClientOperationsCaseResponse;
  showClose?: boolean;
  onClose?: () => void;
  /** When set (e.g. modal), called after successful save — parent may show toast and close. */
  onSaveSuccess?: () => void;
  /** After מיסים save (tax command → full case) — e.g. refresh registry list. */
  onTaxSettingsSaved?: () => void;
  /** True while the full case aggregate is still loading — client tab uses registry snapshot; other tabs wait. */
  caseHydrating?: boolean;
  /** Shown under the tab bar (e.g. failed case fetch while placeholder is visible). */
  hydrationError?: string;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>('client');
  const [localWorkspace, setLocalWorkspace] = useState(workspace);
  const [docflowTabVisible, setDocflowTabVisible] = useState(false);

  const initialDraft = useMemo<ClientProfileDraft>(() => {
    const displayAddress = [workspace.client.address, workspace.client.city].filter(Boolean).join(' · ');
    return {
      client_name: workspace.client.client_name ?? '',
      government_id: workspace.client.tax_id ?? '',
      business_type: workspace.profile.business_type ?? '',
      status: workspace.client.status ?? 'active',
      contact_person: workspace.primary_contact?.full_name ?? '',
      phone: workspace.primary_contact?.phone ?? workspace.client.phone ?? '',
      email: workspace.primary_contact?.email ?? workspace.client.email ?? '',
      address_text: displayAddress,
      assigned_handler_user_id: workspace.profile.assigned_handler_user_id ?? null,
      ended_at: isoToDateInputValue(workspace.client.ended_at),
    };
  }, [workspace]);

  const [draft, setDraft] = useState<ClientProfileDraft>(initialDraft);
  const [saveError, setSaveError] = useState<string>('');
  const [saveSuccess, setSaveSuccess] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceClientIdRef = useRef<string | null>(null);
  const clientFieldsLocked = Boolean(caseHydrating);

  useEffect(() => {
    const cid = workspace.client.id;
    if (workspaceClientIdRef.current !== null && workspaceClientIdRef.current !== cid) {
      setActiveTab('client');
    }
    workspaceClientIdRef.current = cid;
    setLocalWorkspace((prev) => {
      if (prev.client.id !== workspace.client.id) return workspace;
      const nextFees = workspace.fees_tab ?? null;
      const prevFees = prev.fees_tab ?? null;
      if (prevFees && nextFees && feesTabVersion(prevFees) > feesTabVersion(nextFees)) {
        return { ...workspace, fees_tab: prevFees };
      }
      const nextAnnual = workspace.annual_tab ?? null;
      const prevAnnual = prev.annual_tab ?? null;
      if (prevAnnual && nextAnnual && annualTabVersion(prevAnnual) > annualTabVersion(nextAnnual)) {
        return { ...workspace, annual_tab: prevAnnual };
      }
      const nextCapital = workspace.capital_declaration_tab ?? null;
      const prevCapital = prev.capital_declaration_tab ?? null;
      if (prevCapital && nextCapital && annualTabVersion(prevCapital) > annualTabVersion(nextCapital)) {
        return { ...workspace, capital_declaration_tab: prevCapital };
      }
      const nextPayroll = workspace.payroll_tab ?? null;
      const prevPayroll = prev.payroll_tab ?? null;
      if (prevPayroll && nextPayroll && payrollTabVersion(prevPayroll) > payrollTabVersion(nextPayroll)) {
        return { ...workspace, payroll_tab: prevPayroll };
      }
      const nextDocs = workspace.client_documents_tab ?? null;
      const prevDocs = prev.client_documents_tab ?? null;
      if (prevDocs && nextDocs && clientDocumentsTabVersion(prevDocs) > clientDocumentsTabVersion(nextDocs)) {
        return { ...workspace, client_documents_tab: prevDocs };
      }
      const nextHistory = workspace.client_history_tab ?? null;
      const prevHistory = prev.client_history_tab ?? null;
      if (prevHistory && nextHistory && historyTabVersion(prevHistory) > historyTabVersion(nextHistory)) {
        return { ...workspace, client_history_tab: prevHistory };
      }
      return workspace;
    });
    setDraft(initialDraft);
    setSaveError('');
    setSaveSuccess('');
    setIsSaving(false);
    if (saveSuccessTimerRef.current) {
      clearTimeout(saveSuccessTimerRef.current);
      saveSuccessTimerRef.current = null;
    }
  }, [workspace.client.id, initialDraft, workspace]);

  useEffect(() => {
    let cancelled = false;
    async function probeDocflowEntitlement(): Promise<void> {
      try {
        const out = (await apiJson(docflowClientTabAggregate(workspace.client.id))) as { entitlement_status?: { active?: boolean } };
        if (!cancelled) setDocflowTabVisible(out?.entitlement_status?.active === true);
      } catch (e) {
        if (!cancelled) {
          if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
            setDocflowTabVisible(false);
          } else {
            setDocflowTabVisible(false);
          }
        }
      }
    }
    void probeDocflowEntitlement();
    return () => {
      cancelled = true;
    };
  }, [workspace.client.id]);

  useEffect(() => {
    return () => {
      if (saveSuccessTimerRef.current) {
        clearTimeout(saveSuccessTimerRef.current);
        saveSuccessTimerRef.current = null;
      }
    };
  }, []);

  const tabs = useMemo(
    () => TAB_ORDER.filter((t) => (t.key === 'docflow' ? docflowTabVisible : true)),
    [docflowTabVisible]
  );
  const activeTabLabel = tabs.find((t) => t.key === activeTab)?.label ?? '';
  useEffect(() => {
    if (activeTab === 'docflow' && !docflowTabVisible) setActiveTab('client');
  }, [activeTab, docflowTabVisible]);

  const isClientTab = activeTab === 'client';
  const primaryContact = localWorkspace.primary_contact;
  const displayPhone = primaryContact?.phone ?? localWorkspace.client.phone;
  const displayEmail = primaryContact?.email ?? localWorkspace.client.email;
  const displayAddress = [localWorkspace.client.address, localWorkspace.client.city].filter(Boolean).join(' · ');
  const handlerValue = localWorkspace.profile.assigned_handler_user_full_name ?? localWorkspace.profile.assigned_handler_user_id;

  const handlerOptions = localWorkspace.handler_user_options ?? [];

  const handleCancel = () => {
    setDraft(initialDraft);
    setSaveError('');
    setSaveSuccess('');
    if (saveSuccessTimerRef.current) {
      clearTimeout(saveSuccessTimerRef.current);
      saveSuccessTimerRef.current = null;
    }
  };

  const handleSave = async () => {
    if (clientFieldsLocked) return;
    if (!localWorkspace.client?.id) return;
    setSaveError('');

    const phoneTrim = draft.phone.trim();
    const emailTrim = draft.email.trim();
    const businessOk = Boolean(draft.business_type.trim());
    const contactOk = phoneTrim.length > 0 || emailTrim.length > 0;
    const missingLabels: string[] = [];
    if (!businessOk) missingLabels.push('סוג עסק');
    if (!contactOk) missingLabels.push('טלפון או אימייל');
    if (missingLabels.length > 0) {
      setSaveError(`נא למלא פרטים : ${missingLabels.join(', ')}`);
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        client_name: draft.client_name,
        government_id: draft.government_id,
        business_type: draft.business_type,
        status: draft.status,
        contact_person: draft.contact_person,
        phone: draft.phone,
        email: draft.email,
        address: draft.address_text,
        assigned_handler_user_id: draft.assigned_handler_user_id,
        ended_at: draft.ended_at ? draft.ended_at : null,
      };

      const updated = await apiJson<ClientOperationsCaseResponse>(
        moduleClientOperationsUpdateClientProfile(localWorkspace.client.id),
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );

      setLocalWorkspace(updated);
      setDraft({
        client_name: updated.client.client_name ?? '',
        government_id: updated.client.tax_id ?? '',
        business_type: updated.profile.business_type ?? '',
        status: updated.client.status ?? 'active',
        contact_person: updated.primary_contact?.full_name ?? '',
        phone: updated.primary_contact?.phone ?? updated.client.phone ?? '',
        email: updated.primary_contact?.email ?? updated.client.email ?? '',
        address_text: [updated.client.address, updated.client.city].filter(Boolean).join(' · '),
        assigned_handler_user_id: updated.profile.assigned_handler_user_id ?? null,
        ended_at: isoToDateInputValue(updated.client.ended_at),
      });
      setSaveError('');
      setSaveSuccess('נשמר בהצלחה');

      if (onSaveSuccess) {
        if (saveSuccessTimerRef.current) clearTimeout(saveSuccessTimerRef.current);
        saveSuccessTimerRef.current = setTimeout(() => {
          saveSuccessTimerRef.current = null;
          onSaveSuccess();
        }, 1600);
        return;
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const clientProfileCard = (
    <div className="client-profile-card">
      {activeTab !== 'client' && (
        <div className="client-profile-bottom-note">
          {`עוד אין נתונים — ${activeTabLabel}`}
        </div>
      )}
      <div className="client-profile-grid">
        <div className="client-field">
          <div className="client-field-label">שם לקוח</div>
          {isClientTab ? (
            <div className="client-field-box">
              <input
                value={draft.client_name}
                onChange={(e) => setDraft((s) => ({ ...s, client_name: e.target.value }))}
                readOnly={clientFieldsLocked}
                className="client-field-box-input"
                aria-label="שם לקוח"
                style={{
                  border: 'none',
                  background: 'transparent',
                  boxShadow: 'none',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                }}
              />
            </div>
          ) : (
            <div className="client-field-box">{localWorkspace.client.client_name ?? '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">ת.ז / ח.פ</div>
          {isClientTab ? (
            <div className="client-field-box">
              <input
                value={draft.government_id}
                onChange={(e) => setDraft((s) => ({ ...s, government_id: e.target.value }))}
                readOnly={clientFieldsLocked}
                className="client-field-box-input"
                aria-label="ת.ז / ח.פ"
                style={{
                  border: 'none',
                  background: 'transparent',
                  boxShadow: 'none',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                }}
              />
            </div>
          ) : (
            <div className="client-field-box">{localWorkspace.client.tax_id ?? '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">סוג עסק</div>
          {isClientTab ? (
            <div className="client-field-box">
              <select
                value={draft.business_type}
                onChange={(e) => setDraft((s) => ({ ...s, business_type: e.target.value }))}
                disabled={clientFieldsLocked}
                aria-label="סוג עסק"
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                  appearance: 'none',
                }}
              >
                <option value="" disabled>
                  —
                </option>
                {BUSINESS_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="client-field-box">{localWorkspace.profile.business_type ?? '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">סטטוס לקוח</div>
          {isClientTab ? (
            <div className="client-field-box">
              <select
                value={draft.status}
                onChange={(e) => setDraft((s) => ({ ...s, status: e.target.value }))}
                disabled={clientFieldsLocked}
                aria-label="סטטוס לקוח"
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                  appearance: 'none',
                }}
              >
                {CLIENT_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="client-field-box">{localWorkspace.client.status ?? '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">איש קשר</div>
          {isClientTab ? (
            <div className="client-field-box">
              <input
                value={draft.contact_person}
                onChange={(e) => setDraft((s) => ({ ...s, contact_person: e.target.value }))}
                readOnly={clientFieldsLocked}
                className="client-field-box-input"
                aria-label="איש קשר"
                style={{
                  border: 'none',
                  background: 'transparent',
                  boxShadow: 'none',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                }}
              />
            </div>
          ) : (
            <div className="client-field-box">{primaryContact?.full_name ?? '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">טלפון</div>
          {isClientTab ? (
            <div className="client-field-box">
              <input
                value={draft.phone}
                onChange={(e) => setDraft((s) => ({ ...s, phone: e.target.value }))}
                readOnly={clientFieldsLocked}
                className="client-field-box-input"
                aria-label="טלפון"
                style={{
                  border: 'none',
                  background: 'transparent',
                  boxShadow: 'none',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                }}
              />
            </div>
          ) : (
            <div className="client-field-box">{displayPhone || '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">אימייל</div>
          {isClientTab ? (
            <div className="client-field-box">
              <input
                value={draft.email}
                onChange={(e) => setDraft((s) => ({ ...s, email: e.target.value }))}
                readOnly={clientFieldsLocked}
                className="client-field-box-input"
                aria-label="אימייל"
                style={{
                  border: 'none',
                  background: 'transparent',
                  boxShadow: 'none',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                }}
              />
            </div>
          ) : (
            <div className="client-field-box">{displayEmail || '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">כתובת</div>
          {isClientTab ? (
            <div className="client-field-box">
              <input
                value={draft.address_text}
                onChange={(e) => setDraft((s) => ({ ...s, address_text: e.target.value }))}
                readOnly={clientFieldsLocked}
                className="client-field-box-input"
                aria-label="כתובת"
                style={{
                  border: 'none',
                  background: 'transparent',
                  boxShadow: 'none',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                }}
              />
            </div>
          ) : (
            <div className="client-field-box">{displayAddress || '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">מטפל בתיק</div>
          {isClientTab ? (
            <div className="client-field-box">
              <select
                value={draft.assigned_handler_user_id ?? ''}
                onChange={(e) =>
                  setDraft((s) => ({
                    ...s,
                    assigned_handler_user_id: e.target.value ? e.target.value : null,
                  }))
                }
                disabled={clientFieldsLocked}
                aria-label="מטפל בתיק"
                style={{
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                  appearance: 'none',
                }}
              >
                <option value="">—</option>
                {handlerOptions.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.display_name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="client-field-box">{handlerValue || '—'}</div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">תאריך תחילת טיפול</div>
          <div className="client-field-box">{formatDateHe(localWorkspace.client.started_at)}</div>
        </div>

        <div className="client-field">
          <div className="client-field-label">תאריך סיום טיפול</div>
          {isClientTab ? (
            <div className="client-field-box">
              <input
                type="date"
                value={draft.ended_at}
                onChange={(e) => setDraft((s) => ({ ...s, ended_at: e.target.value }))}
                readOnly={clientFieldsLocked}
                aria-label="תאריך סיום טיפול"
                style={{
                  border: 'none',
                  background: 'transparent',
                  boxShadow: 'none',
                  padding: 0,
                  width: '100%',
                  outline: 'none',
                  font: 'inherit',
                }}
              />
            </div>
          ) : (
            <div className="client-field-box">{formatDateHe(localWorkspace.client.ended_at)}</div>
          )}
        </div>
      </div>

      <div
        className="nx-modal-footer nx-workspace-client-footer nx-taxes-tab-footer"
        style={{
          visibility: isClientTab ? 'visible' : 'hidden',
          pointerEvents: isClientTab ? 'auto' : 'none',
        }}
      >
        {saveSuccess ? (
          <span className="nx-workspace-save-success" role="status" aria-live="polite">
            {saveSuccess}
          </span>
        ) : null}
        <button
          type="button"
          className="nx-btn nx-btn-primary nx-btn-taxes-compact"
          onClick={handleSave}
          disabled={isSaving || clientFieldsLocked}
        >
          שמירה
        </button>
        <button
          type="button"
          className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
          onClick={handleCancel}
          disabled={isSaving || clientFieldsLocked}
        >
          ביטול
        </button>
      </div>

      {saveError ? (
        <p style={{ color: '#b91c1c', fontWeight: 700, margin: '10px 0 0', fontSize: 14 }}>{saveError}</p>
      ) : null}
    </div>
  );

  return (
    <div className="nx-workspace-panel-root" style={{ direction: 'rtl' }}>
      <div className="nx-workspace-header">
        <div className="nx-workspace-header-left" aria-hidden="true">
          <img className="nx-workspace-logo" src={logoSrc} alt="" />
          <span className="nx-workspace-logo-text">
            Nodex<span className="nx-workspace-logo-text-pro">Pro</span>
          </span>
        </div>
        {/* Keep header layout stable even if name/number are intentionally hidden. */}
        <div className="nx-workspace-header-right" aria-hidden="true" />

        {showClose && (
          <button type="button" className="nx-workspace-close" onClick={onClose} aria-label="סגור" title="סגור">
            ×
          </button>
        )}
      </div>
      <div className="nx-workspace-header-divider" />

      <div className="nx-workspace-tabs-bar" role="tablist" aria-label="Workspace tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            className={`nx-workspace-tab-link ${activeTab === t.key ? 'nx-workspace-tab-link-active' : ''}`}
            onClick={() => setActiveTab(t.key)}
            style={{
              borderBottomColor: activeTab === t.key ? '#3b82f6' : 'transparent',
              color: activeTab === t.key ? '#1d4ed8' : '#6b7280',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {hydrationError ? (
        <div
          role="alert"
          style={{
            margin: '0 16px 8px',
            padding: '10px 12px',
            borderRadius: 8,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {hydrationError}
        </div>
      ) : null}
      {caseHydrating ? (
        <div style={{ margin: '0 16px 8px', fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
          טוען נתונים מהשרת…
        </div>
      ) : null}

      <div className="nx-workspace-content" role="tabpanel">
        {caseHydrating && activeTab !== 'client' ? (
          <div className="nx-workspace-loading" style={{ minHeight: 200 }}>
            <p className="nx-loading-muted" style={{ margin: 0 }}>
              טוען נתונים…
            </p>
          </div>
        ) : activeTab === 'taxes' && localWorkspace.tax_settings ? (
          <ClientTaxesTab
            clientId={localWorkspace.client.id}
            taxTab={localWorkspace.tax_tab}
            feesPriceChartView={localWorkspace.fees_tab?.price_history.chart.chart_view_mode}
            onTaxSettingsUpdated={(next) => {
              setLocalWorkspace(next);
              onTaxSettingsSaved?.();
            }}
          />
        ) : activeTab === 'fees' && localWorkspace.fees_tab ? (
          <ClientFeesTab
            clientId={localWorkspace.client.id}
            feesTab={localWorkspace.fees_tab}
            onCaseUpdated={(next) => setLocalWorkspace(next)}
          />
        ) : activeTab === 'fees' && !localWorkspace.fees_tab ? (
          <div className="client-profile-card">
            <p className="nx-fees-empty" style={{ padding: 16 }}>
              אין הרשאת צפייה בשכ״ט או שהנתונים אינם זמינים.
            </p>
          </div>
        ) : activeTab === 'salary' && localWorkspace.payroll_tab ? (
          <ClientPayrollTab
            clientId={localWorkspace.client.id}
            payrollTab={localWorkspace.payroll_tab}
            onCaseUpdated={(next) => setLocalWorkspace(next)}
          />
        ) : activeTab === 'salary' && !localWorkspace.payroll_tab ? (
          <div className="client-profile-card">
            <p className="nx-fees-empty" style={{ padding: 16 }}>
              אין הרשאת צפייה בשכר או שהנתונים אינם זמינים.
            </p>
          </div>
        ) : activeTab === 'annual' && localWorkspace.annual_tab ? (
          <ClientAnnualReportTab
            clientId={localWorkspace.client.id}
            annualTab={localWorkspace.annual_tab}
            onCaseUpdated={(next) => setLocalWorkspace(next)}
          />
        ) : activeTab === 'annual' && !localWorkspace.annual_tab ? (
          <div className="client-profile-card">
            <p className="nx-fees-empty" style={{ padding: 16 }}>
              אין הרשאת צפייה בדוח השנתי או שהנתונים אינם זמינים.
            </p>
          </div>
        ) : activeTab === 'equity' && localWorkspace.capital_declaration_tab ? (
          <ClientAnnualReportTab
            clientId={localWorkspace.client.id}
            annualTab={localWorkspace.capital_declaration_tab}
            onCaseUpdated={(next) => setLocalWorkspace(next)}
          />
        ) : activeTab === 'equity' && !localWorkspace.capital_declaration_tab ? (
          <div className="client-profile-card">
            <p className="nx-fees-empty" style={{ padding: 16 }}>
              אין הרשאת צפייה בהצהרת הון או שהנתונים אינם זמינים.
            </p>
          </div>
        ) : activeTab === 'documents' && localWorkspace.client_documents_tab ? (
          <ClientDocumentsTab
            clientId={localWorkspace.client.id}
            documentsTab={localWorkspace.client_documents_tab}
            onCaseUpdated={(next) => setLocalWorkspace(next)}
          />
        ) : activeTab === 'documents' && !localWorkspace.client_documents_tab ? (
          <div className="client-profile-card">
            <p className="nx-fees-empty" style={{ padding: 16 }}>
              אין הרשאת צפייה במסמכים או שהנתונים אינם זמינים.
            </p>
          </div>
        ) : activeTab === 'obligations' && localWorkspace.client_obligations_tab ? (
          <ClientObligationsTab
            clientId={localWorkspace.client.id}
            obligationsTab={localWorkspace.client_obligations_tab}
            onCaseUpdated={(next) => setLocalWorkspace(next)}
          />
        ) : activeTab === 'obligations' && !localWorkspace.client_obligations_tab ? (
          <div className="client-profile-card">
            <p className="nx-fees-empty" style={{ padding: 16 }}>
              אין נתוני התחייבויות זמינים כרגע.
            </p>
          </div>
        ) : activeTab === 'docflow' ? (
          <ClientDocflowTab clientId={localWorkspace.client.id} />
        ) : activeTab === 'accounting' && localWorkspace.accounting ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <ClientBusinessProfileTab
                clientId={localWorkspace.client.id}
                section={localWorkspace.accounting}
                onCaseUpdated={(next) => setLocalWorkspace(next)}
              />
            </div>
            <div>
              <ClientAccountingSettingsTab
                clientId={localWorkspace.client.id}
                initialAccountingTab={localWorkspace.accounting_settings_tab ?? null}
                onAccountingCaseUpdated={(next) => setLocalWorkspace(next)}
              />
            </div>
          </div>
        ) : activeTab === 'history' && localWorkspace.client_history_tab ? (
          <ClientHistoryTab
            clientId={localWorkspace.client.id}
            historyTab={localWorkspace.client_history_tab}
            onCaseUpdated={(next) => setLocalWorkspace(next)}
          />
        ) : activeTab === 'history' && !localWorkspace.client_history_tab ? (
          <div className="client-profile-card">
            <p className="nx-fees-empty" style={{ padding: 16 }}>
              אין הרשאת צפייה בהיסטוריה או שהנתונים אינם זמינים.
            </p>
          </div>
        ) : (
          clientProfileCard
        )}
      </div>
    </div>
  );
}

/** Modal shell: same header + tab strip as the loaded workspace so the UI does not block on a blank screen while the case aggregate loads. */
function WorkspaceModalShell({
  onClose,
  children,
  tabState = 'loading',
}: {
  onClose: () => void;
  children: ReactNode;
  /** While loading, tabs show wait cursor and aria-busy; after error/empty, tabs stay disabled but not "busy". */
  tabState?: 'loading' | 'idle';
}) {
  const busy = tabState === 'loading';
  const tabCursor = busy ? 'wait' : 'default';
  return (
    <div className="nx-workspace-panel-root" style={{ direction: 'rtl' }}>
      <div className="nx-workspace-header">
        <div className="nx-workspace-header-left" aria-hidden="true">
          <img className="nx-workspace-logo" src={logoSrc} alt="" />
          <span className="nx-workspace-logo-text">
            Nodex<span className="nx-workspace-logo-text-pro">Pro</span>
          </span>
        </div>
        <div className="nx-workspace-header-right" aria-hidden="true" />
        <button type="button" className="nx-workspace-close" onClick={onClose} aria-label="סגור" title="סגור">
          ×
        </button>
      </div>
      <div className="nx-workspace-header-divider" />
      <div className="nx-workspace-tabs-bar" role="tablist" aria-label="Workspace tabs" aria-busy={busy}>
        {TAB_ORDER.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            disabled
            aria-disabled="true"
            className="nx-workspace-tab-link"
            style={{
              borderBottomColor: 'transparent',
              color: '#9ca3af',
              cursor: tabCursor,
              opacity: 0.85,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="nx-workspace-content" role="tabpanel" aria-busy={busy}>
        {children}
      </div>
    </div>
  );
}

export function ClientWorkspaceModal({
  open,
  workspace,
  loading,
  error,
  onClose,
  onSaveSuccess,
  onTaxSettingsSaved,
}: {
  open: boolean;
  workspace: ClientOperationsCaseResponse | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onSaveSuccess?: () => void;
  /** After מיסים save — e.g. refresh registry without closing modal. */
  onTaxSettingsSaved?: () => void;
}) {
  if (!open) return null;

  const showPanel = Boolean(workspace);

  return (
    <div className="nx-modal-overlay" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nx-modal nx-workspace-modal" role="dialog" aria-modal="true">
        {showPanel ? (
          <ClientWorkspacePanel
            workspace={workspace!}
            showClose
            onClose={onClose}
            onSaveSuccess={onSaveSuccess}
            onTaxSettingsSaved={onTaxSettingsSaved}
            caseHydrating={loading}
            hydrationError={!loading ? error : ''}
          />
        ) : (
          <WorkspaceModalShell onClose={onClose} tabState={loading ? 'loading' : 'idle'}>
            {loading ? (
              <div className="nx-workspace-loading" style={{ minHeight: 200 }}>
                <p className="nx-loading-muted" style={{ margin: 0 }}>
                  טוען…
                </p>
              </div>
            ) : error ? (
              <div className="nx-workspace-loading" style={{ minHeight: 200 }}>
                <p style={{ color: '#b91c1c', padding: 0, margin: 0 }}>{error}</p>
              </div>
            ) : (
              <div className="nx-workspace-loading" style={{ minHeight: 200 }}>
                <div className="nx-empty-note">No data.</div>
              </div>
            )}
          </WorkspaceModalShell>
        )}
      </div>
    </div>
  );
}

export function ClientWorkspacePage({
  workspace,
  loading,
  error,
}: {
  workspace: ClientOperationsCaseResponse | null;
  loading: boolean;
  error: string;
}) {
  if (loading) return <p style={{ color: '#6b7280', padding: 24 }}>Loading…</p>;
  if (error) return <p style={{ color: '#b91c1c', padding: 24 }}>{error}</p>;
  if (!workspace) return <p style={{ color: '#6b7280', padding: 24 }}>No data.</p>;

  return (
    <div style={{ direction: 'rtl' }}>
      <ClientWorkspacePanel workspace={workspace} />
    </div>
  );
}

