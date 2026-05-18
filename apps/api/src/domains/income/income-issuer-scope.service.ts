/**
 * Active income issuer scope — single backend source for command writes and aggregate reads.
 */

import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import { buildIncomeWorkspaceContextAggregate } from './income-issuer-context.service.js';
import type { ActiveIncomeIssuerScope } from './income.guards.js';
import type { IncomeIssuerContextSummary } from './income.types.js';

export type { ActiveIncomeIssuerScope } from './income.guards.js';

export function toIssuerContextSummary(scope: ActiveIncomeIssuerScope): IncomeIssuerContextSummary {
  return {
    acting_mode: scope.acting_mode,
    active_issuer_business_id: scope.issuer_business_id,
    represented_client_id: scope.represented_client_id,
    issuer_label: scope.issuer_label,
    represented_client_label: scope.represented_client_label,
  };
}

export async function loadActiveIncomeIssuerScope(ctx: RequestContext): Promise<ActiveIncomeIssuerScope> {
  const contextAgg = await buildIncomeWorkspaceContextAggregate(ctx);
  return {
    org_id: contextAgg.org_id,
    actor_user_id: contextAgg.actor_user_id,
    acting_mode: contextAgg.acting_mode,
    issuer_business_id: contextAgg.active_issuer_business_id,
    represented_client_id: contextAgg.represented_client_id,
    issuer_label: contextAgg.issuer_label,
    represented_client_label: contextAgg.represented_client_label,
    permissions: contextAgg.permissions,
  };
}

export function assertIncomeEditPermission(scope: ActiveIncomeIssuerScope): void {
  if (!scope.permissions.edit) throw forbidden('income.edit required');
}

export function assertIncomeIssuePermission(scope: ActiveIncomeIssuerScope): void {
  if (!scope.permissions.issue) throw forbidden('income.issue required');
  if (scope.acting_mode === 'office_representative' && !scope.permissions.issue_on_behalf) {
    throw forbidden('income.issue_on_behalf required for office_representative mode');
  }
}
