/**
 * Income — Client Document Management panel (CRM-style client list).
 * Single aggregate read model; counters from SQL aggregation (P4.2).
 * unpaid_amount_* binds to SQL unpaid_reference = Accounting Base remaining
 * (original − posted allocations − issued Credit Note totals). No FE arithmetic.
 *
 * Dual populations (invoices tab foundation):
 * - office_clients_section: ALL eligible Core office clients (left-join document stats;
 *   zero counters when no docs). Population is not document-derived.
 *   Office→Core-client document counters stay empty until recipient linkage exists;
 *   office_representative docs are Client→recipient (never Office→client).
 * - office_client_customers_section: ALL active income_customers under those clients
 *   (left-join end-customer document stats by represented_client + income_customer_id).
 * `rows` remains office_clients_section.rows for backward compatibility.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
  INCOME_COMMAND_SELECT_ISSUER,
  INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY,
} from './income.types.js';
import type {
  IncomeClientDocumentManagementPanel,
  IncomeClientDocumentManagementReportItem,
  IncomeClientDocumentManagementRow,
  IncomeClientDocumentManagementRowAction,
  IncomeClientDocumentManagementSection,
  IncomeClientDocumentTypeCounter,
  IncomeWorkspacePermissions,
} from './income.types.js';
import {
  endCustomerPopulationKey,
  groupEndCustomerRowsByParent,
  mergeEndCustomersWithDocumentStats,
  mergeOfficeClientsWithDocumentStats,
  zeroEndCustomerDocumentStat,
  zeroOfficeClientDocumentStat,
} from './income-client-document-management-panel.pure.js';
import {
  buildEndCustomerQuickCard,
  buildOfficeClientQuickCard,
  resolveClientQuickCardDocflowInviteStatus,
  type ClientQuickCardDocflowInviteState,
} from './income-client-quick-card.pure.js';
import { clientOperationsBusinessTypeDisplayHe } from '../client-operations/client-operations-client-core.read.js';
import { resolveEntitlement } from '../modules/entitlement.service.js';

const REPORT_CATALOG: IncomeClientDocumentManagementReportItem[] = [
  { key: 'income_summary', label: 'דוח הכנסות', enabled: false, disabled_reason: 'בקרוב' },
  { key: 'aging', label: 'Aging', enabled: false, disabled_reason: 'בקרוב' },
  { key: 'documents', label: 'דוח מסמכים', enabled: false, disabled_reason: 'בקרוב' },
  { key: 'payments', label: 'דוח תשלומים', enabled: false, disabled_reason: 'בקרוב' },
  { key: 'csv_export', label: 'CSV Export', enabled: false, disabled_reason: 'בקרוב' },
];

const PANEL_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'client', label: 'לקוח' },
  { key: 'total_documents_count', label: 'מסמכים' },
  { key: 'unpaid_amount_display', label: 'לא שולם' },
  { key: 'last_document_date_display', label: 'מסמך אחרון' },
  { key: 'last_activity_display', label: 'פעילות אחרונה' },
  { key: 'status_label', label: 'סטטוס' },
  { key: 'actions', label: '' },
];

type PanelStatRow = {
  represented_client_id: string;
  total_documents_count: number;
  draft_documents_count: number;
  quote_count: number;
  deal_count: number;
  tax_invoice_count: number;
  receipt_count: number;
  credit_count: number;
  quote_issued_count: number;
  deal_issued_count: number;
  tax_invoice_issued_count: number;
  tax_invoice_receipt_issued_count: number;
  receipt_issued_count: number;
  credit_issued_count: number;
  last_document_date: string | null;
  last_activity_at: string | null;
  unpaid_reference: number | string | null;
  currency: string | null;
};

type EndCustomerStatRow = PanelStatRow & {
  income_customer_id: string;
};

function buildOfficeClientRowActions(
  clientId: string,
  perms: IncomeWorkspacePermissions,
  options?: {
    includeRetainerAction?: boolean;
    /** Work Engine invoices: replace … with + new document. */
    newDocumentInsteadOfMore?: boolean;
  },
): IncomeClientDocumentManagementRowAction[] {
  const canEdit = perms.edit;
  const canCreateDocument = perms.issue || perms.edit;
  const actions: IncomeClientDocumentManagementRowAction[] = [
    {
      key: 'open_branding_studio',
      label: 'הגדרות מסמך',
      icon_key: 'settings',
      command: INCOME_COMMAND_SELECT_ISSUER,
      command_payload: {
        command: INCOME_COMMAND_SELECT_ISSUER,
        acting_mode: 'office_representative',
        issuer_business_id: clientId,
        represented_client_id: clientId,
        open_document_branding_studio: true,
      },
      enabled: canEdit,
      disabled_reason: canEdit ? null : 'אין הרשאת עריכה',
    },
    {
      key: 'open_end_customers',
      label: 'לקוחות הלקוח',
      icon_key: 'end_customers',
      command: INCOME_COMMAND_SELECT_ISSUER,
      command_payload: {
        command: INCOME_COMMAND_SELECT_ISSUER,
        acting_mode: 'office_representative',
        issuer_business_id: clientId,
        represented_client_id: clientId,
        open_end_customers_panel: true,
      },
      enabled: perms.view,
      disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
    },
    {
      key: 'open_reports',
      label: 'דוחות',
      icon_key: 'reports',
      command: null,
      command_payload: { open_reports_panel: true, client_id: clientId },
      enabled: perms.view,
      disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
    },
    {
      key: 'open_income_ledger_card',
      label: 'כרטסת הכנסות',
      icon_key: 'ledger',
      command: null,
      command_payload: {
        open_income_ledger_card: true,
        represented_client_id: clientId,
      },
      enabled: perms.view,
      disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
    },
    {
      key: 'open_email_history',
      label: '@',
      icon_key: 'at',
      command: null,
      command_payload: {
        open_email_history: true,
        represented_client_id: clientId,
        aggregate_key: INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY,
      },
      enabled: perms.view && perms.issue_on_behalf,
      disabled_reason:
        perms.view && perms.issue_on_behalf ? null : 'זמין במצב ניהול לקוח בלבד',
    },
  ];

  if (options?.includeRetainerAction) {
    actions.push({
      key: 'open_invoice_retainer_setup',
      label: 'ריטיינר חשבוניות',
      icon_key: 'retainer',
      command: null,
      command_payload: {
        open_invoice_retainer_setup: true,
        represented_client_id: clientId,
      },
      enabled: perms.edit,
      disabled_reason: perms.edit ? null : 'אין הרשאת עריכה',
    });
  }

  if (options?.newDocumentInsteadOfMore) {
    actions.push({
      key: 'open_new_income_document',
      label: 'מסמך חדש',
      icon_key: 'plus',
      command: INCOME_COMMAND_SELECT_ISSUER,
      command_payload: {
        command: INCOME_COMMAND_SELECT_ISSUER,
        acting_mode: 'office_representative',
        issuer_business_id: clientId,
        represented_client_id: clientId,
        open_new_income_document: true,
      },
      enabled: canCreateDocument,
      disabled_reason: canCreateDocument ? null : 'אין הרשאת הפקה',
    });
  } else {
    actions.push({
      key: 'more',
      label: 'פעולות נוספות',
      icon_key: 'more',
      command: null,
      command_payload: { open_more_menu: true, client_id: clientId },
      enabled: true,
      disabled_reason: null,
    });
  }

  return actions;
}

