import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import {
  CLIENT_PROFILE_AUTOSAVE_DEBOUNCE_MS,
  buildClientProfileUpdatePayload,
  clientProfileNeedsLeaveGuard,
  clientProfileSaveStateLabelHe,
  createClientProfileAutosaver,
  draftFromClientOperationsCase,
  shouldIgnoreStaleProfileResponse,
  type ClientProfileDraft,
  type ClientProfileSaveState,
} from './client-workspace-profile-autosave.pure';
import '../styles/nx-workspace-modal-premium.css';
import '../styles/nx-workspace-nested-dialogs.css';

type ClientFieldDecorKind =
  | 'building'
  | 'id-card'
  | 'briefcase'
  | 'status'
  | 'user'
  | 'phone'
  | 'mail'
  | 'pin'
  | 'calendar';

function ClientFieldDecorIcon({ kind }: { kind: ClientFieldDecorKind }) {
  return (
    <svg
      className={`client-field-decor-icon${kind === 'status' ? ' client-field-decor-icon--status' : ''}`}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'building' ? (
        <path d="M4 20V7l8-3 8 3v13H4zM9 20v-6h6v6M9 10h.01M15 10h.01M12 10h.01" />
      ) : null}
      {kind === 'id-card' ? (
        <>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="9" cy="12" r="2" />
          <path d="M13 11h5M13 14h4" />
        </>
      ) : null}
      {kind === 'briefcase' ? (
        <>
          <rect x="3" y="8" width="18" height="12" rx="2" />
          <path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" />
        </>
      ) : null}
      {kind === 'status' ? (
        <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
      ) : null}
      {kind === 'user' ? (
        <>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
        </>
      ) : null}
      {kind === 'phone' ? (
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      ) : null}
      {kind === 'mail' ? (
        <>
          <rect x="3.5" y="6" width="17" height="12" rx="2" />
          <path d="M4 8l8 6 8-6" />
        </>
      ) : null}
      {kind === 'pin' ? (
        <>
          <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
          <circle cx="12" cy="10" r="2.2" />
        </>
      ) : null}
      {kind === 'calendar' ? (
        <>
          <rect x="4" y="6" width="16" height="14" rx="2" />
          <path d="M8 4v4M16 4v4M4 11h16" />
        </>
      ) : null}
    </svg>
  );
}

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

/** Hide from client-folder modal top nav only — obligations domain/tab content retained. */
const HIDDEN_WORKSPACE_NAV_TAB_KEYS = new Set<WorkspaceTabKey>(['obligations']);

function isWorkspaceNavTabVisible(key: WorkspaceTabKey, docflowVisible: boolean): boolean {
  if (HIDDEN_WORKSPACE_NAV_TAB_KEYS.has(key)) return false;
  if (key === 'docflow') return docflowVisible;
  return true;
}

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

function formatDateHe(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('he-IL');
}

