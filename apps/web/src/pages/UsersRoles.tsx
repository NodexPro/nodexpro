import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, apiJson } from '../api/client';
import { orgInviteResend, orgInviteRevoke, orgMembersInvite } from '../api/endpoints';
import { fetchUsersRolesAggregate, type UsersRolesAggregate, type UsersRolesMemberRow } from '../api/users-roles';
import {
  CloseAccessModal,
  MemberClientsModal,
  MemberModulesModal,
  MemberProfileModal,
} from '../components/users-roles/UsersRolesModals';
import '../components/users-roles/UsersRoles.css';

type ModalState =
  | { kind: 'profile' | 'clients' | 'modules' | 'close'; memberId: string }
  | null;

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
}

/**
 * Users & Roles — office employee management.
 * Renders ONE backend aggregate. Actions, labels, counts and summaries come from the backend;
 * this screen contains no role or permission logic.
 */
export function UsersRoles() {
  const auth = useAuth();
  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId : null;

  const [data, setData] = useState<UsersRolesAggregate | null>(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteRowBusy, setInviteRowBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setData(await fetchUsersRolesAggregate(orgId));
      setError('');
    } catch (e) {
      setError(errorText(e));
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** A command returned refreshed backend truth: render it and close the modal. */
  const applyTruth = (aggregate: UsersRolesAggregate) => {
    setData(aggregate);
    setModal(null);
    setError('');
  };

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgId || !inviteEmail.trim()) return;
    setInviteBusy(true);
    setError('');
    try {
      const result = await apiJson<{ status?: string; invite_link?: string }>(orgMembersInvite(orgId), {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          role_code: inviteRole || data?.invite_roles[0]?.code,
        }),
      });
      setShowInvite(false);
      setInviteEmail('');
      if (result?.invite_link) await navigator.clipboard.writeText(result.invite_link).catch(() => undefined);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setInviteBusy(false);
    }
  };

  const resendInvite = async (inviteId: string) => {
    if (!orgId) return;
    setInviteRowBusy(inviteId);
    setError('');
    try {
      await apiFetch(orgInviteResend(orgId, inviteId), { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setInviteRowBusy(null);
    }
  };

  const cancelInvite = async (inviteId: string, email: string) => {
    if (!orgId || !window.confirm(`Cancel the invitation for ${email}?`)) return;
    setInviteRowBusy(inviteId);
    setError('');
    try {
      await apiFetch(orgInviteRevoke(orgId, inviteId), { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setInviteRowBusy(null);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p className="nx-ur-empty">Select an organization.</p>;

  const modalMember: UsersRolesMemberRow | null = modal
    ? (data?.members.find((m) => m.member_id === modal.memberId) ?? null)
    : null;

  return (
    <div className="nx-ur-page">
      <div className="nx-ur-page__head">
        <div>
          <h1 className="nx-ur-page__title">Users & Roles</h1>
          <p className="nx-ur-page__lead">Your office team: who they are, which clients and areas they can open.</p>
        </div>
        {data?.available_actions.invite_member ? (
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-ur-btn"
            onClick={() => {
              setInviteRole(data.invite_roles[0]?.code ?? '');
              setShowInvite(true);
            }}
          >
            Invite member
          </button>
        ) : null}
      </div>

      {error ? <div className="nx-ur-error">{error}</div> : null}

      {showInvite && data ? (
        <form className="nx-ur-invite-form" onSubmit={sendInvite}>
          <label className="nx-ur-field" style={{ flex: '1 1 240px' }}>
            <span>Email</span>
            <input
              type="email"
              required
              value={inviteEmail}
              placeholder="name@example.com"
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </label>
          <label className="nx-ur-field">
            <span>Role</span>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {data.invite_roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="nx-btn nx-btn-primary nx-ur-btn" disabled={inviteBusy}>
            {inviteBusy ? 'Sending…' : 'Send invitation'}
          </button>
          <button type="button" className="nx-btn nx-ur-btn" onClick={() => setShowInvite(false)}>
            Cancel
          </button>
        </form>
      ) : null}

      {data ? (
        <>
          <div className="nx-ur-grid nx-ur-head" aria-hidden="true">
            <div>Name</div>
            <div>Role</div>
            <div>Clients</div>
            <div>Modules</div>
            <div>Start date</div>
            <div>Status</div>
            <div />
          </div>

          {data.members.map((m) => (
            <div
              key={m.member_id}
              className={`nx-ur-grid nx-ur-row${m.membership.status.code === 'active' ? '' : ' nx-ur-row--closed'}`}
            >
              <div>
                <div className="nx-ur-name">
                  {m.profile.display_name}
                  {m.is_self ? <span className="nx-ur-you">You</span> : null}
                </div>
                {m.profile.email && m.profile.email !== m.profile.display_name ? (
                  <div className="nx-ur-sub">{m.profile.email}</div>
                ) : null}
                {m.profile.phone ? <div className="nx-ur-sub">{m.profile.phone}</div> : null}
              </div>
              <div className="nx-ur-cell">{m.role.label}</div>
              <div className="nx-ur-cell">{m.client_access.summary}</div>
              <div className="nx-ur-cell">{m.module_access.summary}</div>
              <div className="nx-ur-cell">{m.membership.start_date ?? '—'}</div>
              <div>
                <span className={`nx-ur-badge nx-ur-badge--${m.membership.status.code}`}>
                  {m.membership.status.label}
                </span>
              </div>
              <div className="nx-ur-actions">
                {m.available_actions.edit_profile ? (
                  <button
                    type="button"
                    className="nx-btn nx-ur-btn nx-ur-btn--sm"
                    onClick={() => setModal({ kind: 'profile', memberId: m.member_id })}
                  >
                    Edit details
                  </button>
                ) : null}
                {m.available_actions.manage_clients ? (
                  <button
                    type="button"
                    className="nx-btn nx-ur-btn nx-ur-btn--sm"
                    onClick={() => setModal({ kind: 'clients', memberId: m.member_id })}
                  >
                    Manage clients
                  </button>
                ) : null}
                {m.available_actions.manage_modules ? (
                  <button
                    type="button"
                    className="nx-btn nx-ur-btn nx-ur-btn--sm"
                    onClick={() => setModal({ kind: 'modules', memberId: m.member_id })}
                  >
                    Manage modules
                  </button>
                ) : null}
                {m.available_actions.close_access ? (
                  <button
                    type="button"
                    className="nx-btn nx-ur-btn nx-ur-btn--sm nx-ur-btn--danger"
                    onClick={() => setModal({ kind: 'close', memberId: m.member_id })}
                  >
                    Close access
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {data.members.length === 0 ? <p className="nx-ur-empty">No team members yet.</p> : null}

          <h2 className="nx-ur-section-title">Invitations</h2>
          {data.invitations.map((inv) => (
            <div key={inv.invitation_id} className="nx-ur-invite-row">
              <div className="nx-ur-cell">{inv.email}</div>
              <div className="nx-ur-cell">{inv.role.label}</div>
              <div>
                <span className={`nx-ur-badge nx-ur-badge--${inv.status.code}`}>{inv.status.label}</span>
              </div>
              <div className="nx-ur-sub">
                {inv.last_sent_date ? `Sent ${inv.last_sent_date}` : ''}
                {inv.send_count > 1 ? ` · ${inv.send_count}×` : ''}
              </div>
              <div className="nx-ur-actions">
                {inv.available_actions.resend ? (
                  <button
                    type="button"
                    className="nx-btn nx-ur-btn nx-ur-btn--sm"
                    disabled={inviteRowBusy === inv.invitation_id}
                    onClick={() => resendInvite(inv.invitation_id)}
                  >
                    Resend
                  </button>
                ) : null}
                {inv.available_actions.cancel ? (
                  <button
                    type="button"
                    className="nx-btn nx-ur-btn nx-ur-btn--sm nx-ur-btn--danger"
                    disabled={inviteRowBusy === inv.invitation_id}
                    onClick={() => cancelInvite(inv.invitation_id, inv.email)}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {data.invitations.length === 0 ? <p className="nx-ur-muted">No pending invitations.</p> : null}
        </>
      ) : !error ? (
        <p className="nx-ur-empty">Loading…</p>
      ) : null}

      {modal && modalMember && modal.kind === 'profile' ? (
        <MemberProfileModal orgId={orgId} member={modalMember} onClose={() => setModal(null)} onSaved={applyTruth} />
      ) : null}
      {modal && modalMember && modal.kind === 'clients' ? (
        <MemberClientsModal orgId={orgId} member={modalMember} onClose={() => setModal(null)} onSaved={applyTruth} />
      ) : null}
      {modal && modalMember && modal.kind === 'modules' ? (
        <MemberModulesModal orgId={orgId} member={modalMember} onClose={() => setModal(null)} onSaved={applyTruth} />
      ) : null}
      {modal && modalMember && modal.kind === 'close' ? (
        <CloseAccessModal orgId={orgId} member={modalMember} onClose={() => setModal(null)} onClosed={applyTruth} />
      ) : null}
    </div>
  );
}