/**
 * End-customer actions: same visual slots/order as office.
 *
 * When `workEngineInvoicesFunctionalParity` is true (Work Engine invoices tab only):
 * enable each slot with a valid end-customer backend contract (RBAC still applies).
 * When false (/m/income and other surfaces): keep artificial disablement for slots
 * that lack a surface-scoped destination on that screen.
 */
function buildEndCustomerRowActions(params: {
  representedClientId: string;
  incomeCustomerId: string;
  parentClientDisplayName: string;
  perms: IncomeWorkspacePermissions;
  includeRetainerAction?: boolean;
  workEngineInvoicesFunctionalParity?: boolean;
  newDocumentInsteadOfMore?: boolean;
}): IncomeClientDocumentManagementRowAction[] {
  const { representedClientId, incomeCustomerId, parentClientDisplayName, perms } = params;
  const weParity = params.workEngineInvoicesFunctionalParity === true;
  const canEmail = perms.view && perms.issue_on_behalf;
  const canCreateDocument = perms.issue || perms.edit;

  const settingsAction: IncomeClientDocumentManagementRowAction = weParity
    ? {
        key: 'open_branding_studio',
        label: 'הגדרות מסמך',
        icon_key: 'settings',
        command: INCOME_COMMAND_SELECT_ISSUER,
        command_payload: {
          command: INCOME_COMMAND_SELECT_ISSUER,
          acting_mode: 'office_representative',
          issuer_business_id: representedClientId,
          represented_client_id: representedClientId,
          income_customer_id: incomeCustomerId,
          parent_client_display_name: parentClientDisplayName,
          /**
           * Document settings = Branding Studio for the parent issuer.
           * Row context keeps income_customer_id; branding profiles are issuer-scoped.
           * Must NOT open the end-customer CRM identity editor.
           */
          open_document_branding_studio: true,
        },
        enabled: perms.edit,
        disabled_reason: perms.edit ? null : 'אין הרשאת עריכה',
      }
    : {
        key: 'open_branding_studio',
        label: 'הגדרות מסמך',
        icon_key: 'settings',
        command: null,
        command_payload: {
          represented_client_id: representedClientId,
          income_customer_id: incomeCustomerId,
        },
        enabled: false,
        disabled_reason: 'הגדרות מסמך שייכות ללקוח המשרד, לא ללקוח קצה',
      };

  const clientManagementAction: IncomeClientDocumentManagementRowAction = weParity
    ? {
        key: 'open_end_customers',
        label: 'לקוחות הלקוח',
        icon_key: 'end_customers',
        command: INCOME_COMMAND_SELECT_ISSUER,
        command_payload: {
          command: INCOME_COMMAND_SELECT_ISSUER,
          acting_mode: 'office_representative',
          issuer_business_id: representedClientId,
          represented_client_id: representedClientId,
          income_customer_id: incomeCustomerId,
          parent_client_display_name: parentClientDisplayName,
          /** Reuse parent end-customers panel; focus THIS end customer (not invent children). */
          open_end_customers_panel: true,
          focus_income_customer_id: incomeCustomerId,
        },
        enabled: perms.view,
        disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
      }
    : {
        key: 'open_end_customers',
        label: 'לקוחות הלקוח',
        icon_key: 'end_customers',
        command: null,
        command_payload: {
          represented_client_id: representedClientId,
          income_customer_id: incomeCustomerId,
        },
        enabled: false,
        disabled_reason: 'ניהול לקוחות קצה זמין משורת לקוח המשרד בלבד',
      };

  const reportsAction: IncomeClientDocumentManagementRowAction = {
    key: 'open_reports',
    label: 'דוחות',
    icon_key: 'reports',
    command: null,
    command_payload: {
      open_reports_panel: true,
      client_id: representedClientId,
      income_customer_id: incomeCustomerId,
    },
    enabled: weParity ? perms.view : false,
    disabled_reason: weParity
      ? perms.view
        ? null
        : 'אין הרשאת צפייה'
      : 'דוחות לפי לקוח קצה — בקרוב',
  };

  const actions: IncomeClientDocumentManagementRowAction[] = [
    settingsAction,
    clientManagementAction,
    reportsAction,
    {
      key: 'open_income_ledger_card',
      label: 'כרטסת הכנסות',
      icon_key: 'ledger',
      command: null,
      command_payload: {
        open_income_ledger_card: true,
        represented_client_id: representedClientId,
        end_customer_id: incomeCustomerId,
        income_customer_id: incomeCustomerId,
      },
      enabled: perms.view,
      disabled_reason: perms.view ? null : 'אין הרשאת צפייה',
    },
    {
      key: 'open_email_history',
      label: '@',
      icon_key: 'at',
      command: null,
      command_payload: {
        open_email_history: true,
        represented_client_id: representedClientId,
        income_customer_id: incomeCustomerId,
        end_customer_id: incomeCustomerId,
        aggregate_key: INCOME_REPRESENTED_CLIENT_EMAIL_HISTORY_AGGREGATE_KEY,
      },
      enabled: weParity ? canEmail : false,
      disabled_reason: weParity
        ? canEmail
          ? null
          : 'זמין במצב ניהול לקוח בלבד'
        : 'היסטוריית מייל לפי לקוח קצה — בקרוב',
    },
  ];

  if (params.includeRetainerAction) {
    actions.push({
      key: 'open_invoice_retainer_setup',
      label: 'ריטיינר חשבוניות',
      icon_key: 'retainer',
      command: null,
      command_payload: {
        open_invoice_retainer_setup: true,
        represented_client_id: representedClientId,
        end_customer_id: incomeCustomerId,
        income_customer_id: incomeCustomerId,
      },
      enabled: perms.edit,
      disabled_reason: perms.edit ? null : 'אין הרשאת עריכה',
    });
  }

  if (params.newDocumentInsteadOfMore) {
    actions.push({
      key: 'open_new_income_document',
      label: 'מסמך חדש',
      icon_key: 'plus',
      command: INCOME_COMMAND_SELECT_ISSUER,
      command_payload: {
        command: INCOME_COMMAND_SELECT_ISSUER,
        acting_mode: 'office_representative',
        issuer_business_id: representedClientId,
        represented_client_id: representedClientId,
        income_customer_id: incomeCustomerId,
        end_customer_id: incomeCustomerId,
        parent_client_display_name: parentClientDisplayName,
        open_new_income_document: true,
      },
      enabled: canCreateDocument,
      disabled_reason: canCreateDocument ? null : 'אין הרשאת הפקה',
    });
  } else {
    actions.push({
      key: 'more',
      label: 'פעולות נוספות',
      icon_key: 'more',
      command: null,
      command_payload: {
        open_more_menu: true,
        client_id: representedClientId,
        income_customer_id: incomeCustomerId,
      },
      enabled: true,
      disabled_reason: null,
    });
  }

  return actions;
}

