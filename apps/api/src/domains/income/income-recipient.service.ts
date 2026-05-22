/**
 * Income document recipients (buyers) — scoped to active issuer, not Core clients.
 */

import { supabaseAdmin } from '../../db/client.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import type { IncomeWorkspacePermissions } from './income.types.js';
import {
  buildRecipientAddressJson,
  buildRecipientSnapshotJson,
  recipientDisplayLine,
  type RecipientFieldErrors,
  type RecipientInputFields,
} from './income-recipient.validation.js';

export type IncomeRecipientListRow = {
  income_customer_id: string;
  display_name: string;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  city: string | null;
  display_line: string;
};

export type IncomeRecipientCreateFieldSchema = {
  key: string;
  label: string;
  required: boolean;
  input_type: 'text' | 'checkbox';
  placeholder: string | null;
};

export type IncomeRecipientSelected =
  | {
      kind: 'saved';
      income_customer_id: string;
      display_line: string;
      snapshot: null;
    }
  | {
      kind: 'snapshot';
      income_customer_id: null;
      display_line: string;
      snapshot: Record<string, unknown>;
    };

export type IncomeRecipientSearchModel = {
  label: string;
  placeholder: string;
  recent_recipients: IncomeRecipientListRow[];
  search_results: IncomeRecipientListRow[];
  empty_state: { visible: boolean; message: string };
  create_new_action: { label: string; enabled: boolean; disabled_reason: string | null };
  create_fields_schema: IncomeRecipientCreateFieldSchema[];
  save_for_future_label: string;
  save_for_future_available: boolean;
  selected: IncomeRecipientSelected | null;
  field_errors: RecipientFieldErrors;
  allowed_actions: string[];
};

export type RecipientSearchOverlay = {
  search_query?: string;
  search_results?: IncomeRecipientListRow[];
  selected?: IncomeRecipientSelected | null;
  field_errors?: RecipientFieldErrors;
};

function applyIssuerScopeToCustomersQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  scope: ActiveIncomeIssuerScope,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  let q = query
    .eq('organization_id', scope.org_id)
    .eq('issuer_business_id', scope.issuer_business_id)
    .eq('status', 'active')
    .eq('is_one_time', false);
  if (scope.represented_client_id === null) {
    q = q.is('represented_client_id', null);
  } else {
    q = q.eq('represented_client_id', scope.represented_client_id);
  }
  return q;
}

function escapeIlikePattern(q: string): string {
  return q.replace(/[%_\\]/g, '\\$&');
}

function addressPartsFromJson(address_json: Record<string, unknown> | null): {
  address_line: string | null;
  city: string | null;
} {
  if (!address_json || typeof address_json !== 'object') {
    return { address_line: null, city: null };
  }
  const address =
    typeof address_json.address === 'string'
      ? address_json.address
      : typeof address_json.line1 === 'string'
        ? address_json.line1
        : null;
  const city = typeof address_json.city === 'string' ? address_json.city : null;
  return { address_line: address, city };
}

function mapCustomerRow(row: {
  id: string;
  display_name: string;
  tax_id: string | null;
  phone: string | null;
  email: string | null;
  address_json: Record<string, unknown> | null;
}): IncomeRecipientListRow {
  const { address_line, city } = addressPartsFromJson(row.address_json);
  return {
    income_customer_id: row.id,
    display_name: row.display_name,
    tax_id: row.tax_id,
    phone: row.phone,
    email: row.email,
    address_line,
    city,
    display_line: recipientDisplayLine(row),
  };
}

export function buildRecipientCreateFieldsSchema(): IncomeRecipientCreateFieldSchema[] {
  return [
    { key: 'display_name', label: 'שם', required: true, input_type: 'text', placeholder: null },
    {
      key: 'tax_id',
      label: 'ח.פ / ע.מ',
      required: false,
      input_type: 'text',
      placeholder: null,
    },
    { key: 'phone', label: 'טלפון', required: false, input_type: 'text', placeholder: null },
    { key: 'email', label: 'אימייל', required: false, input_type: 'text', placeholder: null },
    { key: 'address', label: 'כתובת', required: false, input_type: 'text', placeholder: null },
    { key: 'city', label: 'עיר', required: false, input_type: 'text', placeholder: null },
    {
      key: 'save_for_future',
      label: 'שמור לשימוש עתידי',
      required: false,
      input_type: 'checkbox',
      placeholder: null,
    },
  ];
}

export function recipientSearchAllowedActions(perms: IncomeWorkspacePermissions): string[] {
  const actions: string[] = [];
  if (perms.edit) {
    actions.push(
      'search_income_recipients',
      'select_income_recipient',
      'set_income_recipient_snapshot',
      'save_income_recipient_for_future',
    );
  }
  return actions;
}

async function loadCustomerRows(scope: ActiveIncomeIssuerScope, limit: number): Promise<
  Array<{
    id: string;
    display_name: string;
    tax_id: string | null;
    phone: string | null;
    email: string | null;
    address_json: Record<string, unknown> | null;
    updated_at: string;
  }>
