import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { isPasswordRecoveryActive } from '../../lib/password-recovery';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (isPasswordRecoveryActive() && location.pathname !== '/reset-password') {
    return (
      <Navigate
        to={{ pathname: '/reset-password', search: location.search, hash: location.hash }}
        replace
      />
    );
  }
  if (auth.status === 'loading') return <div>Loading...</div>;
  if (auth.status === 'unauthenticated') return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
