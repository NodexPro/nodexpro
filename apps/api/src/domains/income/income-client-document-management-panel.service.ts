/**
 * Income — Client Document Management panel (CRM-style client list).
 * Single aggregate read model; issuer-scoped branding via existing studio.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  amountReferenceFromTotalsSnapshot,
  isInvoiceCollectionDocumentType,
} from './income-work-engine-bridge.pure.js';
import {
  INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
  INCOME_COMMAND_SELECT_ISSUER,
} from './income.types.js';
import type {
  IncomeClientDocumentManagementPanel,
  IncomeClientDocumentManagementReportItem,
  IncomeClientDocumentManagementRow,
  IncomeClientDocumentManagementRowAction,
  IncomeDocumentType,
  IncomeWorkspacePermissions,
} from './income.types.js';

const PANEL_DOCUMENT_TYPES: IncomeDocumentType[] = [
  'quote',
  'deal_invoice',
  'tax_invoice',
  'tax_invoice_receipt',
  'receipt',
  'credit_tax_invoice',
];

const REPORT_CATALOG: IncomeClientDocumentManagementReportItem[] = [
  { key: 'income_summary', label: 'דוח הכנסות', enabled: false, disabled_reason: 'בקרוב' },
  { key: 'aging', label: 'Aging', enabled: false, disabled_reason: 'בקרוב' },
  { key: 'documents', label: 'דוח מסמכים', enabled: false, disabled_reason: 'בקרוב' },
  { key: 'payments', label: 'דוח תשלומים', enabled: false, disabled_reason: 'בקרוב' },
  { key: 'csv_export', label: 'CSV Export', enabled: false, disabled_reason: 'בקרוב' },
];

const BUCKET_ORG_ASSETS = 'organization-assets';

async function ensureOrgAssetsBucket(): Promise<void> {
  const { error } = await supabaseAdmin.storage.createBucket(BUCKET_ORG_ASSETS, { public: false });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function fileAssetToDataUrl(fileAssetId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('file_assets')
    .select('storage_bucket, storage_key, mime_type, archived_at')
    .eq('id', fileAssetId)
    .maybeSingle();
  throwIfSupabaseError(error, 'fileAssetToDataUrl');
  const row = data as
    | { storage_bucket?: string | null; storage_key?: string; mime_type?: string | null; archived_at?: string | null }
    | null;
  if (!row?.storage_key || row.archived_at) return null;
  const bucket = row.storage_bucket ?? BUCKET_ORG_ASSETS;
  if (bucket === BUCKET_ORG_ASSETS) await ensureOrgAssetsBucket();
  const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(bucket).download(row.storage_key);
  if (dlErr || !blob) return null;
  const buf = Buffer.from(await blob.arrayBuffer());
  const mime = (row.mime_type ?? 'image/png').split(';')[0].trim();
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function buildRowActions(
  clientId: string,
  perms: IncomeWorkspacePermissions,
): IncomeClientDocumentManagementRowAction[] {
  const canEdit = perms.edit;
  return [
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
      key: 'more',
      label: 'פעולות נוספות',
      icon_key: 'more',
      command: null,
      command_payload: { open_more_menu: true, client_id: clientId },
      enabled: true,
      disabled_reason: null,
    },
  ];
}

function formatMoneyReference(amount: number, currency: string): string {
  return `${amount.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

function formatDateDisplay(iso: string | null): string {
  if (!iso) return '—';
  const d = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return new Date(d).toLocaleDateString('he-IL');
}

function emptyPanel(visible: boolean): IncomeClientDocumentManagementPanel {
  return {
    aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
    visible,
    title: 'ניהול מסמכים לפי לקוח',
    description: visible ? 'לקוחות שכבר הופקו עבורם מסמכי הכנסה' : null,
    columns: [],
    rows: [],
    report_catalog: visible ? REPORT_CATALOG : [],
    empty_state: {
      visible: false,
      title: visible ? 'אין עדיין לקוחות עם מסמכים' : '',
      description: visible ? 'לאחר הפקת מסמך עבור לקוח — הוא יופיע כאן.' : null,
    },
  };
}

function incrementTypeCount(acc: Acc, documentType: IncomeDocumentType): void {
  if (documentType === 'quote') acc.quote_count += 1;
  else if (documentType === 'deal_invoice') acc.deal_count += 1;
  else if (documentType === 'tax_invoice' || documentType === 'tax_invoice_receipt') acc.tax_invoice_count += 1;
  else if (documentType === 'receipt') acc.receipt_count += 1;
  else if (documentType === 'credit_tax_invoice') acc.credit_count += 1;
}

type Acc = {
  represented_client_id: string;
  total_documents_count: number;
  quote_count: number;
  deal_count: number;
  tax_invoice_count: number;
  receipt_count: number;
  credit_count: number;
  last_document_date: string | null;
  last_activity_at: string | null;
  unpaid_reference: number;
  currency: string;
};

export async function buildIncomeClientDocumentManagementPanel(params: {
  ctx: RequestContext;
  perms: IncomeWorkspacePermissions;
}): Promise<IncomeClientDocumentManagementPanel> {
  const orgId = params.ctx.organizationId!;
  const visible = params.perms.issue_on_behalf;

  if (!visible) {
    return emptyPanel(false);
  }

  const { data: docs, error: docsErr } = await supabaseAdmin
    .from('income_documents')
    .select(
      'id, represented_client_id, document_type, issue_date, updated_at, currency, totals_snapshot_json, due_date',
    )
    .eq('organization_id', orgId)
    .not('represented_client_id', 'is', null)
    .in('document_type', PANEL_DOCUMENT_TYPES)
    .order('issue_date', { ascending: false })
    .limit(5000);
  throwIfSupabaseError(docsErr, 'loadClientDocumentManagementDocs');

  const byClient = new Map<string, Acc>();

  for (const raw of docs ?? []) {
    const row = raw as {
      represented_client_id: string;
      document_type: IncomeDocumentType;
      issue_date: string | null;
      updated_at: string;
      currency: string;
      totals_snapshot_json: Record<string, unknown> | null;
    };
    const clientId = row.represented_client_id;
    let acc = byClient.get(clientId);
    if (!acc) {
      acc = {
        represented_client_id: clientId,
        total_documents_count: 0,
        quote_count: 0,
        deal_count: 0,
        tax_invoice_count: 0,
        receipt_count: 0,
        credit_count: 0,
        last_document_date: null,
        last_activity_at: null,
        unpaid_reference: 0,
        currency: row.currency || 'ILS',
      };
      byClient.set(clientId, acc);
    }
    acc.total_documents_count += 1;
    incrementTypeCount(acc, row.document_type);
    const activityAt = row.updated_at || row.issue_date;
    if (!acc.last_activity_at || (activityAt && activityAt > acc.last_activity_at)) {
      acc.last_activity_at = activityAt;
    }
    if (!acc.last_document_date || (row.issue_date && row.issue_date > acc.last_document_date)) {
      acc.last_document_date = row.issue_date;
    }
    if (isInvoiceCollectionDocumentType(row.document_type)) {
      const amount = amountReferenceFromTotalsSnapshot(row.totals_snapshot_json);
      if (amount != null && amount > 0) {
        acc.unpaid_reference += amount;
      }
    }
  }

  const clientIds = [...byClient.keys()];
  const clientMetaById = new Map<
    string,
    { display_name: string; tax_id: string | null; email: string | null }
  >();
  if (clientIds.length > 0) {
    const { data: clients, error: clientsErr } = await supabaseAdmin
      .from('clients')
      .select('id, display_name, tax_id, email')
      .eq('organization_id', orgId)
      .in('id', clientIds);
    throwIfSupabaseError(clientsErr, 'loadClientDocumentManagementClients');
    for (const c of clients ?? []) {
      const client = c as {
        id: string;
        display_name: string;
        tax_id: string | null;
        email: string | null;
      };
      clientMetaById.set(client.id, {
        display_name: client.display_name,
        tax_id: client.tax_id,
        email: client.email,
      });
    }
  }

  const logoByClientId = new Map<string, string | null>();
  if (clientIds.length > 0) {
    const { data: profiles, error: profilesErr } = await supabaseAdmin
      .from('income_document_branding_profiles')
      .select('issuer_business_id, logo_file_asset_id')
      .eq('organization_id', orgId)
      .in('issuer_business_id', clientIds);
    throwIfSupabaseError(profilesErr, 'loadClientDocumentManagementLogos');
    for (const p of profiles ?? []) {
      const profile = p as { issuer_business_id: string; logo_file_asset_id: string | null };
      if (profile.logo_file_asset_id) {
        logoByClientId.set(
          profile.issuer_business_id,
          await fileAssetToDataUrl(profile.logo_file_asset_id),
        );
      }
    }
  }

  const rows: IncomeClientDocumentManagementRow[] = clientIds
    .map((clientId) => {
      const acc = byClient.get(clientId)!;
      const meta = clientMetaById.get(clientId);
      const clientName = meta?.display_name ?? clientId;
      const unpaidRef = acc.unpaid_reference > 0 ? acc.unpaid_reference : null;
      return {
        represented_client_id: clientId,
        client_display_name: clientName,
        client_logo_url: logoByClientId.get(clientId) ?? null,
        client_initials: clientName.trim().slice(0, 2) || '—',
        tax_id: meta?.tax_id ?? null,
        email: meta?.email ?? null,
        total_documents_count: acc.total_documents_count,
        quote_count: acc.quote_count,
        deal_count: acc.deal_count,
        tax_invoice_count: acc.tax_invoice_count,
        receipt_count: acc.receipt_count,
        credit_count: acc.credit_count,
        unpaid_amount_reference: unpaidRef,
        unpaid_amount_display:
          unpaidRef != null ? formatMoneyReference(unpaidRef, acc.currency) : '—',
        last_document_date: acc.last_document_date,
        last_document_date_display: formatDateDisplay(acc.last_document_date),
        last_activity_at: acc.last_activity_at,
        last_activity_display: formatDateDisplay(acc.last_activity_at),
        status_label: unpaidRef != null ? 'פתוח לגבייה' : 'פעיל',
        actions: buildRowActions(clientId, params.perms),
      };
    })
    .sort((a, b) => a.client_display_name.localeCompare(b.client_display_name, 'he'));

  return {
    aggregate_key: INCOME_CLIENT_DOCUMENT_MANAGEMENT_PANEL_AGGREGATE_KEY,
    visible: true,
    title: 'ניהול מסמכים לפי לקוח',
    description: 'לקוחות שכבר הופקו עבורם מסמכי הכנסה',
    columns: [
      { key: 'client', label: 'לקוח' },
      { key: 'total_documents_count', label: 'מסמכים' },
      { key: 'unpaid_amount_display', label: 'לא שולם' },
      { key: 'last_document_date_display', label: 'מסמך אחרון' },
      { key: 'last_activity_display', label: 'פעילות אחרונה' },
      { key: 'status_label', label: 'סטטוס' },
      { key: 'actions', label: '' },
    ],
    rows,
    report_catalog: REPORT_CATALOG,
    empty_state: {
      visible: rows.length === 0,
      title: 'אין עדיין לקוחות עם מסמכים',
      description: 'לאחר הפקת מסמך עבור לקוח — הוא יופיע כאן.',
    },
  };
}
