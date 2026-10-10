/**
 * Session sidebar account block — pure projection (backend-owned presentation).
 *
 * The web renders exactly what is returned here; it never decides which sidebar controls exist for
 * which kind of user:
 *  - language selector is hidden for now (`visible: false`); the capability and stored data are untouched,
 *  - the sign-out control is not shown to employees (`worker` shell) — authentication/logout stays available,
 *  - employees get the office context block and the workspace greeting,
 *  - Owner / Admin keep the existing office identity behaviour.
 *
 * Office / greeting text language follows the organization's canonical country (same rule as Users & Roles),
 * with TEMPORARY_COUNTRY_PACK_PENDING until the Country Pack owns presentation locale.
 */

import type { ShellProfile, SidebarAccountBlockModel, UiLanguageCode } from '../../types/api.js';
import { resolveUsersRolesPresentation } from '../memberships/users-roles-locale.pure.js';

export type SidebarAccountBlockInput = {
  user: { email: string; fullName: string | null };
  organizations: Array<{ id: string; name: string }>;
  activeOrganizationId: string | null;
  shellProfile: ShellProfile;
  uiLanguage: UiLanguageCode;
  /** organizations.country_code of the ACTIVE organization (null when unknown). */
  activeOrganizationCountryCode: string | null;
};

/** First whitespace-separated token of the authenticated user's full name. Presentation only. */
export function resolveEmployeeFirstName(fullName: string | null | undefined): string | null {
  const first = String(fullName ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];
  return first ? first : null;
}

export function workspaceGreetingFor(firstName: string, locale: 'en' | 'he'): string {
  return locale === 'he' ? `היי, ${firstName}` : `Hi, ${firstName}`;
}

export function officeContextLabelFor(locale: 'en' | 'he'): string {
  return locale === 'he' ? 'משרד' : 'Office';
}

export function buildSidebarAccountBlock(input: SidebarAccountBlockInput): SidebarAccountBlockModel {
  const { user, organizations, activeOrganizationId, shellProfile, uiLanguage } = input;
  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) ?? null;
  const organizationName = activeOrg?.name ?? (organizations.length === 1 ? (organizations[0]?.name ?? null) : null);
  const displayName = (user.fullName?.trim() || user.email || '').trim();
  const labels =
    uiLanguage === 'he'
      ? { org: 'ארגון', language: 'שפה', logout: 'התנתקות', en: 'English', he: 'עברית' }
      : { org: 'Organization', language: 'Language', logout: 'Sign out', en: 'English', he: 'עברית' };

  const isEmployee = shellProfile === 'worker';
  const presentation = resolveUsersRolesPresentation(input.activeOrganizationCountryCode);
  const firstName = isEmployee ? resolveEmployeeFirstName(user.fullName) : null;

  return {
    organization_name: organizationName,
    user_display_name: displayName,
    user_email: user.email,
    organization_switcher: {
      visible: organizations.length > 1,
      label: labels.org,
      organizations: organizations.map((o) => ({
        organization_id: o.id,
        name: o.name,
        selected: o.id === activeOrganizationId,
      })),
    },
    language_selector: {
      // Hidden for now. Capability (command + stored language) is intentionally kept.
      visible: false,
      label: labels.language,
      current_value: uiLanguage,
      options: [
        { value: 'en', label: labels.en },
        { value: 'he', label: labels.he },
      ],
    },
    logout_action: {
      visible: !isEmployee,
      label: labels.logout,
      command_key: 'logout',
    },
    office_context: {
      visible: isEmployee && Boolean(organizationName),
      label: officeContextLabelFor(presentation.locale),
      name: organizationName,
    },
    workspace_greeting:
      firstName !== null
        ? { text: workspaceGreetingFor(firstName, presentation.locale), direction: presentation.direction }
        : null,
  };
}
