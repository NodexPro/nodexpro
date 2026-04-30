import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function SelectOrganization() {
  const auth = useAuth();
  const navigate = useNavigate();

  if (auth.status !== 'authenticated') return null;
  const { organizations } = auth.me;
  const { setActiveOrg } = auth;

  if (organizations.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  async function select(id: string) {
    await setActiveOrg(id);
    navigate('/dashboard', { replace: true });
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
