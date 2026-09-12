export const OWNER_COUNTRY_LEGAL_CAPABILITIES = [
  'legal_knowledge.view',
  'legal_knowledge.draft_create',
  'legal_knowledge.draft_edit',
  'legal_knowledge.review',
  'legal_sources.manage',
  'legal_values.manage',
  'fact_dictionary.manage',
  'legal_knowledge.activate',
] as const;

export type OwnerCountryLegalCapability = (typeof OWNER_COUNTRY_LEGAL_CAPABILITIES)[number];

export const OWNER_COUNTRY_LEGAL_ACCESS_COMMANDS = [
  'request_country_legal_access',
  'invite_country_legal_maintainer',
  'approve_country_legal_access_request',
  'reject_country_legal_access_request',
  'grant_country_legal_assignment',
  'update_country_legal_assignment_permissions',
  'suspend_country_legal_assignment',
  'revoke_country_legal_assignment',
] as const;

export type OwnerCountryLegalAccessCommandName = (typeof OWNER_COUNTRY_LEGAL_ACCESS_COMMANDS)[number];

export const OWNER_COUNTRY_LEGAL_ACCESS_ADMIN_COMMANDS = OWNER_COUNTRY_LEGAL_ACCESS_COMMANDS.filter(
  (command) => command !== 'request_country_legal_access',
);

export const OWNER_COUNTRY_LEGAL_ACCESS_AGGREGATE_KEY = 'owner_country_legal_access_aggregate' as const;

export const OWNER_LEGAL_ACTOR_KINDS = ['platform_owner', 'country_legal_maintainer'] as const;
export type OwnerLegalActorKind = (typeof OWNER_LEGAL_ACTOR_KINDS)[number];

export type OwnerLegalAssignmentStatus = 'active' | 'suspended' | 'revoked';
export type OwnerLegalAccessRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export function isOwnerCountryLegalCapability(value: string): value is OwnerCountryLegalCapability {
  return (OWNER_COUNTRY_LEGAL_CAPABILITIES as readonly string[]).includes(value);
}

export function isOwnerCountryLegalAccessCommand(command: string): command is OwnerCountryLegalAccessCommandName {
  return (OWNER_COUNTRY_LEGAL_ACCESS_COMMANDS as readonly string[]).includes(command);
}

export function isOwnerCountryLegalAccessAdminCommand(command: string): boolean {
  return (OWNER_COUNTRY_LEGAL_ACCESS_ADMIN_COMMANDS as readonly string[]).includes(command);
}

export const OWNER_COUNTRY_LEGAL_CAPABILITY_LABELS: Record<OwnerCountryLegalCapability, string> = {
  'legal_knowledge.view': 'View knowledge',
  'legal_knowledge.draft_create': 'Create drafts',
  'legal_knowledge.draft_edit': 'Edit drafts',
  'legal_knowledge.review': 'Review',
  'legal_sources.manage': 'Manage legal sources',
  'legal_values.manage': 'Manage legal values',
  'fact_dictionary.manage': 'Manage client facts',
  'legal_knowledge.activate': 'Activate/Publish',
};

export const OWNER_COUNTRY_LEGAL_VALUE_COMMANDS = [
  'create_legal_value',
  'author_country_legal_value',
  'update_legal_value_metadata',
  'create_legal_value_version',
  'update_legal_value_version',
  'activate_legal_value_version',
  'deactivate_legal_value_version',
  'pin_legal_value_version_authority',
  'unpin_legal_value_version_authority',
  'update_owner_note',
  'update_usage_hint',
] as const;

export type OwnerCountryLegalValueCommandName = (typeof OWNER_COUNTRY_LEGAL_VALUE_COMMANDS)[number];

export function isOwnerLegalValueCommand(command: string): command is OwnerCountryLegalValueCommandName {
  return (OWNER_COUNTRY_LEGAL_VALUE_COMMANDS as readonly string[]).includes(command);
}

export const OWNER_LEGAL_ACCESS_ERROR_CODES = {
  ACCESS_REQUIRED: 'OWNER_LEGAL_ACCESS_REQUIRED',
  COUNTRY_FORBIDDEN: 'OWNER_LEGAL_COUNTRY_FORBIDDEN',
  COUNTRY_MISMATCH: 'OWNER_LEGAL_COUNTRY_MISMATCH',
  COUNTRY_REQUIRED: 'OWNER_LEGAL_COUNTRY_REQUIRED',
  CAPABILITY_REQUIRED: 'OWNER_LEGAL_CAPABILITY_REQUIRED',
  ACTIVATE_REQUIRED: 'OWNER_LEGAL_ACTIVATE_REQUIRED',
} as const;

export type OwnerLegalActorSnapshot = {
  kind: 'none' | OwnerLegalActorKind;
  email: string;
  capabilitiesByCountry: Record<string, string[]>;
};
