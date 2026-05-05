import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function RequireOrg({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (auth.status !== 'authenticated') return null;
  if ((auth.me.session_state ?? 'ready') !== 'ready') {
    const redirectTo = (auth.me.redirect_to ?? '/select-org').trim() || '/select-org';
    return <Navigate to={redirectTo} replace />;
  }
  return <>{children}</>;
}
