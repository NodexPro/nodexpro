import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { apiJson } from '../api/client';
import { AUTH } from '../api/endpoints';
import { setBackendActiveOrganizationId, bumpWorkspaceGeneration } from '../api/org-context';
import {
  canReuseInFlightSession,
  classifyAuthIdentityTransition,
  isStaleRequestGeneration,
  nextRequestGeneration,
  shouldApplyBootstrappedSession,
  shouldDropAuthenticatedUi,
  shouldInvalidateInFlightSession,
  shouldRefetchSessionAfterAuthEvent,
} from '../lib/auth-identity-transition.pure';
import { classifySessionFetchFailure } from '../lib/onboarding-session-route.pure';
import { shouldApplyOfficeSwitchAggregate } from '../lib/org-switch-queue.pure';
import { deviceSignOutOptions } from '../lib/device-session.pure';
import { isStaleWorkspaceError } from '../lib/session-auth-failure.pure';
import {
  clearTabWorkspace,
  decideSessionWorkspaceApply,
  readTabWorkspace,
  writeTabWorkspace,
} from '../lib/tab-workspace.pure';
import type { SessionNavItemDto, ShellProfile, SidebarAccountBlockModel, UiLanguageCode } from '../types/session';

export interface MeData {
  user: { id: string; email: string; fullName: string | null; status: string; email_verified?: boolean };
  account_security?: {
    primary_login_email: string;
    primary_email_verified: boolean;
    additional_login_email: string | null;
    additional_status: string | null;
    additional_pending_email: string | null;
    allowed_actions: string[];
    password_indicator: string;
    password_reveal_forbidden: boolean;
  };
  localization?: {
    country: {
      code: string | null;
      options: Array<{ code: string; label: string }>;
      pack_status: string | null;
      legal_jurisdiction_note: string;
    };
    language: {
      current: string;
      persisted?: boolean;
      options: Array<{ locale: string; name: string; direction?: 'ltr' | 'rtl' }>;
    };
    timezone: { current: string; options: Array<{ value: string; label: string }>; historical_note: string };
    date_format: { current: string; options: Array<{ value: string; label: string }> };
    display_currency: {
      current: string;
      options: Array<{ code: string; label: string; symbol: string }>;
      accounting_base_note: string;
    };
  };
  organizations: { id: string; name: string }[];
  activeOrganizationId: string | null;
  permissions: string[];
  enabledModules: string[];
  navItems: { path: string; label: string; order: number }[];
  moduleAppNavItems?: { path: string; label: string; label_key?: string }[];
  shell_profile?: ShellProfile;
  default_route?: string;
  visible_nav_items?: SessionNavItemDto[];
  available_navigation?: SessionNavItemDto[];
  available_modules?: SessionNavItemDto[];
  available_actions?: string[];
  income_onboarding_complete?: boolean;
  sidebar_account_block: SidebarAccountBlockModel;
  session_state?: 'platform_owner' | 'needs_onboarding' | 'needs_org_selection' | 'ready' | 'blocked' | 'mfa_challenge';
  redirect_to?: string;
  allowed_actions?: string[];
  mfa?: {
    enrollment_state: 'not_enrolled' | 'enrollment_pending' | 'enabled';
    challenge_required: boolean;
    policy_requirement: 'optional' | 'mandatory';
  };
}

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'session_error' }
  | { status: 'authenticated'; me: MeData };

const AuthContext = createContext<
  AuthState & {
    setActiveOrg: (id: string) => Promise<void>;
    selectActiveOrg: (id: string) => Promise<MeData | null>;
    setUiLanguage: (languageCode: UiLanguageCode) => Promise<MeData | null>;
    refetchMe: () => Promise<MeData | null>;
    signOut: () => Promise<void>;
    identityEpoch: number;
  }
  | null
>(null);

function sortedStringArrayKey(values: readonly string[] | null | undefined): string {
  return [...(values ?? [])].sort().join('\0');
}

function isMeEqual(a: MeData, b: MeData): boolean {
  return (
    a.user.id === b.user.id &&
    a.activeOrganizationId === b.activeOrganizationId &&
    a.organizations.length === b.organizations.length &&
    a.session_state === b.session_state &&
    a.mfa?.enrollment_state === b.mfa?.enrollment_state &&
    a.mfa?.challenge_required === b.mfa?.challenge_required &&
    sortedStringArrayKey(a.permissions) === sortedStringArrayKey(b.permissions) &&
    sortedStringArrayKey(a.enabledModules) === sortedStringArrayKey(b.enabledModules) &&
    a.localization?.language?.current === b.localization?.language?.current &&
    a.localization?.language?.persisted === b.localization?.language?.persisted &&
    a.sidebar_account_block?.language_selector?.current_value ===
      b.sidebar_account_block?.language_selector?.current_value
  );
}