function formatMoneyReference(amount: number, currency: string): string {
  return `${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDateDisplay(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return new Date(d).toLocaleDateString('he-IL');
}

function buildDocumentTypeCounters(
  stat: PanelStatRow,
  actionParams: { represented_client_id: string; income_customer_id: string | null },
  options?: { omitDraftDocumentTypeCounter?: boolean },
): IncomeClientDocumentTypeCounter[] {
  const counters: IncomeClientDocumentTypeCounter[] = [
    {
      key: 'quote',
      label: 'הצעת מחיר',
      count: Number(stat.quote_issued_count) || 0,
      tone: 'blue',
      tooltip_label: 'הצעות מחיר',
      action_key: 'open_documents_by_type',
      action_params: actionParams,
    },
    {
      key: 'deal_invoice',
      label: 'חשבון עסקה',
      count: Number(stat.deal_issued_count) || 0,
      tone: 'purple',
      tooltip_label: 'חשבונות עסקה',
      action_key: 'open_documents_by_type',
      action_params: actionParams,
    },
    {
      key: 'tax_invoice',
      label: 'חשבונית מס',
      count: Number(stat.tax_invoice_issued_count) || 0,
      tone: 'cyan',
      tooltip_label: 'חשבוניות מס',
      action_key: 'open_documents_by_type',
      action_params: actionParams,
    },
    {
      key: 'tax_invoice_receipt',
      label: 'חשבונית מס/קבלה',
      count: Number(stat.tax_invoice_receipt_issued_count) || 0,
      tone: 'teal',
      tooltip_label: 'חשבוניות מס/קבלה',
      action_key: 'open_documents_by_type',
      action_params: actionParams,
    },
    {
      key: 'receipt',
      label: 'קבלה',
      count: Number(stat.receipt_issued_count) || 0,
      tone: 'green',
      tooltip_label: 'קבלות',
      action_key: 'open_documents_by_type',
      action_params: actionParams,
    },
    {
      key: 'credit_tax_invoice',
      label: 'זיכוי',
      count: Number(stat.credit_issued_count) || 0,
      tone: 'red',
      tooltip_label: 'זיכויים',
      action_key: 'open_documents_by_type',
      action_params: actionParams,
    },
  ];
  if (options?.omitDraftDocumentTypeCounter !== true) {
    counters.push({
      key: 'draft',
      label: 'טיוטות',
      count: Number(stat.draft_documents_count) || 0,
      tone: 'slate',
      tooltip_label: 'טיוטות',
      action_key: 'open_documents_by_type',
      action_params: actionParams,
    });
  }
  return counters;
}

function statusLabelFromStat(stat: PanelStatRow): string {
  const totalDocuments = Number(stat.total_documents_count) || 0;
  const draftDocuments = Number(stat.draft_documents_count) || 0;
  const unpaidRaw = Number(stat.unpaid_reference ?? 0);
  const unpaidRef = Number.isFinite(unpaidRaw) && unpaidRaw > 0 ? unpaidRaw : null;
  if (totalDocuments > 0) {
    return unpaidRef != null ? 'פתוח לגבייה' : 'פעיל';
  }
  return draftDocuments > 0 ? 'טיוטות פעילות' : 'פעיל';
}

function emptySection(
  section_key: IncomeClientDocumentManagementSection['section_key'],
  title: string,
): IncomeClientDocumentManagementSection {
  return {
    section_key,
    title,
    total_count: 0,
    rows: [],
    groups: section_key === 'office_client_customers' ? [] : null,
    page: { limit: null, offset: 0, has_more: false },
    empty_state: {
      visible: true,
      title:
        section_key === 'office_clients' ? 'אין לקוחות במשרד' : 'אין לקוחות קצה',
      description: null,
    },
  };
}

function emptyPanel(visible: boolean): IncomeClientDocumentManagementPanel {
  const office = emptySection('office_clients', 'לקוחות המשרד');
  const customers = emptySection('office_client_customers', 'לקוחות של לקוחות המשרד');
  return {
    aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
    visible,
    title: 'ניהול מסמכים לפי לקוח',
    description: visible ? 'לקוחות שכבר הופקו עבורם מסמכי הכנסה' : null,
    columns: [],
    rows: [],
    office_clients_section: office,
    office_client_customers_section: customers,
    report_catalog: visible ? REPORT_CATALOG : [],
    empty_state: {
      visible: false,
      title: visible ? 'אין עדיין לקוחות עם מסמכים' : '',
      description: visible ? 'לאחר הפקת מסמך עבור לקוח — הוא יופיע כאן.' : null,
    },
  };
}

async function countSelfModeRows(orgId: string): Promise<{ issued: number; drafts: number }> {
  const [issuedRes, draftRes] = await Promise.all([
    supabaseAdmin
      .from('income_documents')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('acting_mode', 'self')
      .eq('document_status', 'issued'),
    supabaseAdmin
      .from('income_document_drafts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('acting_mode', 'self')
      .eq('status', 'draft')
      .not('user_saved_at', 'is', null),
  ]);
  throwIfSupabaseError(issuedRes.error, 'countSelfModeIssuedDocuments');
  throwIfSupabaseError(draftRes.error, 'countSelfModeUserSavedDrafts');
  return {
    issued: issuedRes.count ?? 0,
    drafts: draftRes.count ?? 0,
  };
}

function logPanelTiming(label: string, startedAt: number): number {
  const elapsedMs = Date.now() - startedAt;
  console.info(`[income][client-document-panel][timing] ${label} ${elapsedMs}ms`);
  return Date.now();
}

function buildOfficeClientRow(params: {
  stat: PanelStatRow;
  meta:
    | {
        display_name: string;
        tax_id: string | null;
        email: string | null;
        phone: string | null;
        business_type: string | null;
        contact_person: string | null;
      }
    | undefined;
  perms: IncomeWorkspacePermissions;
  includeRetainerAction?: boolean;
  newDocumentInsteadOfMore?: boolean;
  omitDraftDocumentTypeCounter?: boolean;
  clientQuickCard?: IncomeClientDocumentManagementRow['client_quick_card'];
}): IncomeClientDocumentManagementRow {
  const clientId = String(params.stat.represented_client_id);
  const clientName = params.meta?.display_name ?? clientId;
  const unpaidRaw = Number(params.stat.unpaid_reference ?? 0);
  const unpaidRef = Number.isFinite(unpaidRaw) && unpaidRaw > 0 ? unpaidRaw : null;
  const currency = String(params.stat.currency || 'ILS');
  const totalDocuments = Number(params.stat.total_documents_count) || 0;
  const lastDocumentDate =
    typeof params.stat.last_document_date === 'string' ? params.stat.last_document_date : null;
  const lastActivityAt =
    typeof params.stat.last_activity_at === 'string' ? params.stat.last_activity_at : null;

  return {
    population_key: 'office_client',
    represented_client_id: clientId,
    income_customer_id: null,
    parent_represented_client_id: null,
    parent_client_display_name: null,
    client_display_name: clientName,
    client_logo_url: null,
    client_initials: clientName.trim().slice(0, 2) || '—',
    tax_id: params.meta?.tax_id ?? null,
    email: params.meta?.email ?? null,
    total_documents_count: totalDocuments,
    quote_count: Number(params.stat.quote_count) || 0,
    deal_count: Number(params.stat.deal_count) || 0,
    tax_invoice_count: Number(params.stat.tax_invoice_count) || 0,
    receipt_count: Number(params.stat.receipt_count) || 0,
    credit_count: Number(params.stat.credit_count) || 0,
    document_type_counters: buildDocumentTypeCounters(
      params.stat,
      {
        represented_client_id: clientId,
        income_customer_id: null,
      },
      { omitDraftDocumentTypeCounter: params.omitDraftDocumentTypeCounter },
    ),
    unpaid_amount_reference: unpaidRef,
    unpaid_amount_display:
      unpaidRef != null ? formatMoneyReference(unpaidRef, currency) : '—',
    last_document_date: lastDocumentDate,
    last_document_date_display: formatDateDisplay(lastDocumentDate),
    last_activity_at: lastActivityAt,
    last_activity_display: formatDateDisplay(lastActivityAt),
    status_label: statusLabelFromStat(params.stat),
    actions: buildOfficeClientRowActions(clientId, params.perms, {
      includeRetainerAction: params.includeRetainerAction,
      newDocumentInsteadOfMore: params.newDocumentInsteadOfMore,
    }),
    row_context: {
      population_key: 'office_client',
      acting_mode: 'office_representative',
      issuer_business_id: clientId,
      represented_client_id: clientId,
      income_customer_id: null,
    },
    ...(params.clientQuickCard !== undefined
      ? { client_quick_card: params.clientQuickCard }
      : {}),
  };
}

function buildEndCustomerRow(params: {
  stat: EndCustomerStatRow;
  customerMeta:
    | {
        display_name: string;
        tax_id: string | null;
        email: string | null;
        phone: string | null;
      }
    | undefined;
  parentDisplayName: string;
  perms: IncomeWorkspacePermissions;
  includeRetainerAction?: boolean;
  workEngineInvoicesFunctionalParity?: boolean;
  newDocumentInsteadOfMore?: boolean;
  omitDraftDocumentTypeCounter?: boolean;
  clientQuickCard?: IncomeClientDocumentManagementRow['client_quick_card'];
}): IncomeClientDocumentManagementRow {
  const representedClientId = String(params.stat.represented_client_id);
  const incomeCustomerId = String(params.stat.income_customer_id);
  const customerName = params.customerMeta?.display_name ?? incomeCustomerId;
  const unpaidRaw = Number(params.stat.unpaid_reference ?? 0);
  const unpaidRef = Number.isFinite(unpaidRaw) && unpaidRaw > 0 ? unpaidRaw : null;
  const currency = String(params.stat.currency || 'ILS');
  const totalDocuments = Number(params.stat.total_documents_count) || 0;
  const lastDocumentDate =
    typeof params.stat.last_document_date === 'string' ? params.stat.last_document_date : null;
  const lastActivityAt =
    typeof params.stat.last_activity_at === 'string' ? params.stat.last_activity_at : null;

  return {
    population_key: 'office_client_customer',
    represented_client_id: representedClientId,
    income_customer_id: incomeCustomerId,
    parent_represented_client_id: representedClientId,
    parent_client_display_name: params.parentDisplayName,
    client_display_name: customerName,
    client_logo_url: null,
    client_initials: customerName.trim().slice(0, 2) || '—',
    tax_id: params.customerMeta?.tax_id ?? null,
    email: params.customerMeta?.email ?? null,
    total_documents_count: totalDocuments,
    quote_count: Number(params.stat.quote_count) || 0,
    deal_count: Number(params.stat.deal_count) || 0,
    tax_invoice_count: Number(params.stat.tax_invoice_count) || 0,
    receipt_count: Number(params.stat.receipt_count) || 0,
    credit_count: Number(params.stat.credit_count) || 0,
    document_type_counters: buildDocumentTypeCounters(
      params.stat,
      {
        represented_client_id: representedClientId,
        income_customer_id: incomeCustomerId,
      },
      { omitDraftDocumentTypeCounter: params.omitDraftDocumentTypeCounter },
    ),
    unpaid_amount_reference: unpaidRef,
    unpaid_amount_display:
      unpaidRef != null ? formatMoneyReference(unpaidRef, currency) : '—',
    last_document_date: lastDocumentDate,
    last_document_date_display: formatDateDisplay(lastDocumentDate),
    last_activity_at: lastActivityAt,
    last_activity_display: formatDateDisplay(lastActivityAt),
    status_label: statusLabelFromStat(params.stat),
    actions: buildEndCustomerRowActions({
      representedClientId,
      incomeCustomerId,
      parentClientDisplayName: params.parentDisplayName,
      perms: params.perms,
      includeRetainerAction: params.includeRetainerAction,
      workEngineInvoicesFunctionalParity: params.workEngineInvoicesFunctionalParity,
      newDocumentInsteadOfMore: params.newDocumentInsteadOfMore,
    }),
    row_context: {
      population_key: 'office_client_customer',
      acting_mode: 'office_representative',
      issuer_business_id: representedClientId,
      represented_client_id: representedClientId,
      income_customer_id: incomeCustomerId,
    },
    ...(params.clientQuickCard !== undefined
      ? { client_quick_card: params.clientQuickCard }
      : {}),
  };
}

export async function buildIncomeClientDocumentManagementPanel(params: {
  ctx: RequestContext;
  perms: IncomeWorkspacePermissions;
  includeRetainerAction?: boolean;
  /**
   * Work Engine invoices tab only: enable end-customer action slots with real
   * end-customer contracts. Must stay false for /m/income (default).
   */
  workEngineInvoicesFunctionalParity?: boolean;
  /**
   * Work Engine invoices tab only: replace trailing `more` with `open_new_income_document`.
   */
  newDocumentInsteadOfMore?: boolean;
  /**
   * Work Engine invoices tab only: omit the draft (טיוטות) document-type cube.
   * Does not remove draft domain storage or commands.
   */
  omitDraftDocumentTypeCounter?: boolean;
  /**
   * Work Engine invoices tab only: attach `client_quick_card` to each row
   * (batched identity + DocFlow invite state). Must stay false for /m/income.
   */
  includeClientQuickCard?: boolean;
}): Promise<IncomeClientDocumentManagementPanel> {
  const orgId = params.ctx.organizationId!;
  const visible = params.perms.issue_on_behalf;
  const aggregateStartMs = Date.now();
  const includeClientQuickCard = params.includeClientQuickCard === true;

  if (!visible) {
    return emptyPanel(false);
  }

  let stepStart = aggregateStartMs;
  const [statsRes, endCustomerStatsRes, selfCounts, officeClientsRes] = await Promise.all([
    supabaseAdmin.rpc('income_client_document_management_panel_stats', {
      p_org_id: orgId,
    }),
    supabaseAdmin.rpc('income_client_document_management_end_customer_stats', {
      p_org_id: orgId,
    }),
    countSelfModeRows(orgId),
    /** Canonical ALL eligible office clients (Core clients), not document-derived. */
    supabaseAdmin
      .from('clients')
      .select('id, display_name, tax_id, email, phone')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .order('display_name', { ascending: true })
      .limit(500),
  ]);
  throwIfSupabaseError(statsRes.error, 'incomeClientDocumentManagementPanelStats', {
    migrationHint: '167_income_client_panel_stats_office_to_client_scope.sql',
  });
  throwIfSupabaseError(endCustomerStatsRes.error, 'incomeClientDocumentManagementEndCustomerStats', {
    migrationHint: '165_income_client_document_management_end_customer_stats.sql',
  });
  throwIfSupabaseError(officeClientsRes.error, 'loadOfficeClientsForDocumentManagementPanel');
  stepStart = logPanelTiming('rpc_office_and_end_customer_stats_and_clients', stepStart);

  const stats = (statsRes.data ?? []) as PanelStatRow[];
  const endCustomerStats = (endCustomerStatsRes.data ?? []) as EndCustomerStatRow[];
  const officeClients = (officeClientsRes.data ?? []) as Array<{
    id: string;
    display_name: string;
    tax_id: string | null;
    email: string | null;
    phone?: string | null;
  }>;

  const officeClientIds = officeClients.map((c) => String(c.id)).filter(Boolean);

  type OfficeClientMeta = {
    display_name: string;
    tax_id: string | null;
    email: string | null;
    phone: string | null;
    business_type: string | null;
    contact_person: string | null;
  };
  type EndCustomerMeta = {
    display_name: string;
    tax_id: string | null;
    email: string | null;
    phone: string | null;
  };

  const clientMetaById = new Map<string, OfficeClientMeta>();
  const customerMetaById = new Map<string, EndCustomerMeta>();

  for (const client of officeClients) {
    clientMetaById.set(client.id, {
      display_name: client.display_name,
      tax_id: client.tax_id,
      email: client.email,
      phone: client.phone ?? null,
      business_type: null,
      contact_person: null,
    });
  }

  /**
   * Canonical end-customer population: ALL active saved income_customers under
   * eligible office clients (not document-derived). Batched; no N+1.
   */
  const [canonicalCustomersRes] = await Promise.all([
    officeClientIds.length > 0
      ? supabaseAdmin
          .from('income_customers')
          .select('id, display_name, tax_id, email, phone, represented_client_id')
          .eq('organization_id', orgId)
          .eq('status', 'active')
          .eq('is_one_time', false)
          .in('represented_client_id', officeClientIds)
          .order('display_name', { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  throwIfSupabaseError(canonicalCustomersRes.error, 'loadCanonicalEndCustomersForDocumentManagementPanel');

  const canonicalCustomers = (canonicalCustomersRes.data ?? []) as Array<{
    id: string;
    display_name: string;
    tax_id: string | null;
    email: string | null;
    phone?: string | null;
    represented_client_id: string;
  }>;

  for (const customer of canonicalCustomers) {
    customerMetaById.set(customer.id, {
      display_name: customer.display_name,
      tax_id: customer.tax_id,
      email: customer.email,
      phone: customer.phone ?? null,
    });
  }
  stepStart = logPanelTiming('load_client_and_customer_meta', stepStart);

  const docflowInviteByClientId = new Map<string, ClientQuickCardDocflowInviteState>();
  let docflowModuleEntitled = false;

  if (includeClientQuickCard && officeClientIds.length > 0) {
    const [profilesRes, contactsRes, modulesRes] = await Promise.all([
      supabaseAdmin
        .from('client_operational_profiles')
        .select('client_id, business_type')
        .eq('organization_id', orgId)
        .in('client_id', officeClientIds),
      supabaseAdmin
        .from('client_contacts')
        .select('client_id, full_name, is_primary, status')
        .eq('organization_id', orgId)
        .in('client_id', officeClientIds)
        .order('created_at', { ascending: true }),
      supabaseAdmin.from('modules').select('id').eq('code', 'docflow').maybeSingle(),
    ]);
    throwIfSupabaseError(profilesRes.error, 'loadClientOperationalProfilesForQuickCard');
    throwIfSupabaseError(contactsRes.error, 'loadClientContactsForQuickCard');
    throwIfSupabaseError(modulesRes.error, 'loadDocflowModuleForQuickCard');

    for (const profile of profilesRes.data ?? []) {
      const cid = String((profile as { client_id?: string }).client_id ?? '');
      const meta = clientMetaById.get(cid);
      if (!meta) continue;
      meta.business_type = clientOperationsBusinessTypeDisplayHe(
        (profile as { business_type?: string | null }).business_type ?? null,
      );
    }

    const contactByClient = new Map<string, string>();
    for (const contact of contactsRes.data ?? []) {
      const cid = String((contact as { client_id?: string }).client_id ?? '');
      if (!cid || contactByClient.has(cid)) continue;
      const status = String((contact as { status?: string }).status ?? 'active');
      if (status && status !== 'active') continue;
      const name = String((contact as { full_name?: string }).full_name ?? '').trim();
      if (!name) continue;
      const isPrimary = Boolean((contact as { is_primary?: boolean }).is_primary);
      if (isPrimary || !contactByClient.has(cid)) {
        contactByClient.set(cid, name);
      }
    }
    // Prefer primary: second pass
    for (const contact of contactsRes.data ?? []) {
      const cid = String((contact as { client_id?: string }).client_id ?? '');
      if (!cid) continue;
      const status = String((contact as { status?: string }).status ?? 'active');
      if (status && status !== 'active') continue;
      if (!(contact as { is_primary?: boolean }).is_primary) continue;
      const name = String((contact as { full_name?: string }).full_name ?? '').trim();
      if (name) contactByClient.set(cid, name);
    }
    for (const [cid, name] of contactByClient) {
      const meta = clientMetaById.get(cid);
      if (meta) meta.contact_person = name;
    }

    const modId = modulesRes.data?.id ? String(modulesRes.data.id) : null;
    if (modId) {
      const entitlement = await resolveEntitlement(orgId, modId);
      docflowModuleEntitled =
        entitlement.status === 'entitled' || entitlement.status === 'trial';
    }

    const [portalUsersRes, invitesRes] = await Promise.all([
      supabaseAdmin
        .from('client_portal_users')
        .select('client_id, status, updated_at')
        .eq('org_id', orgId)
        .in('client_id', officeClientIds)
        .order('updated_at', { ascending: false }),
      supabaseAdmin
        .from('client_portal_invitations')
        .select('client_id, status, token_expires_at, created_at')
        .eq('org_id', orgId)
        .in('client_id', officeClientIds)
        .order('created_at', { ascending: false }),
    ]);
    throwIfSupabaseError(portalUsersRes.error, 'loadPortalUsersForQuickCard');
    throwIfSupabaseError(invitesRes.error, 'loadPortalInvitationsForQuickCard');

    const latestPortalByClient = new Map<string, string | null>();
    for (const row of portalUsersRes.data ?? []) {
      const cid = String((row as { client_id?: string }).client_id ?? '');
      if (!cid || latestPortalByClient.has(cid)) continue;
      latestPortalByClient.set(
        cid,
        (row as { status?: string | null }).status
          ? String((row as { status: string }).status)
          : null,
      );
    }
    const latestInviteByClient = new Map<
      string,
      { status: string | null; tokenExpiresAt: string | null }
    >();
    for (const row of invitesRes.data ?? []) {
      const cid = String((row as { client_id?: string }).client_id ?? '');
      if (!cid || latestInviteByClient.has(cid)) continue;
      latestInviteByClient.set(cid, {
        status: (row as { status?: string | null }).status
          ? String((row as { status: string }).status)
          : null,
        tokenExpiresAt: (row as { token_expires_at?: string | null }).token_expires_at
          ? String((row as { token_expires_at: string }).token_expires_at)
          : null,
      });
    }

    for (const cid of officeClientIds) {
      const invite = latestInviteByClient.get(cid);
      docflowInviteByClientId.set(cid, {
        module_entitled: docflowModuleEntitled,
        invite_status: resolveClientQuickCardDocflowInviteStatus({
          portalStatus: latestPortalByClient.get(cid) ?? null,
          inviteStatus: invite?.status ?? null,
          tokenExpiresAt: invite?.tokenExpiresAt ?? null,
        }),
      });
    }
    stepStart = logPanelTiming('load_quick_card_enrichment', stepStart);
  }

  const statsByClientId = new Map<string, PanelStatRow>();
  for (const stat of stats) {
    const id = String(stat.represented_client_id ?? '').trim();
    if (id) statsByClientId.set(id, stat);
  }

  const endCustomerStatsByPair = new Map<string, EndCustomerStatRow>();
  for (const stat of endCustomerStats) {
    const parentId = String(stat.represented_client_id ?? '').trim();
    const customerId = String(stat.income_customer_id ?? '').trim();
    if (!parentId || !customerId) continue;
    endCustomerStatsByPair.set(
      endCustomerPopulationKey({
        representedClientId: parentId,
        incomeCustomerId: customerId,
      }),
      stat,
    );
  }

  const officeRows: IncomeClientDocumentManagementRow[] = mergeOfficeClientsWithDocumentStats(
    officeClients,
    statsByClientId,
    (clientId) => zeroOfficeClientDocumentStat(clientId) as PanelStatRow,
  )
    .map(({ clientId, stat }) => {
      const meta = clientMetaById.get(clientId);
      const quickCard = includeClientQuickCard
        ? buildOfficeClientQuickCard({
            clientId,
            identity: {
              display_name: meta?.display_name ?? clientId,
              tax_id: meta?.tax_id ?? null,
              email: meta?.email ?? null,
              phone: meta?.phone ?? null,
              business_type: meta?.business_type ?? null,
              contact_person: meta?.contact_person ?? null,
            },
            docflow: docflowInviteByClientId.get(clientId) ?? {
              module_entitled: docflowModuleEntitled,
              invite_status: 'not_invited',
            },
          })
        : undefined;
      return buildOfficeClientRow({
        stat,
        meta,
        perms: params.perms,
        includeRetainerAction: params.includeRetainerAction,
        newDocumentInsteadOfMore: params.newDocumentInsteadOfMore,
        omitDraftDocumentTypeCounter: params.omitDraftDocumentTypeCounter,
        clientQuickCard: quickCard,
      });
    })
    .sort((a, b) => a.client_display_name.localeCompare(b.client_display_name, 'he'));

  const endCustomerRows: IncomeClientDocumentManagementRow[] = mergeEndCustomersWithDocumentStats(
    canonicalCustomers
      .filter((c) => Boolean(String(c.represented_client_id ?? '').trim()))
      .map((c) => ({
        id: String(c.id),
        represented_client_id: String(c.represented_client_id),
      })),
    endCustomerStatsByPair,
    (params) => zeroEndCustomerDocumentStat(params) as EndCustomerStatRow,
  )
    .map(({ representedClientId, incomeCustomerId, stat }) => {
      const customerMeta = customerMetaById.get(incomeCustomerId);
      const quickCard = includeClientQuickCard
        ? buildEndCustomerQuickCard({
            incomeCustomerId,
            identity: {
              display_name: customerMeta?.display_name ?? incomeCustomerId,
              tax_id: customerMeta?.tax_id ?? null,
              email: customerMeta?.email ?? null,
              phone: customerMeta?.phone ?? null,
              business_type: null,
              contact_person: null,
            },
          })
        : undefined;
      return buildEndCustomerRow({
        stat: {
          ...stat,
          represented_client_id: representedClientId,
          income_customer_id: incomeCustomerId,
        },
        customerMeta,
        parentDisplayName:
          clientMetaById.get(representedClientId)?.display_name ?? representedClientId,
        perms: params.perms,
        includeRetainerAction: params.includeRetainerAction,
        workEngineInvoicesFunctionalParity: params.workEngineInvoicesFunctionalParity,
        newDocumentInsteadOfMore: params.newDocumentInsteadOfMore,
        omitDraftDocumentTypeCounter: params.omitDraftDocumentTypeCounter,
        clientQuickCard: quickCard,
      });
    })
    .sort((a, b) => {
      const parentCmp = (a.parent_client_display_name ?? '').localeCompare(
        b.parent_client_display_name ?? '',
        'he',
      );
      if (parentCmp !== 0) return parentCmp;
      return a.client_display_name.localeCompare(b.client_display_name, 'he');
    });

  const endCustomerGroups = groupEndCustomerRowsByParent(
    endCustomerRows.map((row) => ({
      ...row,
      parent_represented_client_id: row.parent_represented_client_id!,
      parent_client_display_name: row.parent_client_display_name!,
    })),
  );

  const office_clients_section: IncomeClientDocumentManagementSection = {
    section_key: 'office_clients',
    title: 'לקוחות המשרד',
    total_count: officeRows.length,
    rows: officeRows,
    groups: null,
    page: { limit: null, offset: 0, has_more: false },
    empty_state: {
      visible: officeRows.length === 0,
      title: 'אין לקוחות במשרד',
      description:
        officeRows.length === 0 && (selfCounts.issued > 0 || selfCounts.drafts > 0)
          ? 'מסמכים במצב עצמי (self) אינם מוצגים כאן. לקוחות המשרד מופיעים כאן לפי רשימת הלקוחות של הארגון.'
          : 'הוסף לקוח למשרד כדי לראות אותו כאן עם מוני מסמכים ופעולות.',
    },
  };

  const office_client_customers_section: IncomeClientDocumentManagementSection = {
    section_key: 'office_client_customers',
    title: 'לקוחות של לקוחות המשרד',
    total_count: endCustomerRows.length,
    rows: endCustomerRows,
    groups: endCustomerGroups,
    page: { limit: null, offset: 0, has_more: false },
    empty_state: {
      visible: endCustomerRows.length === 0,
      title: 'אין לקוחות קצה',
      description:
        'לקוחות קצה מופיעים כאן לפי רשימת הלקוחות של לקוחות המשרד (גם ללא מסמכים).',
    },
  };

  logPanelTiming('TOTAL', aggregateStartMs);
  console.info(
    `[income][client-document-panel][payload] office_clients=${officeRows.length} end_customers=${endCustomerRows.length}`,
  );

  return {
    aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
    visible: true,
    title: 'ניהול מסמכים לפי לקוח',
    description:
      'כל לקוחות המשרד, וכל לקוחות הקצה שלהם (מוני מסמכים מתעדכנים לפי מסמכים במצב נציג משרד)',
    columns: PANEL_COLUMNS,
    rows: officeRows,
    office_clients_section,
    office_client_customers_section,
    report_catalog: REPORT_CATALOG,
    empty_state: {
      visible: officeRows.length === 0 && endCustomerRows.length === 0,
      title: 'אין לקוחות במשרד',
      description:
        officeRows.length === 0 &&
        endCustomerRows.length === 0 &&
        (selfCounts.issued > 0 || selfCounts.drafts > 0)
          ? 'מסמכים במצב עצמי (self) אינם מוצגים כאן. לקוחות המשרד מופיעים כאן לפי רשימת הלקוחות של הארגון.'
          : 'הוסף לקוח למשרד כדי להתחיל.',
    },
  };
}
