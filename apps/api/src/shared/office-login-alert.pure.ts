export function canDiscloseOfficeIncident(input: {
  incidentOrganizationId: string | null;
  viewerOrganizationId: string | null;
}): boolean {
  return Boolean(
    input.incidentOrganizationId
    && input.viewerOrganizationId
    && input.incidentOrganizationId === input.viewerOrganizationId,
  );
}

export function officeAlertRecipients(ownerEmails: string[]): string[] {
  return [...new Set(ownerEmails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
}

export function officeAlertDedupeKey(organizationId: string, actorKey: string): string {
  return `alert:login-office:${organizationId}:${actorKey}:incident`;
}
