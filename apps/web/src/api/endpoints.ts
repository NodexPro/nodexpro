// Paths only. No logic.

export const AUTH = {
  register: '/auth/register',
  login: '/auth/login',
  logout: '/auth/logout',
  me: '/auth/me',
  session: '/auth/session',
  setActiveOrg: '/auth/me/active-organization',
  selectActiveOrgCommand: '/auth/commands/select_active_organization',
} as const;

/** Single aggregated payload for dashboard; requires X-Organization-Id. */
export const dashboardSummary = () => '/dashboard/summary';

/** Rich aggregated payload for dashboard UI; requires X-Organization-Id. */
export const dashboardOverview = () => '/dashboard/overview';

export const ORGS = '/organizations';
export const org = (id: string) => `/organizations/${id}`;
export const orgMembers = (id: string) => `/organizations/${id}/members`;
export const orgMembersInvite = (id: string) => `/organizations/${id}/members/invite`;
export const orgInvites = (id: string) => `/organizations/${id}/invites`;
export const orgInviteResend = (orgId: string, inviteId: string) => `/organizations/${orgId}/invites/${inviteId}/resend`;
export const orgInviteRevoke = (orgId: string, inviteId: string) => `/organizations/${orgId}/invites/${inviteId}/revoke`;
export const orgMember = (orgId: string, memberId: string) => `/organizations/${orgId}/members/${memberId}`;
export const orgMemberRole = (orgId: string, memberId: string) => `/organizations/${orgId}/members/${memberId}/role`;
export const inviteAccept = () => `/auth/invite/accept`;
export const orgRoles = (id: string) => `/organizations/${id}/roles`;
export const orgModules = (id: string) => `/modules/${id}/modules`;
export const orgModulesState = (id: string) => `/modules/${id}/modules/state`;
export const orgModuleActivate = (orgId: string, moduleId: string) => `/modules/${orgId}/modules/${moduleId}/activate`;
export const orgModuleDeactivate = (orgId: string, moduleId: string) => `/modules/${orgId}/modules/${moduleId}/deactivate`;
export const orgModuleSelectPlan = (orgId: string, moduleId: string) => `/modules/${orgId}/modules/${moduleId}/select-plan`;
export const orgModuleChangePlan = (orgId: string, moduleId: string) => `/modules/${orgId}/modules/${moduleId}/change-plan`;
export const orgSubscription = (id: string) => `/organizations/${id}/subscription`;
export const orgTrial = (id: string) => `/organizations/${id}/trial`;
export const orgLegalIdentity = (id: string) => `/organizations/${id}/legal-identity`;
export const orgOwnerIdentity = (id: string) => `/organizations/${id}/owner-identity`;
export const orgCompanyLegalIdentity = (id: string) => `/organizations/${id}/settings/company/legal-identity`;
export const orgSettings = (id: string) => `/organizations/${id}/settings`;
export const orgCountrySettings = (id: string) => `/organizations/${id}/country-settings`;
export const orgSettingsFileOpen = (orgId: string, fileAssetId: string) =>
  `/organizations/${orgId}/settings/files/${fileAssetId}/open`;
/** Canonical secure file open (settings logo/signature; future: documents). Returns { url, expiresIn }. */
export const orgFileOpen = (orgId: string, fileAssetId: string) =>
  `/organizations/${orgId}/files/${fileAssetId}/open`;
export const orgAudit = (id: string) => `/organizations/${id}/audit`;

export const orgClients = (orgId: string) => `/organizations/${orgId}/clients`;
export const orgClientsSearch = (orgId: string) => `/organizations/${orgId}/clients/search`;
export const orgClientsImportPreview = (orgId: string) => `/organizations/${orgId}/clients/import/preview`;
export const orgClientsImport = (orgId: string) => `/organizations/${orgId}/clients/import`;
export const orgClientsExport = (orgId: string) => `/organizations/${orgId}/clients/export`;
export const orgClientsBulkMarkActive = (orgId: string) => `/organizations/${orgId}/clients/bulk/mark-active`;
export const orgClientsBulkMarkInactive = (orgId: string) => `/organizations/${orgId}/clients/bulk/mark-inactive`;
export const orgClientsBulkArchive = (orgId: string) => `/organizations/${orgId}/clients/bulk/archive`;
export const orgClientsBulkRestore = (orgId: string) => `/organizations/${orgId}/clients/bulk/restore`;
export const orgClientsBulkExport = (orgId: string) => `/organizations/${orgId}/clients/bulk/export`;
export const orgClient = (orgId: string, clientId: string) => `/organizations/${orgId}/clients/${clientId}`;
export const orgClientFull = (orgId: string, clientId: string) => `/organizations/${orgId}/clients/${clientId}/full`;
export const orgClientContacts = (orgId: string, clientId: string) => `/organizations/${orgId}/clients/${clientId}/contacts`;
export const orgClientContact = (orgId: string, clientId: string, contactId: string) =>
  `/organizations/${orgId}/clients/${clientId}/contacts/${contactId}`;
