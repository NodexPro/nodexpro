import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function RequireOrg({ children }: { children: React.ReactNode }) {
  const auth = useAuth();

  if (auth.status !== 'authenticated') return null;
  if (!auth.me.activeOrganizationId) {
    if (auth.me.organizations.length === 0) return <Navigate to="/onboarding" replace />;
    return <Navigate to="/select-org" replace />;
  }
  return <>{children}</>;
}
