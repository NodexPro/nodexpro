/**
 * INC-2 — Income workspace aggregate (issuer-scoped operational data).
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import { loadActiveIncomeIssuerScope, toIssuerContextSummary } from './income-issuer-scope.service.js';
import { buildIncomeWorkspaceCards, buildWorkspaceAllowedActions } from './income-workspace-cards.builders.js';
import {
  INCOME_WORKSPACE_AGGREGATE_KEY,
  type IncomeCustomersTableRow,
  type IncomeDocumentType,
  type IncomeDraftsTableRow,
  type IncomeItemsTableRow,
  type IncomeTableModel,
  type IncomeWorkspaceAggregate,
} from './income.types.js';

const DOCUMENT_TYPE_LABELS: Record<IncomeDocumentType, string> = {
  receipt: 'קבלה',
  tax_invoice: 'חשבונית מס',
  tax_invoice_receipt: 'חשבונית מס קבלה',
  credit_tax_invoice: 'חשבונית מס זיכוי',
  deal_invoice: 'חשבונית עסקה',
  quote: 'הצעת מחיר',
};

function applyIssuerScopeToBuilder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  scope: ActiveIncomeIssuerScope,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  let q = query.eq('organization_id', scope.org_id).eq('issuer_business_id', scope.issuer_business_id);
  if (scope.represented_client_id === null) {
    q = q.is('represented_client_id', null);
  } else {
    q = q.eq('represented_client_id', scope.represented_client_id);
  }
  return q;
}

async function countScoped(
  table: 'income_customers' | 'income_items' | 'income_document_drafts',
  scope: ActiveIncomeIssuerScope,
  statusFilter?: { column: string; value: string | boolean },
): Promise<number> {
  let query = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  query = applyIssuerScopeToBuilder(query, scope);
  if (statusFilter) query = query.eq(statusFilter.column, statusFilter.value);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function loadCustomers(scope: ActiveIncomeIssuerScope): Promise<IncomeCustomersTableRow[]> {
  let query = supabaseAdmin
    .from('income_customers')
    .select('id, display_name, phone, email, tax_id, is_one_time, status, created_at')
    .order('display_name', { ascending: true })
    .limit(500);
  query = applyIssuerScopeToBuilder(query, scope);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      display_name: string;
      phone: string | null;
      email: string | null;
      tax_id: string | null;
      is_one_time: boolean;
      status: string;
      created_at: string;
    };
    return {
      customer_id: r.id,
      display_name: r.display_name,
      phone: r.phone,
      email: r.email,
      tax_id: r.tax_id,
      is_one_time: r.is_one_time,
      status: r.status,
      status_label: r.status === 'archived' ? 'Archived' : 'Active',
      created_at: r.created_at,
    };
  });
}

async function loadItems(scope: ActiveIncomeIssuerScope): Promise<IncomeItemsTableRow[]> {
  let query = supabaseAdmin
    .from('income_items')
    .select(
      'id, item_type, name, description, default_unit_price_reference, currency, active, created_at',
    )
    .eq('active', true)
    .order('name', { ascending: true })
    .limit(500);
  query = applyIssuerScopeToBuilder(query, scope);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      item_type: 'service' | 'product';
      name: string;
      description: string | null;
      default_unit_price_reference: number | null;
      currency: string | null;
      active: boolean;
      created_at: string;
    };
    return {
      item_id: r.id,
      item_type: r.item_type,
      item_type_label: r.item_type === 'product' ? 'Product' : 'Service',
      name: r.name,
      description: r.description,
      default_unit_price_reference: r.default_unit_price_reference,
      currency: r.currency,
      active: r.active,
      created_at: r.created_at,
    };
  });
}

async function loadDrafts(
  scope: ActiveIncomeIssuerScope,
  customerNames: Map<string, string>,
): Promise<IncomeDraftsTableRow[]> {
  let query = supabaseAdmin
    .from('income_document_drafts')
    .select(
      'id, document_type, status, income_customer_id, one_time_customer_snapshot_json, draft_lines_json, updated_at',
    )
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(500);
  query = applyIssuerScopeToBuilder(query, scope);
  const { data, error } = await query;
  if (error) throw error;

  const canEdit = scope.permissions.edit;
  return (data ?? []).map((row) => {
    const r = row as {
      id: string;
      document_type: IncomeDocumentType | null;
      status: string;
      income_customer_id: string | null;
      one_time_customer_snapshot_json: Record<string, unknown> | null;
      draft_lines_json: unknown;
      updated_at: string;
    };
    const lines = Array.isArray(r.draft_lines_json) ? r.draft_lines_json : [];
    let customerDisplay: string | null = null;
    if (r.income_customer_id) {
      customerDisplay = customerNames.get(r.income_customer_id) ?? null;
    } else if (r.one_time_customer_snapshot_json?.display_name != null) {
      customerDisplay = String(r.one_time_customer_snapshot_json.display_name);
    }
    const docType = r.document_type;
    return {
      draft_id: r.id,
      document_type: docType,
      document_type_label: docType ? DOCUMENT_TYPE_LABELS[docType] : null,
      status: r.status,
      status_label: r.status === 'cancelled' ? 'Cancelled' : 'Draft',
      income_customer_id: r.income_customer_id,
      customer_display_name: customerDisplay,
      line_count: lines.length,
      updated_at: r.updated_at,
      allowed_actions: canEdit
        ? ['update_income_document_draft', 'cancel_income_document_draft']
        : [],
    };
  });
}

function customersTableModel(rows: IncomeCustomersTableRow[]): IncomeTableModel<IncomeCustomersTableRow> {
  return {
    columns: [
      { key: 'display_name', label: 'שם' },
      { key: 'phone', label: 'טלפון' },
      { key: 'email', label: 'אימייל' },
      { key: 'tax_id', label: 'מספר עוסק / ח.פ.' },
      { key: 'status_label', label: 'סטטוס' },
    ],
    rows,
    empty_state: {
      visible: rows.length === 0,
      title: 'אין לקוחות הכנסות',
      description: null,
    },
  };
}

function itemsTableModel(rows: IncomeItemsTableRow[]): IncomeTableModel<IncomeItemsTableRow> {
  return {
    columns: [
      { key: 'name', label: 'שם פריט' },
      { key: 'item_type_label', label: 'סוג' },
      { key: 'default_unit_price_reference', label: 'מחיר התייחסות' },
      { key: 'currency', label: 'מטבע' },
    ],
    rows,
    empty_state: {
      visible: rows.length === 0,
      title: 'אין פריטים',
      description: null,
    },
  };
}

function draftsTableModel(rows: IncomeDraftsTableRow[]): IncomeTableModel<IncomeDraftsTableRow> {
  return {
    columns: [
      { key: 'document_type_label', label: 'סוג מסמך' },
      { key: 'customer_display_name', label: 'לקוח' },
      { key: 'line_count', label: 'שורות' },
      { key: 'status_label', label: 'סטטוס' },
      { key: 'updated_at', label: 'עודכן' },
    ],
    rows,
    empty_state: {
      visible: rows.length === 0,
      title: 'אין טיוטות',
      description: null,
    },
  };
}

export async function buildIncomeWorkspaceAggregate(ctx: RequestContext): Promise<IncomeWorkspaceAggregate> {
  const scope = await loadActiveIncomeIssuerScope(ctx);
  if (!scope.permissions.view) throw forbidden('income.view required');

  const [customersCount, itemsCount, draftsCount] = await Promise.all([
    countScoped('income_customers', scope, { column: 'status', value: 'active' }),
    countScoped('income_items', scope, { column: 'active', value: true }),
    countScoped('income_document_drafts', scope, { column: 'status', value: 'draft' }),
  ]);

  const customers = await loadCustomers(scope);
  const customerNames = new Map(customers.map((c) => [c.customer_id, c.display_name]));
  const items = await loadItems(scope);
  const drafts = await loadDrafts(scope, customerNames);

  return {
    aggregate_key: INCOME_WORKSPACE_AGGREGATE_KEY,
    org_id: scope.org_id,
    actor_user_id: scope.actor_user_id,
    issuer_context: toIssuerContextSummary(scope),
    cards: buildIncomeWorkspaceCards(scope.permissions, {
      customers: customersCount,
      items: itemsCount,
      drafts: draftsCount,
    }),
    customers_table_model: customersTableModel(customers),
    items_table_model: itemsTableModel(items),
    drafts_table_model: draftsTableModel(drafts),
    allowed_actions: buildWorkspaceAllowedActions(scope.permissions),
  };
}
