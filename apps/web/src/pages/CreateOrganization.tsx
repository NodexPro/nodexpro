import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson } from '../api/client';
import { ORGS } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';

export function CreateOrganization() {
  const [name, setName] = useState('');
  const [countryCode, setCountryCode] = useState('US');
  const [timezone, setTimezone] = useState('UTC');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const auth = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    if (!name.trim()) return;
    setError('');
    setLoading(true);
    try {
      const res = await apiJson<{ id: string; name: string; activeOrganizationId: string; membershipCreated: boolean }>(ORGS, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), countryCode, timezone }),
      });
      // [DEBUG] create organization API response
      console.debug('[CreateOrg] API response', { id: res.id, activeOrganizationId: res.activeOrganizationId, membershipCreated: res.membershipCreated });

      const activeId = res.activeOrganizationId ?? res.id;
      sessionStorage.setItem('activeOrganizationId', activeId);
      // [DEBUG] activeOrganizationId after set
      console.debug('[CreateOrg] sessionStorage set', { activeOrganizationId: sessionStorage.getItem('activeOrganizationId') });

      const me = await auth.refetchMe();
      // [DEBUG] /me refetch result
      console.debug('[CreateOrg] refetchMe result', {
        meReturned: !!me,
        activeOrganizationId: me?.activeOrganizationId,
        orgIds: me?.organizations?.map((o) => o.id) ?? [],
      });

      if (!me) {
        setError('Organization created but could not load session. Please refresh or go to Dashboard.');
        setLoading(false);
        return;
      }
      if (me.activeOrganizationId !== res.id) {
        setError('Organization created but context out of sync. Try opening Dashboard.');
        setLoading(false);
        return;
      }

      // [DEBUG] navigation decision after success
      console.debug('[CreateOrg] navigating to /dashboard');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: '80px auto', padding: 24 }}>
      <h1>Create organization</h1>
      {/* Do not reset form on submit: we only navigate on success; on failure we keep fields so user can retry. */}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="name">Organization name</label>
          <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required style={{ display: 'block', width: '100%', padding: 8 }} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="countryCode">Country</label>
          <select id="countryCode" value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={{ display: 'block', width: '100%', padding: 8 }}>
            <option value="US">United States</option>
            <option value="IL">Israel</option>
            <option value="GB">United Kingdom</option>
          </select>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="timezone">Timezone</label>
          <input id="timezone" type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ display: 'block', width: '100%', padding: 8 }} />
        </div>
        {error && <p style={{ color: 'red', marginBottom: 16 }}>{error}</p>}
        {loading && <p style={{ marginBottom: 16 }}>Creating organization...</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Creating...' : 'Create'}
        </button>
      </form>
    </div>
  );
}
