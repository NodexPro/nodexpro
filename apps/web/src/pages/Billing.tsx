import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import { orgModulesState } from '../api/endpoints';

interface ModuleSubscriptionItemDto {
  id: string;
  modulePlanId: string;
  planName: string;
  currency: string;
  priceAmount: number;
  status: string;
  startedAt: string;
  endsAt: string | null;
}

interface ModuleStateItem {
  moduleId: string;
  code: string;
  name: string;
  isSystem: boolean;
  currentSubscription: ModuleSubscriptionItemDto | null;
}

export function Billing() {
  const auth = useAuth();
  const [state, setState] = useState<ModuleStateItem[]>([]);
  const [error, setError] = useState('');

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  useEffect(() => {
    if (!orgId) return;
    apiJson<{ trialState: unknown; modules: ModuleStateItem[] }>(orgModulesState(orgId))
      .then((res) => setState(res.modules))
      .catch((e) => setError(e.message));
  }, [orgId]);

  const withSubscription = state.filter((m) => !m.isSystem && m.currentSubscription);

  if (auth.status !== 'authenticated') return null;

  return (
    <div>
      <h1>Billing</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <h2>Module subscriptions</h2>
      <p>
        <Link to="/modules">Manage modules</Link> to add or change module plans.
      </p>
      {withSubscription.length === 0 ? (
        <p style={{ color: '#666' }}>No active module subscriptions. Select plans on the Modules page.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #ddd' }}>
              <th style={{ textAlign: 'left', padding: 8 }}>Module</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Plan</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Price</th>
              <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {withSubscription.map((m) => (
              <tr key={m.moduleId} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: 8 }}>{m.name}</td>
                <td style={{ padding: 8 }}>{m.currentSubscription!.planName}</td>
                <td style={{ padding: 8 }}>
                  {m.currentSubscription!.currency} {m.currentSubscription!.priceAmount}/month
                </td>
                <td style={{ padding: 8 }}>{m.currentSubscription!.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
