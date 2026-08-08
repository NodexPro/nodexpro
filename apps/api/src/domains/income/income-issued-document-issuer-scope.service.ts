/**
 * Resolve Income issuer scope for issued office-client documents when the active
 * workspace issuer is stale/wrong (common from Work Engine document lists).
 */

import { supabaseAdmin } from '../../db/client.js';
import type { RequestContext } from '../../shared/context.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import {
  assertRowMatchesIssuerScope,
  type ActiveIncomeIssuerScope,
} from './income.guards.js';
import {
  assertIncomeIssuerContextForCommand,
  ensureOrgIncomeIssuerProfile,
  incomeWorkspacePermissionsFromContext,
} from './income-issuer-context.service.js';
import { loadActiveIncomeIssuerScope } from './income-issuer-scope.service.js';

export type IssuedDocumentIssuerIdentity = {
  organization_id: string;
  issuer_business_id: string;
  represented_client_id: string | null;
};

export function scopeMatchesIssuedDocument(
  scope: ActiveIncomeIssuerScope,
  doc: IssuedDocumentIssuerIdentity,
): boolean {
  return (
    doc.organization_id === scope.org_id &&
    doc.issuer_business_id === scope.issuer_business_id &&
    (doc.represented_client_id ?? null) === (scope.represented_client_id ?? null)
  );
}

/**
 * When active workspace issuer matches the document — return it.
 * For office documents with a mismatched/stale active issuer, authorize a
 * request-scoped office issuer from the document (same gates as select_income_issuer_context).
 * Self-mode documents still require the active self issuer scope.
 */
export async function resolveIssuerScopeForIssuedDocument(
  ctx: RequestContext,
  doc: IssuedDocumentIssuerIdentity,
): Promise<ActiveIncomeIssuerScope> {
  const active = await loadActiveIncomeIssuerScope(ctx);
  if (scopeMatchesIssuedDocument(active, doc)) return active;

  const orgId = ctx.organizationId;
  if (!orgId || !ctx.user?.id) {
    assertRowMatchesIssuerScope(active, doc);
    return active;
  }

  const orgIssuer = await ensureOrgIncomeIssuerProfile(orgId);
  const isOfficeDocument =
    doc.represented_client_id != null || doc.issuer_business_id !== orgIssuer.id;
  if (!isOfficeDocument) {
    assertRowMatchesIssuerScope(active, doc);
    return active;
  }

  const representedClientId = doc.represented_client_id ?? doc.issuer_business_id;
  const { data: clientRow, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, display_name, legal_name, is_archived')
    .eq('organization_id', orgId)
    .eq('id', representedClientId)
    .maybeSingle();
  throwIfSupabaseError(clientErr, 'loadClientForIssuedDocumentIssuerScope');
  const representedClient =
    (clientRow as {
      id: string;
      display_name: string;
      legal_name: string | null;
      is_archived: boolean;
    } | null) ?? null;

  assertIncomeIssuerContextForCommand(
    ctx,
    orgId,
    {
      acting_mode: 'office_representative',
      issuer_business_id: representedClientId,
      represented_client_id: representedClientId,
    },
    { orgIssuerProfileId: orgIssuer.id, representedClient },
  );

  const label =
    representedClient?.display_name?.trim() ||
    representedClient?.legal_name?.trim() ||
    '—';
  return {
    org_id: orgId,
    actor_user_id: ctx.user.id,
    acting_mode: 'office_representative',
    issuer_business_id: doc.issuer_business_id,
    represented_client_id: doc.represented_client_id,
    issuer_label: label,
    represented_client_label: label,
    permissions: incomeWorkspacePermissionsFromContext(ctx),
  };
}
