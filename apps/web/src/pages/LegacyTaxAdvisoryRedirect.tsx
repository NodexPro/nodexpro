import { Navigate, useLocation } from 'react-router-dom';
import { businessSetupHomePath, rewriteLegacyTaxAdvisoryPath } from '../modules/business-setup-routes';

export function LegacyTaxAdvisoryRedirect() {
  const { pathname, search } = useLocation();
  const next = rewriteLegacyTaxAdvisoryPath(pathname) ?? businessSetupHomePath();
  return <Navigate to={`${next}${search}`} replace />;
}
