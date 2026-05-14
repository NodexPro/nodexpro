import { useNavigate, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function deepLinkFromLocationState(state: unknown): string | null {
  const fromRaw = state && typeof state === 'object' && 'from' in state ? (state as { from?: unknown }).from : undefined;
  if (typeof fromRaw !== 'string' || !fromRaw.startsWith('/')) return null;
  if (fromRaw === '/select-org') return null;
  return fromRaw;
}

export function SelectOrganization() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (auth.status !== 'authenticated') return null;
  const { organizations } = auth.me;
  const { selectActiveOrg } = auth;
  if ((auth.me.session_state ?? 'ready') !== 'needs_org_selection') {
    const fromPath = deepLinkFromLocationState(location.state);
    const redirectTo = (auth.me.redirect_to ?? '/dashboard').trim() || '/dashboard';
    return <Navigate to={fromPath ?? redirectTo} replace />;
  }

  async function select(id: string) {
    /** Read before await: after selectActiveOrg, session becomes `ready` and a sync re-render can run
     * `<Navigate to={redirect_to} />` that ignored `from` — losing the deep link. */
    const capturedFrom = deepLinkFromLocationState(location.state);
    const refreshed = await selectActiveOrg(id);
    const fallback = (refreshed?.redirect_to ?? '/dashboard').trim() || '/dashboard';
    navigate(capturedFrom ?? fallback, { replace: true });
  }

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: 24 }}>
      <h1>Select organization</h1>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {organizations.map((org) => (
          <li key={org.id} style={{ marginBottom: 8 }}>
            <button type="button" onClick={() => select(org.id)} style={{ padding: '12px 16px', width: '100%', textAlign: 'left' }}>
              {org.name}
            </button>
          </li>
        ))}
      </ul>
      <p><a href="/onboarding">Create new organization</a></p>
    </div>
  );
}
