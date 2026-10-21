import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useI18n } from '../../i18n/I18nProvider';
import '../../styles/nx-glass-surface.css';

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const { t } = useI18n();

  if (auth.status === 'loading') {
    return (
      <div className="nx-session-boot" role="status" aria-live="polite" aria-busy="true">
        {t('common.loading')}
      </div>
    );
  }
  if (auth.status === 'unauthenticated') return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}
