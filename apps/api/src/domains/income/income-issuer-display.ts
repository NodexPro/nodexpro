import type { IncomeActingMode } from './income.types.js';

interface OrgIssuerProfileRow {
  display_name: string;
  legal_name: string | null;
}

interface ClientIssuerRow {
  display_name: string;
  legal_name: string | null;
}

export function resolveIncomeIssuerBusinessDisplay(input: {
  acting_mode: IncomeActingMode;
  orgIssuerProfile: OrgIssuerProfileRow | null;
  client: ClientIssuerRow | null;
}): string {
  if (input.acting_mode === 'self') {
    const profile = input.orgIssuerProfile;
    if (!profile) return 'Office';
    return profile.legal_name?.trim() || profile.display_name?.trim() || 'Office';
  }
  const client = input.client;
  if (!client) return 'Client';
  return client.legal_name?.trim() || client.display_name?.trim() || 'Client';
}
