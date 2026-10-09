import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { workerMayOpenPath } from './worker-route.pure';

/** Redirects a worker shell away from office-admin URLs. The API still rejects those calls. */
export function RequireWorkerRoute({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status !== 'authenticated') return null;
  const allowed = workerMayOpenPath({
    shellProfile: auth.me.shell_profile,
    pathname: location.pathname,
    availableNavigation: auth.me.available_navigation ?? auth.me.visible_nav_items,
  });
  if (!allowed) {
    const next = (auth.me.default_route || '/modules').trim() || '/modules';
    return <Navigate to={next} replace />;
  }
  return <>{children}</>;
}