export const orgClientNotes = (orgId: string, clientId: string) => `/organizations/${orgId}/clients/${clientId}/notes`;
export const orgClientNote = (orgId: string, clientId: string, noteId: string) => `/organizations/${orgId}/clients/${clientId}/notes/${noteId}`;
export const orgClientRestore = (orgId: string, clientId: string) => `/organizations/${orgId}/clients/${clientId}/restore`;
export const orgClientTags = (orgId: string, clientId: string) => `/organizations/${orgId}/clients/${clientId}/tags`;
export const orgClientTimeline = (orgId: string, clientId: string) => `/organizations/${orgId}/clients/${clientId}/timeline`;
export const orgClientFiles = (orgId: string, clientId: string) => `/organizations/${orgId}/clients/${clientId}/files`;
export const orgClientFileOpen = (orgId: string, clientId: string, fileAssetId: string) =>
  `/organizations/${orgId}/clients/${clientId}/files/${fileAssetId}/open`;
export const orgClientFileRemove = (orgId: string, clientId: string, fileAssetId: string) =>
  `/organizations/${orgId}/clients/${clientId}/files/${fileAssetId}`;
export const orgTags = (orgId: string) => `/organizations/${orgId}/tags`;

export const orgDocuments = (orgId: string) => `/organizations/${orgId}/documents`;
export const orgDocumentsForClient = (orgId: string, clientId: string) => `/organizations/${orgId}/documents?linkedToClientId=${clientId}`;
export const orgDocumentsUpload = (orgId: string) => `/organizations/${orgId}/documents/upload`;
export const orgDocument = (orgId: string, documentId: string) => `/organizations/${orgId}/documents/${documentId}`;
export const orgDocumentFull = (orgId: string, documentId: string) => `/organizations/${orgId}/documents/${documentId}?full=true`;
export const orgDocumentVersions = (orgId: string, documentId: string) => `/organizations/${orgId}/documents/${documentId}/versions`;
export const orgDocumentOpen = (orgId: string, documentId: string) => `/organizations/${orgId}/documents/${documentId}/open`;
export const orgDocumentLinks = (orgId: string, documentId: string) => `/organizations/${orgId}/documents/${documentId}/links`;
export const orgDocumentActivity = (orgId: string, documentId: string) => `/organizations/${orgId}/documents/${documentId}/activity`;

export const MODULES = '/modules';

// Module 1: client-operations
export const moduleClientOperationsRegistry = () => '/m/client-operations/registry';
/** GET אגרגט תיק; `fees_price_chart_view=all` — גרף מחירים מלא (ברירת מחדל בשרת: last_15) */
export function moduleClientOperationsCase(
  clientId: string,
  opts?: { fees_price_chart_view?: 'last_15' | 'all' }
): string {
  const base = `/m/client-operations/clients/${clientId}`;
  if (opts?.fees_price_chart_view === 'all') return `${base}?fees_price_chart_view=all`;
  return base;
}
export const moduleClientOperationsUpdateClientProfile = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/profile/commands/update_profile`;
export const moduleClientOperationsFeesCommands = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/fees/commands`;
export const moduleClientOperationsPayrollCommands = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/payroll/commands`;
export const moduleClientOperationsAnnualCommands = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/annual/commands`;
export const moduleClientOperationsAnnualUpload = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/annual/upload`;
export const moduleClientOperationsAnnualFileOpen = (clientId: string, fileAssetId: string) =>
  `/m/client-operations/clients/${clientId}/annual/files/${fileAssetId}/open`;

export const moduleClientOperationsDocumentsCommands = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/documents/commands`;
export const moduleClientOperationsObligationsCommands = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/obligations/commands`;
export const moduleClientOperationsDocumentsUpload = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/documents/upload`;
export const moduleClientOperationsDocumentsFileOpen = (clientId: string, fileAssetId: string) =>
  `/m/client-operations/clients/${clientId}/documents/files/${fileAssetId}/open`;
