import { Navigate } from 'react-router-dom';

/** Office client-payment setup lives on Billing → Client Payment Processing (same office_payments aggregate). */
export function OfficePaymentsPage() {
  return <Navigate to="/billing?tab=client_processing" replace />;
}
