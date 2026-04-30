import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { apiJson } from '../api/client';
import { AUTH } from '../api/endpoints';

export interface MeData {
  user: { id: string; email: string; fullName: string | null; status: string };
  organizations: { id: string; name: string }[];
  activeOrganizationId: string | null;
  permissions: string[];
  enabledModules: string[];
  navItems: { path: string; label: string; order: number }[];
  moduleAppNavItems?: { path: string; label: string }[];
}

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; me: MeData };

const AuthContext = createContext<AuthState & { setActiveOrg: (id: string) => Promise<void>; refetchMe: () => Promise<MeData | null>; signOut: () => Promise<void> } | null>(null);

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

  const refetchMe = useCallback(async (signal?: AbortSignal): Promise<MeData | null> => {
    if (isFetchingMe.current && !signal) return null;
    isFetchingMe.current = true;
    try {
      const me = await apiJson<MeData>(AUTH.me, signal ? { signal } : undefined);
      if (signal?.aborted) return null;
      setState((prev) => {
        if (prev.status === 'authenticated' && isMeEqual(prev.me, me)) return prev;
        return { status: 'authenticated', me };
      });
      if (me.activeOrganizationId) sessionStorage.setItem('activeOrganizationId', me.activeOrganizationId);
      return me;
    } catch (e) {
      if (signal?.aborted) return null;
      setState({ status: 'unauthenticated' });
      return null;
    } finally {
      isFetchingMe.current = false;
    }
  }, []);

  const setActiveOrg = useCallback(async (organizationId: string) => {
    await apiJson(AUTH.setActiveOrg, { method: 'PUT', body: JSON.stringify({ organizationId }) });
    sessionStorage.setItem('activeOrganizationId', organizationId);
    await refetchMe();
  }, [refetchMe]);

  const signOut = useCallback(async () => {
    try {
      await apiJson(AUTH.logout, { method: 'POST' });
    } finally {
      await supabase.auth.signOut();
      sessionStorage.removeItem('activeOrganizationId');
      setState({ status: 'unauthenticated' });
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
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
      if (event === 'SIGNED_OUT') setState({ status: 'unauthenticated' });
      if (event === 'TOKEN_REFRESHED') {
        const token = (await supabase.auth.getSession()).data.session;
        if (token) await refetchMe();
      }
    });
    return () => subscription.unsubscribe();
  }, [refetchMe]);

  const value = useMemo(
    () =>
      state.status === 'authenticated'
        ? { ...state, setActiveOrg, refetchMe, signOut }
        : { ...state, setActiveOrg: async () => {}, refetchMe, signOut },
    [state, setActiveOrg, refetchMe, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
