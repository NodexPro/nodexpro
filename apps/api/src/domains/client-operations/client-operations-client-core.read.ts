/**
 * Core client + operational profile read slice — same DB truth as /m/client-operations case/registry.
 * Used by Income issuer snapshot and Work Engine invoices wizard (no parallel incomplete reads).
 */

import { supabaseAdmin } from '../../db/client.js';
import {
  normalizeIssuerBusinessType,
  type IncomeIssuerBusinessType,
} from '../income/income-document-types.fallback.js';

/** Hebrew profile values — must match client-operations.service ALLOWED_BUSINESS_TYPES. */
export const CLIENT_OPERATIONS_BUSINESS_TYPE_OSEK_PATUR = 'עוסק פטור' as const;
export const CLIENT_OPERATIONS_BUSINESS_TYPE_OSEK_MURSHE = 'עוסק מורשה' as const;

export type ClientOperationsCoreClientRow = {
  id: string;
  display_name: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  business_type: string | null;
};

/** Trim stored DB text (same row Client Operations reads). */
export function normalizeStoredClientOperationsBusinessTypeRaw(
  raw: string | null | undefined,
): string | null {
  if (raw == null) return null;
  const s = String(raw).replace(/\u00a0/g, ' ').trim();
  return s || null;
}

/** Display label = stored Client Operations profile value (Hebrew). */
export function clientOperationsBusinessTypeDisplayHe(
  raw: string | null | undefined,
): string | null {
  return normalizeStoredClientOperationsBusinessTypeRaw(raw);
}

/** Map CO profile business_type → Income issuer eligibility codes. */
export function mapClientOperationsBusinessTypeForIncomeIssuer(
  raw: string | null | undefined,
): IncomeIssuerBusinessType {
  const s = normalizeStoredClientOperationsBusinessTypeRaw(raw) ?? '';
  if (s === CLIENT_OPERATIONS_BUSINESS_TYPE_OSEK_PATUR) return 'osek_patur';
  if (s === CLIENT_OPERATIONS_BUSINESS_TYPE_OSEK_MURSHE) return 'osek_murshe';
  if (s === 'חברה' || s === 'תאגיד') return 'company';
  if (s === 'אחר') return 'unknown';
  return normalizeIssuerBusinessType(raw);
}

/** Same address shape as client operations case (`address` + `city` columns on clients). */
export function buildClientOperationsAddressJson(
  address: string | null | undefined,
  city: string | null | undefined,
): Record<string, unknown> | null {
  const street = String(address ?? '').trim();
  const c = String(city ?? '').trim();
  if (!street && !c) return null;
  const parts: string[] = [];
  if (street) parts.push(street);
  if (c) parts.push(c);
  return {
    line1: street || null,
    city: c || null,
    formatted: parts.join(' · '),
  };
}

export async function loadClientOperationsCoreClient(
  orgId: string,
  clientId: string,
): Promise<ClientOperationsCoreClientRow | null> {
  const { data: client, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id, email, phone, address, city')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (cErr) throw cErr;
  if (!client) return null;

  const { data: profile } = await supabaseAdmin
    .from('client_operational_profiles')
    .select('business_type')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();

  const row = client as {
    id: string;
    display_name: string;
    tax_id: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
  };

  return {
    ...row,
    business_type: (profile as { business_type?: string | null } | null)?.business_type ?? null,
  };
}

export async function loadClientOperationsCoreClientsForOrg(
  orgId: string,
): Promise<ClientOperationsCoreClientRow[]> {
  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, tax_id, email, phone, address, city')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('display_name', { ascending: true })
    .limit(500);
  if (error) throw error;
  const safe = (clients ?? []) as Array<{
    id: string;
    display_name: string;
    tax_id: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
  }>;
  if (safe.length === 0) return [];

  const clientIds = safe.map((c) => c.id);
  const { data: profiles } = await supabaseAdmin
    .from('client_operational_profiles')
    .select('client_id, business_type')
    .eq('organization_id', orgId)
    .in('client_id', clientIds);

  const profileByClient = new Map(
    (profiles ?? []).map((p) => [
      String((p as { client_id: string }).client_id),
      (p as { business_type?: string | null }).business_type ?? null,
    ]),
  );

  return safe.map((c) => ({
    ...c,
    business_type: profileByClient.get(c.id) ?? null,
  }));
}