export const moduleClientOperationsHistoryCommands = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/history/commands`;
export const moduleClientOperationsHistoryExport = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/history/export`;
export const moduleClientOperationsNoteTypes = () => '/m/client-operations/note-types';
export const moduleClientOperationsOperationalNotes = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/operational-notes`;
export const moduleClientOperationsOperationalNote = (clientId: string, noteId: string) =>
  `/m/client-operations/clients/${clientId}/operational-notes/${noteId}/commands/update_note`;
export const moduleClientOperationsRemindersDue = () => '/m/client-operations/reminders/due';
export const moduleClientOperationsTaxSettings = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/tax-settings`;
export const moduleClientOperationsTaxSettingsCommandUpdate = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/tax-settings/commands/update_tax_settings`;
/** POST { type: TaxTabCommandType, payload, fees_price_chart_view? } → full ClientOperationsCaseResponse */
export const moduleClientOperationsTaxCommands = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/tax/commands`;
/** POST { type, secret_kind: card_number|expiry } — requires active SMS-verified session */
export const moduleClientOperationsTaxSettingsRevealPaymentSecret = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/tax-settings/reveal-payment-secret`;
export const moduleClientOperationsTaxSettingsPaymentCardRequestCode = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/tax-settings/payment-card/request-code`;
export const moduleClientOperationsTaxSettingsPaymentCardVerifyCode = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/tax-settings/payment-card/verify-code`;

/** POST { type: save_accounting_*_block | save_accounting_business_profile | *_vehicle_fleet_* | *_expense_management_custom_field, payload, fees_price_chart_view? } → full ClientOperationsCaseResponse */
export const moduleClientOperationsAccountingCommands = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting/commands`;

export const moduleClientOperationsAccountingGeneral = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting/general/commands/update_accounting_general`;
export const moduleClientOperationsAccountingVehicles = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting/vehicles/commands/replace_accounting_vehicles`;

