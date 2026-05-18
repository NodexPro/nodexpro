import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { apiJson } from '../api/client';
import { AUTH } from '../api/endpoints';
import { setBackendActiveOrganizationId } from '../api/org-context';
import type { SessionNavItemDto, ShellProfile, SidebarAccountBlockModel, UiLanguageCode } from '../types/session';

export interface MeData {
  user: { id: string; email: string; fullName: string | null; status: string };
  organizations: { id: string; name: string }[];
  activeOrganizationId: string | null;
  permissions: string[];
  enabledModules: string[];
  navItems: { path: string; label: string; order: number }[];
  moduleAppNavItems?: { path: string; label: string }[];
  shell_profile?: ShellProfile;
  default_route?: string;
  visible_nav_items?: SessionNavItemDto[];
  income_onboarding_complete?: boolean;
  sidebar_account_block: SidebarAccountBlockModel;
  session_state?: 'platform_owner' | 'needs_onboarding' | 'needs_org_selection' | 'ready' | 'blocked';
  redirect_to?: string;
  allowed_actions?: string[];
}

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; me: MeData };

const AuthContext = createContext<
  AuthState & {
    setActiveOrg: (id: string) => Promise<void>;
    selectActiveOrg: (id: string) => Promise<MeData | null>;
    setUiLanguage: (languageCode: UiLanguageCode) => Promise<MeData | null>;
    refetchMe: () => Promise<MeData | null>;
    signOut: () => Promise<void>;
  }
  | null
>(null);

function isMeEqual(a: MeData, b: MeData): boolean {
  return (
    a.user.id === b.user.id &&
    a.activeOrganizationId === b.activeOrganizationId &&
    a.organizations.length === b.organizations.length
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const isFetchingMe = useRef(false);
  const inFlightMe = useRef<Promise<MeData | null> | null>(null);

  const refetchMe = useCallback(async (signal?: AbortSignal): Promise<MeData | null> => {
    if (inFlightMe.current && !signal) return inFlightMe.current;
    const run = (async () => {
      isFetchingMe.current = true;
      try {
        const me = await apiJson<MeData>(AUTH.session, signal ? { signal } : undefined);
        if (signal?.aborted) return null;
        setState((prev) => {
          if (prev.status === 'authenticated' && isMeEqual(prev.me, me)) return prev;
          return { status: 'authenticated', me };
        });
        setBackendActiveOrganizationId(me.activeOrganizationId);
        return me;
      } catch (e) {
        if (signal?.aborted) return null;
        setBackendActiveOrganizationId(null);
        setState({ status: 'unauthenticated' });
        return null;
      } finally {
        isFetchingMe.current = false;
      }
    })();
    if (!signal) inFlightMe.current = run;
    const result = await run;
    if (!signal && inFlightMe.current === run) inFlightMe.current = null;
    return result;
  }, []);

  const selectActiveOrg = useCallback(async (organizationId: string) => {
    const me = await apiJson<MeData>(AUTH.selectActiveOrgCommand, {
      method: 'POST',
      body: JSON.stringify({ organization_id: organizationId }),
    });
    setState({ status: 'authenticated', me });
    setBackendActiveOrganizationId(me.activeOrganizationId);
    return me;
  }, []);

  const setActiveOrg = useCallback(async (organizationId: string) => {
    await selectActiveOrg(organizationId);
  }, [selectActiveOrg]);

  const setUiLanguage = useCallback(async (languageCode: UiLanguageCode) => {
    const me = await apiJson<MeData>(AUTH.setUiLanguageCommand, {
      method: 'POST',
      body: JSON.stringify({ language_code: languageCode }),
    });
    setState({ status: 'authenticated', me });
    setBackendActiveOrganizationId(me.activeOrganizationId);
    return me;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiJson(AUTH.logout, { method: 'POST' });
    } finally {
      await supabase.auth.signOut();
      setBackendActiveOrganizationId(null);
      setState({ status: 'unauthenticated' });
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setBackendActiveOrganizationId(null);
        setState({ status: 'unauthenticated' });
        return;
      }
      await refetchMe(ac.signal);
    };
    load();
    return () => ac.abort();
  }, [refetchMe]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_OUT') {
        setBackendActiveOrganizationId(null);
        setState({ status: 'unauthenticated' });
      }
      if (event === 'TOKEN_REFRESHED') {
        // Token refresh should not force a /auth/session refetch.
        // Session aggregate is backend-truth but mostly stable (org list, permissions, enabled modules).
        // Avoids unrelated network traffic during normal app usage (e.g. DocFlow client switching).
        // If backend-truth must be refreshed, do it explicitly via `refetchMe()` in relevant flows.
      }
    });
    return () => subscription.unsubscribe();
  }, [refetchMe]);

  const value = useMemo(
    () =>
      state.status === 'authenticated'
        ? { ...state, setActiveOrg, selectActiveOrg, setUiLanguage, refetchMe, signOut }
        : {
            ...state,
            setActiveOrg: async () => {},
            selectActiveOrg: async () => null,
            setUiLanguage: async () => null,
            refetchMe,
            signOut,
          },
    [state, setActiveOrg, selectActiveOrg, setUiLanguage, refetchMe, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
