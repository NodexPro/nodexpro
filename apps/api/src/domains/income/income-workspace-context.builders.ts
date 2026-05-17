import type {
  IncomeIssuerOption,
  IncomeWorkspaceContextAggregate,
  IncomeWorkspacePermissions,
} from './income.types.js';
import { resolveIncomeIssuerBusinessDisplay } from './income-issuer-display.js';

interface OrgIssuerProfileRow {
  id: string;
  display_name: string;
  legal_name: string | null;
}

interface ClientIssuerRow {
  id: string;
  display_name: string;
  legal_name: string | null;
}

export function buildAllowedActingModes(
  perms: IncomeWorkspacePermissions,
): IncomeWorkspaceContextAggregate['allowed_acting_modes'] {
  return [
    {
      mode: 'self',
      label: 'Office (self)',
      enabled: perms.view,
      reason: perms.view ? null : 'income.view required',
    },
    {
      mode: 'office_representative',
      label: 'On behalf of client',
      enabled: perms.issue_on_behalf && perms.view,
      reason: !perms.view
        ? 'income.view required'
        : !perms.issue_on_behalf
          ? 'income.issue_on_behalf required'
          : null,
    },
  ];
}

export function buildIssuerOptions(
  orgIssuer: OrgIssuerProfileRow,
  clients: ClientIssuerRow[],
  perms: IncomeWorkspacePermissions,
): IncomeIssuerOption[] {
  const options: IncomeIssuerOption[] = [];
  if (perms.view) {
    options.push({
      issuer_business_id: orgIssuer.id,
      acting_mode: 'self',
      label: resolveIncomeIssuerBusinessDisplay({
        acting_mode: 'self',
        orgIssuerProfile: orgIssuer,
        client: null,
      }),
      represented_client_id: null,
    });
  }
  if (perms.issue_on_behalf) {
    for (const client of clients) {
      options.push({
        issuer_business_id: client.id,
        acting_mode: 'office_representative',
        label: resolveIncomeIssuerBusinessDisplay({
          acting_mode: 'office_representative',
          orgIssuerProfile: null,
          client,
        }),
        represented_client_id: client.id,
      });
    }
  }
  return options;
}

export function buildAllowedActions(perms: IncomeWorkspacePermissions): string[] {
  const actions: string[] = [];
  if (perms.view) actions.push('view_workspace_context');
  if (perms.edit) actions.push('select_issuer_context');
  return actions;
}