function tabStorage(): Storage | null {
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [identityEpoch, setIdentityEpoch] = useState(0);
  const generationRef = useRef(0);
  const authUserIdRef = useRef<string | null>(null);
  const lastWorkspaceRef = useRef<{ userId: string; orgId: string | null } | null>(null);
  const inFlightMe = useRef<{ generation: number; userId: string | null; promise: Promise<MeData | null> } | null>(null);
  const orgSwitchLatestRef = useRef<string | null>(null);
  const orgSwitchInFlightRef = useRef<Promise<MeData | null> | null>(null);

  const bumpGeneration = useCallback(() => {
    generationRef.current = nextRequestGeneration(generationRef.current);
    inFlightMe.current = null;
  }, []);

  const applyAuthenticated = useCallback((me: MeData, authUserId: string | null) => {
    const stored = readTabWorkspace(tabStorage());
    const claimed =
      stored && stored.userId === authUserId ? stored.organizationId : null;
    if (decideSessionWorkspaceApply({
      sessionActiveOrganizationId: me.activeOrganizationId,
      workingOrganizationId: claimed,
      membershipOrgIds: (me.organizations ?? []).map((org) => org.id),
      sessionState: me.session_state,
    }) === 'mismatch') {
      setBackendActiveOrganizationId(claimed);
      return null;
    }
    setBackendActiveOrganizationId(me.activeOrganizationId);
    writeTabWorkspace(tabStorage(), authUserId, me.activeOrganizationId);
    const prevWorkspace = lastWorkspaceRef.current;
    lastWorkspaceRef.current = { userId: me.user.id, orgId: me.activeOrganizationId };
    if (
      !prevWorkspace ||
      prevWorkspace.userId !== me.user.id ||
      prevWorkspace.orgId !== me.activeOrganizationId
    ) {
      setIdentityEpoch((value) => value + 1);
    }
    setState((prev) => {
      if (prev.status === 'authenticated' && isMeEqual(prev.me, me)) return prev;
      return { status: 'authenticated', me };
    });
    return me;
  }, []);

  const dropAuthenticatedWorkspace = useCallback(() => {
    orgSwitchLatestRef.current = null;
    lastWorkspaceRef.current = null;
    bumpGeneration();
    bumpWorkspaceGeneration();
    setBackendActiveOrganizationId(null);
    clearTabWorkspace(tabStorage());
  }, [bumpGeneration]);

  const drainOfficeSwitch = useCallback(async (): Promise<MeData | null> => {
    let lastApplied: MeData | null = null;
    while (orgSwitchLatestRef.current) {
      const target = orgSwitchLatestRef.current;
      const started = generationRef.current;
      try {
        const me = await apiJson<MeData>(AUTH.selectActiveOrgCommand, {
          method: 'POST',
          body: JSON.stringify({ organization_id: target }),
        });
        if (isStaleRequestGeneration(started, generationRef.current)) {
          orgSwitchLatestRef.current = null;
          return null;
        }
        if (!shouldApplyOfficeSwitchAggregate({
          commandOrganizationId: target,
          aggregateOrganizationId: me.activeOrganizationId,
          latestRequestedId: orgSwitchLatestRef.current,
        })) {
          if (orgSwitchLatestRef.current === target) orgSwitchLatestRef.current = null;
          continue;
        }
        writeTabWorkspace(tabStorage(), authUserIdRef.current, me.activeOrganizationId);
        lastApplied = applyAuthenticated(me, authUserIdRef.current);
        if (orgSwitchLatestRef.current === target) orgSwitchLatestRef.current = null;
      } catch (error) {
        if (isStaleWorkspaceError(error) || isStaleRequestGeneration(started, generationRef.current)) {
          orgSwitchLatestRef.current = null;
          return lastApplied;
        }
        if (orgSwitchLatestRef.current !== target) continue;
        throw error;
      }
    }
    return lastApplied;
  }, [applyAuthenticated]);

  const selectActiveOrg = useCallback(async (organizationId: string): Promise<MeData | null> => {
    const org = String(organizationId ?? '').trim();
    if (!org) return null;
    orgSwitchLatestRef.current = org;
    if (!orgSwitchInFlightRef.current) {
      const run = drainOfficeSwitch().finally(() => {
        if (orgSwitchInFlightRef.current === run) orgSwitchInFlightRef.current = null;
      });
      orgSwitchInFlightRef.current = run;
    }
    const me = await orgSwitchInFlightRef.current;
    if (orgSwitchLatestRef.current && orgSwitchLatestRef.current !== me?.activeOrganizationId) {
      return selectActiveOrg(orgSwitchLatestRef.current);
    }
    return me;
  }, [drainOfficeSwitch]);

  const refetchMe = useCallback(async (signal?: AbortSignal): Promise<MeData | null> => {
    const started = generationRef.current;
    const startedUserId = authUserIdRef.current;
    if (
      !signal
      && inFlightMe.current
      && canReuseInFlightSession({
        inFlightGeneration: inFlightMe.current.generation,
        currentGeneration: started,
        inFlightAuthUserId: inFlightMe.current.userId,
        currentAuthUserId: startedUserId,
      })
    ) {
      return inFlightMe.current.promise;
    }
    setState((prev) => (prev.status === 'session_error' ? { status: 'loading' } : prev));
    const run = (async () => {
      try {
        const stored = readTabWorkspace(tabStorage());
        if (stored && stored.userId === authUserIdRef.current) {
          setBackendActiveOrganizationId(stored.organizationId);
        }
        const me = await apiJson<MeData>(AUTH.session, signal ? { signal } : undefined);
        if (
          signal?.aborted
          || isStaleRequestGeneration(started, generationRef.current)
          || startedUserId !== authUserIdRef.current
        ) {
          return null;
        }
        const applied = applyAuthenticated(me, authUserIdRef.current);
        if (!applied) {
          setState((prev) => (prev.status === 'authenticated' ? prev : { status: 'session_error' }));
        }
        return applied;
      } catch (e) {
        if (
          signal?.aborted
          || isStaleRequestGeneration(started, generationRef.current)
          || startedUserId !== authUserIdRef.current
        ) {
          return null;
        }
        const outcome = classifySessionFetchFailure(e);
        if (outcome === 'ignore') return null;
        if (outcome === 'clear_auth') {
          dropAuthenticatedWorkspace();
          setState({ status: 'unauthenticated' });
          try {
            await supabase.auth.signOut(deviceSignOutOptions());
          } catch {
            // best-effort local clear
          }
          return null;
        }
        setState({ status: 'session_error' });
        return null;
      }
    })();
    if (!signal) inFlightMe.current = { generation: started, userId: startedUserId, promise: run };
    const result = await run;
    if (!signal && inFlightMe.current?.promise === run) inFlightMe.current = null;
    return result;
  }, [applyAuthenticated, dropAuthenticatedWorkspace]);

  const setActiveOrg = useCallback(async (organizationId: string) => {
    await selectActiveOrg(organizationId);
  }, [selectActiveOrg]);

  const setUiLanguage = useCallback(async (languageCode: UiLanguageCode) => {
    const started = generationRef.current;
    try {
      const me = await apiJson<MeData>(AUTH.setUiLanguageCommand, {
        method: 'POST',
        body: JSON.stringify({ language_code: languageCode }),
      });
      if (isStaleRequestGeneration(started, generationRef.current)) return null;
      return applyAuthenticated(me, authUserIdRef.current);
    } catch (error) {
      if (isStaleWorkspaceError(error)) return null;
      throw error;
    }
  }, [applyAuthenticated]);

  const signOut = useCallback(async () => {
    try {
      await apiJson(AUTH.logout, { method: 'POST' });
    } finally {
      authUserIdRef.current = null;
      dropAuthenticatedWorkspace();
      await supabase.auth.signOut(deviceSignOutOptions());
      setState({ status: 'unauthenticated' });
    }
  }, [dropAuthenticatedWorkspace]);

  useEffect(() => {
    const ac = new AbortController();
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      const bootAuthUserId = data.session?.user.id ?? null;
      if (!shouldApplyBootstrappedSession({
        bootAuthUserId,
        currentAuthUserId: authUserIdRef.current,
      })) {
        return;
      }
      authUserIdRef.current = bootAuthUserId;
      if (!bootAuthUserId) {
        dropAuthenticatedWorkspace();
        setState({ status: 'unauthenticated' });
        return;
      }
      await refetchMe(ac.signal);
    };
    load();
    return () => ac.abort();
  }, [dropAuthenticatedWorkspace, refetchMe]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const nextAuthUserId = session?.user.id ?? null;
      const transition = classifyAuthIdentityTransition({
        event,
        previousAuthUserId: authUserIdRef.current,
        nextAuthUserId,
      });
      if (shouldDropAuthenticatedUi(transition)) {
        authUserIdRef.current = nextAuthUserId;
        dropAuthenticatedWorkspace();
        if (transition === 'signed_out') {
          setState({ status: 'unauthenticated' });
          return;
        }
        setState({ status: 'loading' });
      } else {
        authUserIdRef.current = nextAuthUserId;
        if (shouldInvalidateInFlightSession(transition)) {
          bumpGeneration();
          bumpWorkspaceGeneration();
        }
      }
      // TOKEN_REFRESHED for the same user keeps UI; identity mismatch drops and refetches.
      if (shouldRefetchSessionAfterAuthEvent(transition) && nextAuthUserId) {
        await refetchMe();
      }
    });
    return () => subscription.unsubscribe();
  }, [bumpGeneration, dropAuthenticatedWorkspace, refetchMe]);

  const value = useMemo(
    () =>
      state.status === 'authenticated'
        ? { ...state, setActiveOrg, selectActiveOrg, setUiLanguage, refetchMe, signOut, identityEpoch }
        : {
            ...state,
            setActiveOrg: async () => {},
            selectActiveOrg: async () => null,
            setUiLanguage: async () => null,
            refetchMe,
            signOut,
            identityEpoch,
          },
    [state, setActiveOrg, selectActiveOrg, setUiLanguage, refetchMe, signOut, identityEpoch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