> {
  let query = supabaseAdmin
    .from('income_customers')
    .select('id, display_name, tax_id, phone, email, address_json, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  query = applyIssuerScopeToCustomersQuery(query, scope);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    display_name: string;
    tax_id: string | null;
    phone: string | null;
    email: string | null;
    address_json: Record<string, unknown> | null;
    updated_at: string;
  }>;
}

export async function loadRecentIncomeRecipients(
  scope: ActiveIncomeIssuerScope,
  limit = 8,
): Promise<IncomeRecipientListRow[]> {
  const rows = await loadCustomerRows(scope, limit);
  return rows.map(mapCustomerRow);
}

export async function searchIncomeRecipients(
  scope: ActiveIncomeIssuerScope,
  queryText: string,
  limit = 20,
): Promise<IncomeRecipientListRow[]> {
  const q = queryText.trim();
  if (!q) return loadRecentIncomeRecipients(scope, limit);

  const pattern = `%${escapeIlikePattern(q)}%`;
  let query = supabaseAdmin
    .from('income_customers')
    .select('id, display_name, tax_id, phone, email, address_json, updated_at')
    .or(
      `display_name.ilike.${pattern},tax_id.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`,
    )
    .order('display_name', { ascending: true })
    .limit(limit);
  query = applyIssuerScopeToCustomersQuery(query, scope);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) =>
    mapCustomerRow(
      row as {
        id: string;
        display_name: string;
        tax_id: string | null;
        phone: string | null;
        email: string | null;
        address_json: Record<string, unknown> | null;
      },
    ),
  );
}

export async function loadIncomeRecipientById(
  scope: ActiveIncomeIssuerScope,
  incomeCustomerId: string,
): Promise<IncomeRecipientListRow | null> {
  let query = supabaseAdmin
    .from('income_customers')
    .select('id, display_name, tax_id, phone, email, address_json')
    .eq('id', incomeCustomerId);
  query = applyIssuerScopeToCustomersQuery(query, scope);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapCustomerRow(
    data as {
      id: string;
      display_name: string;
      tax_id: string | null;
      phone: string | null;
      email: string | null;
      address_json: Record<string, unknown> | null;
    },
  );
}

export function selectedFromSavedRow(row: IncomeRecipientListRow): IncomeRecipientSelected {
  return {
    kind: 'saved',
    income_customer_id: row.income_customer_id,
    display_line: row.display_line,
    snapshot: null,
  };
}

export function selectedFromInputFields(fields: RecipientInputFields): IncomeRecipientSelected {
  return {
    kind: 'snapshot',
    income_customer_id: null,
    display_line: recipientDisplayLine(fields),
    snapshot: buildRecipientSnapshotJson(fields),
  };
}

export async function buildIncomeRecipientSearchModel(
  scope: ActiveIncomeIssuerScope,
  perms: IncomeWorkspacePermissions,
  overlay: RecipientSearchOverlay = {},
): Promise<IncomeRecipientSearchModel> {
  const searchQuery = overlay.search_query ?? '';
  const recent_recipients = await loadRecentIncomeRecipients(scope);
  const search_results =
    overlay.search_results ??
    (searchQuery.trim() ? await searchIncomeRecipients(scope, searchQuery) : recent_recipients);

  const canEdit = perms.edit;
  return {
    label: 'מקבל המסמך',
    placeholder: 'חיפוש לפי שם / ח.פ / ע.מ / טלפון / אימייל',
    recent_recipients,
    search_results,
    empty_state: {
      visible: searchQuery.trim().length > 0 && search_results.length === 0,
      message: 'לא נמצאו מקבלים שמורים',
    },
    create_new_action: {
      label: '+ יצירת מקבל חדש',
      enabled: canEdit,
      disabled_reason: canEdit ? null : 'נדרשת הרשאת income.edit',
    },
    create_fields_schema: buildRecipientCreateFieldsSchema(),
    save_for_future_label: 'שמור לשימוש עתידי',
    save_for_future_available: canEdit,
    selected: overlay.selected ?? null,
    field_errors: overlay.field_errors ?? {},
    allowed_actions: recipientSearchAllowedActions(perms),
  };
}

export async function insertSavedIncomeRecipient(
  scope: ActiveIncomeIssuerScope,
  fields: RecipientInputFields,
  actorUserId: string,
): Promise<IncomeRecipientListRow> {
  const address_json = buildRecipientAddressJson(fields);
  const { data, error } = await supabaseAdmin
    .from('income_customers')
    .insert({
      organization_id: scope.org_id,
      represented_client_id: scope.represented_client_id,
      issuer_business_id: scope.issuer_business_id,
      display_name: fields.display_name,
      phone: fields.phone,
      email: fields.email,
      tax_id: fields.tax_id,
      address_json,
      is_one_time: false,
      status: 'active',
      created_by_user_id: actorUserId,
    })
    .select('id, display_name, tax_id, phone, email, address_json')
    .single();
  if (error) throw error;
  return mapCustomerRow(
    data as {
      id: string;
      display_name: string;
      tax_id: string | null;
      phone: string | null;
      email: string | null;
      address_json: Record<string, unknown> | null;
    },
  );
}
