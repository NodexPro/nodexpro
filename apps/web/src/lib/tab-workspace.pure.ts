/**
 * Per-tab office context. JWT stays origin-wide (Supabase Auth).
 * This record is sessionStorage only and is bound to the current userId.
 * Backend membership remains the source of tenant access.
 */

export const TAB_WORKSPACE_STORAGE_KEY = 'nx.tab.workspace.v1';

export type TabWorkspaceRecord = {
  userId: string;
  organizationId: string;
};

type TabStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function parseTabWorkspaceRecord(raw: string | null | undefined): TabWorkspaceRecord | null {
  if (raw == null || !String(raw).trim()) return null;
  try {
    const parsed = JSON.parse(String(raw)) as {
      userId?: unknown;
      authUserId?: unknown;
      organizationId?: unknown;
    };
    const userId = String(parsed.userId ?? parsed.authUserId ?? '').trim();
    const organizationId = String(parsed.organizationId ?? '').trim();
    if (!userId || !organizationId) return null;
    return { userId, organizationId };
  } catch {
    return null;
  }
}

export const parseTabWorkspace = parseTabWorkspaceRecord;

export function readTabWorkspace(storage: TabStorage | null | undefined): TabWorkspaceRecord | null {
  if (!storage) return null;
  return parseTabWorkspaceRecord(storage.getItem(TAB_WORKSPACE_STORAGE_KEY));
}

export function writeTabWorkspace(
  storage: TabStorage | null | undefined,
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): void {
  if (!storage) return;
  const user = String(userId ?? '').trim();
  const org = String(organizationId ?? '').trim();
  if (!user || !org) {
    storage.removeItem(TAB_WORKSPACE_STORAGE_KEY);
    return;
  }
  storage.setItem(TAB_WORKSPACE_STORAGE_KEY, JSON.stringify({ userId: user, organizationId: org }));
}

export function clearTabWorkspace(storage: TabStorage | null | undefined): void {
  storage?.removeItem(TAB_WORKSPACE_STORAGE_KEY);
}

export function resolveTabWorkingOrganization(input: {
  appUserId: string | null | undefined;
  stored: TabWorkspaceRecord | null | undefined;
  membershipOrgIds: readonly string[] | null | undefined;
  serverActiveOrganizationId: string | null | undefined;
}): string | null {
  const user = String(input.appUserId ?? '').trim();
  const membership = new Set((input.membershipOrgIds ?? []).map((id) => String(id).trim()).filter(Boolean));
  if (user && input.stored?.userId === user) {
    const storedOrg = String(input.stored.organizationId ?? '').trim();
    if (storedOrg && membership.has(storedOrg)) return storedOrg;
  }
  const server = String(input.serverActiveOrganizationId ?? '').trim();
  if (server && membership.has(server)) return server;
  return null;
}

export function resolveTabOrganizationId(input: {
  storedOrganizationId: string | null | undefined;
  organizations: Array<{ id: string }> | null | undefined;
  serverActiveOrganizationId: string | null | undefined;
}): string | null {
  return resolveTabWorkingOrganization({
    appUserId: 'session',
    stored: input.storedOrganizationId
      ? { userId: 'session', organizationId: String(input.storedOrganizationId) }
      : null,
    membershipOrgIds: (input.organizations ?? []).map((org) => org.id),
    serverActiveOrganizationId: input.serverActiveOrganizationId,
  });
}

/**
 * Never transplant permissions/nav from one office onto another office id.
 * The session aggregate is only usable for a tab office when the ids already match.
 */
export function sessionAggregateMatchesWorkingOrganization(
  sessionActiveOrganizationId: string | null | undefined,
  workingOrganizationId: string | null | undefined,
): boolean {
  const working = String(workingOrganizationId ?? '').trim();
  if (!working) return true;
  return String(sessionActiveOrganizationId ?? '').trim() === working;
}

/** Overlay is intentionally a no-op: permissions stay bound to the aggregate org. */
export function overlaySessionActiveOrganization<
  T extends {
    activeOrganizationId: string | null;
    organizations: Array<{ id: string }>;
    permissions?: readonly string[];
  },
>(me: T, workingOrganizationId: string | null | undefined): T {
  void workingOrganizationId;
  return me;
}

export type SessionWorkspaceApplyKind = 'apply_session' | 'mismatch';

export function decideSessionWorkspaceApply(input: {
  sessionActiveOrganizationId: string | null | undefined;
  workingOrganizationId: string | null | undefined;
  membershipOrgIds?: readonly string[] | null;
}): SessionWorkspaceApplyKind {
  const working = String(input.workingOrganizationId ?? '').trim();
  if (!working) return 'apply_session';
  if (String(input.sessionActiveOrganizationId ?? '').trim() === working) return 'apply_session';
  const membership = new Set(
    (input.membershipOrgIds ?? []).map((id) => String(id).trim()).filter(Boolean),
  );
  if (!membership.has(working)) return 'apply_session';
  return 'mismatch';
}

export function simulateTwoTabWorkspaces(input: {
  userId: string;
  tabAOrganizationId: string;
  tabBOrganizationId: string;
}): { tabA: TabWorkspaceRecord; tabB: TabWorkspaceRecord } {
  const tabA = { userId: input.userId, organizationId: input.tabAOrganizationId };
  const tabB = { userId: input.userId, organizationId: input.tabBOrganizationId };
  return { tabA, tabB };
}