export function ClientWorkspacePanel({
  workspace,
  showClose,
  onClose,
  onClientProfileSaved,
  onTaxSettingsSaved,
  caseHydrating,
  hydrationError,
  profileFlushRef,
}: {
  workspace: ClientOperationsCaseResponse;
  showClose?: boolean;
  onClose?: () => void;
  /** After a confirmed update_profile command — refresh registry without closing the workspace. */
  onClientProfileSaved?: () => void;
  /** After מיסים save (tax command → full case) — e.g. refresh registry list. */
  onTaxSettingsSaved?: () => void;
  /** True while the full case aggregate is still loading — client tab uses registry snapshot; other tabs wait. */
  caseHydrating?: boolean;
  /** Shown under the tab bar (e.g. failed case fetch while placeholder is visible). */
  hydrationError?: string;
  /** Lets the parent overlay flush pending edits before dismissing the workspace. */
  profileFlushRef?: MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  const [activeTab, setActiveTab] = useState<WorkspaceTabKey>('client');
  const [localWorkspace, setLocalWorkspace] = useState(workspace);
  const [docflowTabVisible, setDocflowTabVisible] = useState(false);

  const [draft, setDraft] = useState<ClientProfileDraft>(() => draftFromClientOperationsCase(workspace));
  const [profileSaveState, setProfileSaveState] = useState<ClientProfileSaveState>({ status: 'idle', error: null });
  const workspaceClientIdRef = useRef<string | null>(null);
  const clientIdRef = useRef(workspace.client.id);
  const lockedRef = useRef(Boolean(caseHydrating));
  const onClientProfileSavedRef = useRef(onClientProfileSaved);
  const autosaverRef = useRef<ReturnType<typeof createClientProfileAutosaver> | null>(null);
  const pendingConfirmedCaseRef = useRef<ClientOperationsCaseResponse | null>(null);
  const clientFieldsLocked = Boolean(caseHydrating);
  clientIdRef.current = workspace.client.id;
  lockedRef.current = clientFieldsLocked;
  onClientProfileSavedRef.current = onClientProfileSaved;

  useEffect(() => {
    const cid = workspace.client.id;
    const clientChanged = workspaceClientIdRef.current !== null && workspaceClientIdRef.current !== cid;
    if (clientChanged) {
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
    if (!clientChanged) {
      const incoming = draftFromClientOperationsCase(workspace);
      const saver = autosaverRef.current;
      if (!saver || !saver.isDirty()) {
        setDraft(incoming);
        saver?.resetFromServer(incoming);
      }
    }
  }, [workspace]);

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
    const previous = autosaverRef.current;
    if (previous) {
      previous.dispose();
      void previous.flush();
    }
    const cid = workspace.client.id;
    const saver = createClientProfileAutosaver({
      initial: draftFromClientOperationsCase(workspace),
      debounceMs: CLIENT_PROFILE_AUTOSAVE_DEBOUNCE_MS,
      isLocked: () => lockedRef.current,
      save: async (sent) => {
        const requestClientId = cid;
        try {
          const updated = await apiJson<ClientOperationsCaseResponse>(
            moduleClientOperationsUpdateClientProfile(requestClientId),
            {
              method: 'POST',
              body: JSON.stringify(buildClientProfileUpdatePayload(sent)),
            },
          );
          if (shouldIgnoreStaleProfileResponse(requestClientId, clientIdRef.current)) {
            return;
          }
          pendingConfirmedCaseRef.current = updated;
        } catch (e) {
          const todoConflict =
            e instanceof ApiError && e.code === 'CLIENT_HANDLER_TODO_CONFLICT'
              ? typeof e.details?.conflicting_todo_count === 'number'
                ? `לא ניתן לשנות מטפל בתיק — קיימות ${e.details.conflicting_todo_count} משימות ToDo פעילות שאינן תואמות. יש להשלים או להעביר את המשימות תחילה.`
                : 'לא ניתן לשנות מטפל בתיק — קיימות משימות ToDo פעילות. יש להשלים או להעביר את המשימות תחילה.'
              : null;
          throw new Error(todoConflict ?? (e instanceof Error ? e.message : 'Failed to save'));
        }
      },
      onConfirmed: () => {
        const updated = pendingConfirmedCaseRef.current;
        if (!updated || updated.client.id !== clientIdRef.current) return;
        setLocalWorkspace(updated);
        const next = draftFromClientOperationsCase(updated);
        setDraft(next);
        autosaverRef.current?.resetFromServer(next);
        onClientProfileSavedRef.current?.();
      },
      onState: (next) => {
        setProfileSaveState(next);
      },
    });
    autosaverRef.current = saver;
    pendingConfirmedCaseRef.current = null;
    setDraft(draftFromClientOperationsCase(workspace));
    setProfileSaveState({ status: 'idle', error: null });
    return () => {
      saver.dispose();
    };
    // Recreate only when the open client case changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.client.id]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = autosaverRef.current;
      if (!s || !clientProfileNeedsLeaveGuard(s.getState(), s.isDirty())) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const flushProfileAutosave = async (): Promise<boolean> => {
    const saver = autosaverRef.current;
    if (!saver) return true;
    return saver.flush();
  };

  useEffect(() => {
    if (!profileFlushRef) return;
    profileFlushRef.current = flushProfileAutosave;
    return () => {
      if (profileFlushRef.current === flushProfileAutosave) profileFlushRef.current = null;
    };
  });

  const applyDraftPatch = (patch: (s: ClientProfileDraft) => ClientProfileDraft) => {
    setDraft((s) => {
      const next = patch(s);
      autosaverRef.current?.change(next);
      return next;
    });
  };

  const requestWorkspaceClose = async () => {
    const ok = await flushProfileAutosave();
    if (ok) onClose?.();
  };

  const requestTabChange = async (key: WorkspaceTabKey) => {
    if (key === activeTab) return;
    const ok = await flushProfileAutosave();
    if (ok) setActiveTab(key);
  };

  const tabs = useMemo(
    () => TAB_ORDER.filter((t) => isWorkspaceNavTabVisible(t.key, docflowTabVisible)),
    [docflowTabVisible]
  );
  const activeTabLabel = tabs.find((t) => t.key === activeTab)?.label ?? '';
  useEffect(() => {
    if (!isWorkspaceNavTabVisible(activeTab, docflowTabVisible)) setActiveTab('client');
  }, [activeTab, docflowTabVisible]);

  const isClientTab = activeTab === 'client';
  const primaryContact = localWorkspace.primary_contact;
  const displayPhone = primaryContact?.phone ?? localWorkspace.client.phone;
  const displayEmail = primaryContact?.email ?? localWorkspace.client.email;
  const displayAddress = [localWorkspace.client.address, localWorkspace.client.city].filter(Boolean).join(' · ');
  const handlerValue = localWorkspace.profile.assigned_handler_user_full_name ?? localWorkspace.profile.assigned_handler_user_id;

  const handlerOptions = localWorkspace.handler_user_options ?? [];
  const saveError = profileSaveState.status === 'error' ? profileSaveState.error ?? '' : '';
  const profileSaveLabel = clientProfileSaveStateLabelHe(profileSaveState);

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
              <ClientFieldDecorIcon kind="building" />
              <input
                value={draft.client_name}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, client_name: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="building" />
              {localWorkspace.client.client_name ?? '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">ת.ז / ח.פ</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="id-card" />
              <input
                value={draft.government_id}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, government_id: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="id-card" />
              {localWorkspace.client.tax_id ?? '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">סוג עסק</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="briefcase" />
              <select
                value={draft.business_type}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, business_type: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="briefcase" />
              {localWorkspace.profile.business_type ?? '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">סטטוס לקוח</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="status" />
              <select
                value={draft.status}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, status: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="status" />
              {localWorkspace.client.status ?? '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">איש קשר</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="user" />
              <input
                value={draft.contact_person}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, contact_person: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="user" />
              {primaryContact?.full_name ?? '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">טלפון</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="phone" />
              <input
                value={draft.phone}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, phone: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="phone" />
              {displayPhone || '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">אימייל</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="mail" />
              <input
                value={draft.email}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, email: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="mail" />
              {displayEmail || '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">כתובת</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="pin" />
              <input
                value={draft.address_text}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, address_text: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="pin" />
              {displayAddress || '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">מטפל בתיק</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="user" />
              <select
                value={draft.assigned_handler_user_id ?? ''}
                onChange={(e) =>
                  applyDraftPatch((s) => ({
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="user" />
              {handlerValue || '—'}
            </div>
          )}
        </div>

        <div className="client-field">
          <div className="client-field-label">תאריך תחילת טיפול</div>
          <div className="client-field-box">
            <ClientFieldDecorIcon kind="calendar" />
            {formatDateHe(localWorkspace.client.started_at)}
          </div>
        </div>

        <div className="client-field">
          <div className="client-field-label">תאריך סיום טיפול</div>
          {isClientTab ? (
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="calendar" />
              <input
                type="date"
                value={draft.ended_at}
                onChange={(e) => applyDraftPatch((s) => ({ ...s, ended_at: e.target.value }))}
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
            <div className="client-field-box">
              <ClientFieldDecorIcon kind="calendar" />
              {formatDateHe(localWorkspace.client.ended_at)}
            </div>
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
        {profileSaveLabel && profileSaveState.status !== 'error' ? (
          <span
            className={`nx-workspace-profile-autosave nx-workspace-profile-autosave--${profileSaveState.status}`}
            role="status"
            aria-live="polite"
          >
            {profileSaveLabel}
          </span>
        ) : null}
        {saveError ? (
          <>
            <span className="nx-workspace-profile-autosave nx-workspace-profile-autosave--error" role="alert">
              {saveError}
            </span>
            <button
              type="button"
              className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
              onClick={() => {
                void flushProfileAutosave();
              }}
              disabled={clientFieldsLocked}
            >
              נסה שוב
            </button>
          </>
        ) : null}
      </div>
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
          <button type="button" className="nx-workspace-close" onClick={() => void requestWorkspaceClose()} aria-label="סגור" title="סגור">
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
            onClick={() => void requestTabChange(t.key)}
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
          <div className="nx-ws-accounting">
            <ClientBusinessProfileTab
              clientId={localWorkspace.client.id}
              section={localWorkspace.accounting}
              onCaseUpdated={(next) => setLocalWorkspace(next)}
            />
            <ClientAccountingSettingsTab
              clientId={localWorkspace.client.id}
              initialAccountingTab={localWorkspace.accounting_settings_tab ?? null}
              onAccountingCaseUpdated={(next) => setLocalWorkspace(next)}
            />
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
        {TAB_ORDER.filter((t) => isWorkspaceNavTabVisible(t.key, false)).map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            disabled
            aria-disabled="true"
            className="nx-workspace-tab-link"
            style={{
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
  onClientProfileSaved,
  onTaxSettingsSaved,
}: {
  open: boolean;
  workspace: ClientOperationsCaseResponse | null;
  loading: boolean;
  error: string;
  onClose: () => void;
  onClientProfileSaved?: () => void;
  /** After מיסים save — e.g. refresh registry without closing modal. */
  onTaxSettingsSaved?: () => void;
}) {
  const profileFlushRef = useRef<(() => Promise<boolean>) | null>(null);
  if (!open) return null;

  const showPanel = Boolean(workspace);

  const requestModalClose = async () => {
    const ok = profileFlushRef.current ? await profileFlushRef.current() : true;
    if (ok) onClose();
  };

  // Portal to document.body. The registry mounts this overlay inside `.nx-co-sheet`,
  // which uses backdrop-filter and therefore becomes the containing block for
  // position:fixed — the dimmer would otherwise cover only the spreadsheet and
  // sit under the Client Operations header/sidebar.
  const overlay = (
    <div
      className="nx-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) void requestModalClose();
      }}
    >
      <div className="nx-modal nx-workspace-modal" role="dialog" aria-modal="true">
        {showPanel ? (
          <ClientWorkspacePanel
            workspace={workspace!}
            showClose
            onClose={onClose}
            onClientProfileSaved={onClientProfileSaved}
            onTaxSettingsSaved={onTaxSettingsSaved}
            caseHydrating={loading}
            hydrationError={!loading ? error : ''}
            profileFlushRef={profileFlushRef}
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

  return createPortal(overlay, document.body);
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