export const moduleClientOperationsAccountingBusinessProfile = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting/business-profile/commands/save_business_profile`;

export const moduleClientOperationsAccountingSettingsTab = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/tab`;
export const moduleClientOperationsAccountingSettingsBlockModal = (clientId: string, blockKey: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/blocks/${blockKey}/modal`;
export const moduleClientOperationsAccountingSettingsBlockSave = (clientId: string, blockKey: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/blocks/${blockKey}/commands/save_block`;
export const moduleClientOperationsAccountingSettingsBlockNormalizeDraft = (clientId: string, blockKey: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/blocks/${blockKey}/normalize-draft`;
export const moduleClientOperationsAccountingSettingsModalVisibility = (clientId: string, blockKey: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/blocks/${blockKey}/modal-visibility`;

export const moduleClientOperationsAccountingSettingsExpenseMgmtCustomFields = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/blocks/expense_management/custom-fields`;

export const moduleClientOperationsAccountingSettingsExpenseMgmtCustomField = (clientId: string, fieldId: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/blocks/expense_management/custom-fields/${fieldId}`;

/** POST body: file upload fields; response includes file ids + `client_operations_case` (full workspace aggregate). Query: fees_price_chart_view */
export const moduleClientOperationsAccountingVehicleFleetUpload = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/vehicle-fleet/upload`;

export const moduleClientOperationsAccountingVehicleFleetFileOpen = (clientId: string, fileAssetId: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/vehicle-fleet/files/${fileAssetId}/open`;

export const moduleClientOperationsVehicleFleetItemModal = (clientId: string, vehicleId?: string | null) => {
  const q = vehicleId ? `?vehicle_id=${encodeURIComponent(vehicleId)}` : '';
  return `/m/client-operations/clients/${clientId}/accounting-settings/vehicle-fleet/item-modal${q}`;
};

export const moduleClientOperationsVehicleFleetItemModalVisibility = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/vehicle-fleet/item-modal-visibility`;

export const moduleClientOperationsVehicleFleetItems = (clientId: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/vehicle-fleet/items`;

export const moduleClientOperationsVehicleFleetItem = (clientId: string, vehicleId: string) =>
  `/m/client-operations/clients/${clientId}/accounting-settings/vehicle-fleet/items/${vehicleId}/commands/update_vehicle_fleet_item`;

// DocFlow (office/client aggregates + commands)
export const docflowClientTabAggregate = (clientId: string, selectedThreadId?: string | null) =>
  `/docflow/aggregates/client-tab?client_id=${encodeURIComponent(clientId)}${
    selectedThreadId ? `&selected_thread_id=${encodeURIComponent(selectedThreadId)}` : ''
  }`;
export const docflowOfficeCommands = '/docflow/commands';
export const docflowIssueInviteDeliveryCommand = '/docflow/commands/issue-invite-delivery';
export const docflowOfficeUploadFile = '/docflow/files/upload';
/** Office review UI: single aggregate for a communication rule run (Phase 11.2). */
export const docflowCommunicationRuleRunReviewAggregate = (ruleRunId: string) =>
  `/docflow/aggregates/communication-rule-run-review?rule_run_id=${encodeURIComponent(ruleRunId)}`;
export const docflowInvitesManagementAggregate = (params?: {
  page?: number;
  pageSize?: number;
  searchClient?: string;
  inviteStatus?: string;
}) => {
  const qs = new URLSearchParams();
  if (params?.page) qs.set('page', String(params.page));
  if (params?.pageSize) qs.set('page_size', String(params.pageSize));
  if (params?.searchClient) qs.set('search_client', params.searchClient);
  if (params?.inviteStatus) qs.set('invite_status', params.inviteStatus);
  const suffix = qs.toString();
  return `/docflow/aggregates/invites-management${suffix ? `?${suffix}` : ''}`;
};

/** Floating widget: auth + org only (trial-expired orgs get locked aggregate). */
export const docflowFloatingWidgetAggregate = '/docflow/aggregates/floating-widget';

/** Client DocFlow portal (no office org header; session via `X-Client-Portal-Session`). */
export const docflowPortalAcceptInvitation = '/docflow/portal/commands/accept-invitation';
export const docflowPortalInboxAggregate = (selectedThreadId?: string | null) =>
  `/docflow/portal/aggregates/client-portal-inbox${
    selectedThreadId ? `?selected_thread_id=${encodeURIComponent(selectedThreadId)}` : ''
  }`;
export const docflowPortalSendClientMessage = '/docflow/portal/commands/send-client-message';
export const docflowPortalAttachFileToClientMessage = '/docflow/portal/commands/attach-file-to-client-message';
export const docflowPortalRemoveMessageAttachment = '/docflow/portal/commands/remove-message-attachment';
export const docflowPortalMarkThreadReadByClient = '/docflow/portal/commands/mark-thread-read-by-client';
export const docflowPortalFileOpen = (fileAssetId: string) =>
  `/docflow/portal/files/${encodeURIComponent(fileAssetId)}/open`;

// Platform owner Country Pack API (owner-only, not tenant workspace)
export const OWNER = {
  /** Backend read model: current session may access platform-owner APIs */
  session: '/owner/session',
  passwordRecoveryRequest: '/owner/password-recovery/request',
  passwordRecoveryVerify: '/owner/password-recovery/verify',
  passwordRecoveryComplete: '/owner/password-recovery/complete',
  /** Single aggregate for Platform Owner Legal Control screen */
  legalControl: '/owner/legal-control',
  countryPacks: '/owner/country-packs',
  legalValues: '/owner/legal-values',
  pricing: '/owner/pricing',
  emailProviderConfig: () => '/owner/email-provider-config',
  command: '/owner/command',
  countrySettings: (organizationId: string) => `/owner/country-settings/${organizationId}`,
  countryDiagnostics: (organizationId: string) => `/owner/country-diagnostics/${organizationId}`,
  activeRulesetContext: (organizationId: string, date?: string) =>
    `/owner/active-ruleset-context/${organizationId}${date ? `?date=${encodeURIComponent(date)}` : ''}`,
} as const;
