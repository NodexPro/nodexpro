import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { readStoredInviteReturnPath } from '../../lib/invite-return-path.pure';

export function RequireOrg({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status !== 'authenticated') return null;
  if ((auth.me.session_state ?? 'ready') !== 'ready') {
    const inviteReturn = readStoredInviteReturnPath(typeof sessionStorage !== 'undefined' ? sessionStorage : null);
    if (inviteReturn && auth.me.session_state === 'needs_onboarding') {
      return <Navigate to={inviteReturn} replace />;
    }
    const redirectTo = (auth.me.redirect_to ?? '/select-org').trim() || '/select-org';
    if ((auth.me.session_state ?? '') === 'needs_org_selection') {
      return <Navigate to={redirectTo} replace state={{ from: `${location.pathname}${location.search}` }} />;
    }
    return <Navigate to={redirectTo} replace />;
  }
  return <>{children}</>;
}
