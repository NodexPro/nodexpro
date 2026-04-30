import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson, apiFetch } from '../api/client';
import { orgMembers, orgMembersInvite, orgMember, orgMemberRole, orgInvites, orgInviteResend, orgInviteRevoke } from '../api/endpoints';

interface Member {
  id: string;
  user_id: string;
  role_code: string;
  role_name: string;
  status: string;
  invited_at: string | null;
  joined_at: string | null;
  email: string | null;
  full_name: string | null;
}

interface Invite {
  id: string;
  email: string;
  role_key: string;
  status: string;
  created_at: string;
  last_sent_at: string | null;
  send_count: number;
}

const ASSIGNABLE_ROLES = [
  { code: 'admin', name: 'Admin' },
  { code: 'staff', name: 'Staff' },
  { code: 'viewer', name: 'Viewer' },
] as const;

export function UsersRoles() {
  const auth = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('staff');
  const [inviting, setInviting] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [resending, setResending] = useState<string | null>(null);
  const [revokingInvite, setRevokingInvite] = useState<string | null>(null);

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;
  const canInvite = auth.status === 'authenticated' && (auth.me?.permissions?.includes('invite_users') || auth.me?.permissions?.includes('members:write'));
  const canViewInvites = auth.status === 'authenticated' && (auth.me?.permissions?.includes('view_users') || auth.me?.permissions?.includes('invite_users') || auth.me?.permissions?.includes('members:read') || auth.me?.permissions?.includes('members:write'));
  const canChangeRole = auth.status === 'authenticated' && (auth.me?.permissions?.includes('change_user_role') || auth.me?.permissions?.includes('members:write'));
  const canRevoke = auth.status === 'authenticated' && (auth.me?.permissions?.includes('revoke_user_access') || auth.me?.permissions?.includes('members:revoke'));

  const load = () => {
    if (!orgId) return;
    apiJson<Member[]>(orgMembers(orgId))
      .then((d) => setMembers(Array.isArray(d) ? d : []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  };

  const loadInvites = () => {
    if (!orgId || !canViewInvites) return;
    apiJson<Invite[]>(orgInvites(orgId))
      .then((d) => setInvites(Array.isArray(d) ? d : []))
      .catch(() => setInvites([]));
  };

  useEffect(() => {
    load();
  }, [orgId]);

  useEffect(() => {
    loadInvites();
  }, [orgId, canViewInvites]);

  const revokeMember = async (memberId: string, member: Member) => {
    if (!orgId || !canRevoke) return;
    if (member.role_code === 'owner') {
      setError('Cannot revoke owner');
      return;
    }
    if (member.user_id === auth.me?.user?.id) {
      setError('Cannot revoke your own access');
      return;
    }
    if (!window.confirm(`Revoke access for ${member.email ?? 'this user'}?`)) return;
    setRevoking(memberId);
    setError('');
    try {
      await apiFetch(orgMember(orgId, memberId), { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke');
    } finally {
      setRevoking(null);
    }
  };

  const changeRole = async (memberId: string, member: Member, newRole: string) => {
    if (!orgId || !canChangeRole) return;
    if (member.role_code === 'owner') {
      setError('Cannot modify owner');
      return;
    }
    if (member.user_id === auth.me?.user?.id) {
      setError('Cannot change your own role');
      return;
    }
    setChangingRole(memberId);
    setError('');
    try {
      await apiFetch(orgMemberRole(orgId, memberId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_code: newRole }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to change role');
    } finally {
      setChangingRole(null);
    }
  };

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !canInvite || !inviteEmail.trim()) return;
    setInviting(true);
    setError('');
    try {
      const result = await apiJson<{ status?: string; inviteId?: string; invite_link?: string }>(orgMembersInvite(orgId), {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim().toLowerCase(), role_code: inviteRole }),
      });
      setShowInvite(false);
      setInviteEmail('');
      setInviteRole('staff');
      load();
      loadInvites();
      if (result?.status === 'invite_already_exists') {
        setError('');
      } else if (result?.invite_link) {
        await navigator.clipboard.writeText(result.invite_link);
        setError('');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const resendInvite = async (inviteId: string) => {
    if (!orgId || !canInvite) return;
    setResending(inviteId);
    setError('');
    try {
      await apiFetch(orgInviteResend(orgId, inviteId), { method: 'POST' });
      loadInvites();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resend');
    } finally {
      setResending(null);
    }
  };

  const revokeInvite = async (inviteId: string, email: string) => {
    if (!orgId || !canInvite) return;
    if (!window.confirm(`Cancel invitation for ${email}?`)) return;
    setRevokingInvite(inviteId);
    setError('');
    try {
      await apiFetch(orgInviteRevoke(orgId, inviteId), { method: 'POST' });
      loadInvites();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setRevokingInvite(null);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p style={{ padding: 24 }}>Select an organization.</p>;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>Users & Roles</h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>Manage organization members, invite users, and assign roles.</p>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', color: '#b91c1c', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Users</h2>
        {canInvite && (
          <button
            type="button"
            onClick={() => setShowInvite(true)}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer', fontWeight: 500 }}
          >
            Invite member
          </button>
        )}
      </div>

      {canInvite && showInvite && (
        <form onSubmit={sendInvite} style={{ padding: 20, background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 24 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Invite member</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <label style={{ flex: '1 1 200px' }}>
              Email
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                placeholder="user@example.com"
                style={{ display: 'block', marginTop: 4, padding: '8px 12px', width: '100%', borderRadius: 8, border: '1px solid #d1d5db' }}
              />
            </label>
            <label>
              Role
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                style={{ display: 'block', marginTop: 4, padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={inviting} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', cursor: 'pointer' }}>
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
            <button type="button" onClick={() => { setShowInvite(false); setInviteEmail(''); }} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 32 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: 12 }}>Name</th>
            <th style={{ textAlign: 'left', padding: 12 }}>Email</th>
            <th style={{ textAlign: 'left', padding: 12 }}>Role</th>
            {(canChangeRole || canRevoke) && <th style={{ textAlign: 'right', padding: 12 }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: 12 }}>{m.full_name ?? '—'}</td>
              <td style={{ padding: 12 }}>{m.email ?? '—'}</td>
              <td style={{ padding: 12 }}>
                {canChangeRole && m.role_code !== 'owner' && m.user_id !== auth.me?.user?.id ? (
                  <select
                    value={m.role_code}
                    onChange={(e) => changeRole(m.id, m, e.target.value)}
                    disabled={!!changingRole}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{m.role_name}</span>
                )}
              </td>
              {(canChangeRole || canRevoke) && (
                <td style={{ padding: 12, textAlign: 'right' }}>
                  {canRevoke && m.role_code !== 'owner' && m.user_id !== auth.me?.user?.id && (
                    <button
                      type="button"
                      onClick={() => revokeMember(m.id, m)}
                      disabled={!!revoking}
                      style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
                    >
                      {revoking === m.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {members.length === 0 && <p style={{ padding: 24, color: '#6b7280' }}>No members yet. Invite users to get started.</p>}

      {canViewInvites && (
        <>
          <h2 style={{ fontSize: '1.1rem', marginBottom: 12, marginTop: 8 }}>Invitations</h2>
          {invites.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ textAlign: 'left', padding: 12 }}>Email</th>
                  <th style={{ textAlign: 'left', padding: 12 }}>Role</th>
                  <th style={{ textAlign: 'left', padding: 12 }}>Sent count</th>
                  <th style={{ textAlign: 'right', padding: 12 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 12 }}>{inv.email}</td>
                    <td style={{ padding: 12 }}>{ASSIGNABLE_ROLES.find((r) => r.code === inv.role_key)?.name ?? inv.role_key}</td>
                    <td style={{ padding: 12 }}>{inv.send_count}</td>
                    <td style={{ padding: 12, textAlign: 'right' }}>
                      {canInvite && (
                        <>
                          <button
                            type="button"
                            onClick={() => resendInvite(inv.id)}
                            disabled={!!resending}
                            style={{ marginRight: 8, padding: '6px 12px', borderRadius: 6, border: '1px solid #059669', background: '#ecfdf5', color: '#059669', cursor: 'pointer' }}
                          >
                            {resending === inv.id ? 'Sending…' : 'Resend'}
                          </button>
                          <button
                            type="button"
                            onClick={() => revokeInvite(inv.id, inv.email)}
                            disabled={!!revokingInvite}
                            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', color: '#b91c1c', cursor: 'pointer' }}
                          >
                            {revokingInvite === inv.id ? 'Cancelling…' : 'Cancel'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p style={{ padding: 12, color: '#6b7280' }}>No pending invitations.</p>
          )}
        </>
      )}
    </div>
  );
}
