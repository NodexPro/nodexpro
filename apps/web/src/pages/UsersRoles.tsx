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
import { uiText } from '../components/users-roles/users-roles-selection.pure';
import { CoNavGlyph, ROW_ACTION_GLYPH } from '../templates/template-1/components/AppSidebar';
import '../components/users-roles/UsersRoles.css';

type ModalState =
  | { kind: 'profile' | 'clients' | 'modules' | 'close'; memberId: string }
  | null;

/** Backend message when there is one; the screen text (backend `ui`) is used once it is known. */
function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Compact icon-only row action (canonical 24 / 1.7 / round line glyph). Label doubles as tooltip + accessible name. */
function RowIconAction(props: {
  icon: string;
  label: string;
  onClick: () => void;
  tone?: 'default' | 'destructive';
}) {
  return (
    <button
      type="button"
      className={`nx-ur-icon-btn${props.tone === 'destructive' ? ' nx-ur-icon-btn--destructive' : ''}`}
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <CoNavGlyph icon={props.icon} className="nx-ur-icon" />
    </button>
  );
}

/**
 * Users & Roles — office employee management.
 * Renders ONE backend aggregate. Actions, labels, counts, summaries, language and text direction
 * come from the backend (`ui`); this screen contains no role, permission or locale logic.
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

  // Text and direction are backend truth. Before the first aggregate arrives there is nothing to translate.
  const ui = data?.ui ?? null;
  const T = (key: string): string => (ui ? uiText(ui, key) : '');
  const fallbackError = ui ? uiText(ui, 'something_went_wrong') : 'Something went wrong. Please try again.';

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setData(await fetchUsersRolesAggregate(orgId));
      setError('');
    } catch (e) {
      setError(errorText(e, 'Something went wrong. Please try again.'));
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
      setError(errorText(err, fallbackError));
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
      setError(errorText(err, fallbackError));
    } finally {
      setInviteRowBusy(null);
    }
  };

  const cancelInvite = async (inviteId: string, confirmText: string) => {
    if (!orgId || !window.confirm(confirmText)) return;
    setInviteRowBusy(inviteId);
    setError('');
    try {
      await apiFetch(orgInviteRevoke(orgId, inviteId), { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorText(err, fallbackError));
    } finally {
      setInviteRowBusy(null);
    }
  };

  if (auth.status !== 'authenticated') return null;
  if (!orgId) return <p className="nx-ur-empty">{T('select_organization') || '…'}</p>;

  const modalMember: UsersRolesMemberRow | null = modal
    ? ([...(data?.owners ?? []), ...(data?.members ?? [])].find((m) => m.member_id === modal.memberId) ?? null)
    : null;

  return (
    <div className="nx-ur-page" dir={ui?.direction ?? 'ltr'} lang={ui?.locale ?? 'en'}>
      <div className="nx-ur-page__head">
        <div>
          <h1 className="nx-ur-page__title">{T('title')}</h1>
          <p className="nx-ur-page__lead">{T('lead')}</p>
        </div>
        {data?.available_actions.invite_member ? (
          <button
            type="button"
            className="nx-btn nx-ur-btn nx-ur-btn--primary"
            onClick={() => {
              setInviteRole(data.invite_roles[0]?.code ?? '');
              setShowInvite(true);
            }}
          >
            {T('invite_member')}
          </button>
        ) : null}
      </div>

      {error ? <div className="nx-ur-error">{error}</div> : null}

      {showInvite && data ? (
        <form className="nx-ur-invite-form" onSubmit={sendInvite}>
          <label className="nx-ur-field" style={{ flex: '1 1 240px' }}>
            <span>{T('email')}</span>
            <input
              type="email"
              dir="ltr"
              required
              value={inviteEmail}
              placeholder="name@example.com"
              onChange={(e) => setInviteEmail(e.target.value)}
            />
          </label>
          <label className="nx-ur-field">
            <span>{T('role')}</span>
            <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
              {data.invite_roles.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="nx-btn nx-ur-btn nx-ur-btn--primary" disabled={inviteBusy}>
            {inviteBusy ? T('sending') : T('send_invitation')}
          </button>
          <button type="button" className="nx-btn nx-btn-secondary nx-ur-btn" onClick={() => setShowInvite(false)}>
            {T('cancel')}
          </button>
        </form>
      ) : null}

      {data ? (
        <>
          {data.owners.length > 0 ? (
            <section className="nx-ur-owner" aria-label={T('owner_section')} data-testid="users-roles-owner-section">
              <div className="nx-ur-owner__tag">{T('owner_section')}</div>
              {data.owners.map((o) => (
                <div key={o.member_id} className={`nx-ur-owner__row${o.membership.status.code === 'active' ? '' : ' is-closed'}`}>
                  <div className="nx-ur-owner__who">
                    <div className="nx-ur-name">
                      {o.profile.display_name}
                      {o.is_self ? <span className="nx-ur-you">{T('you')}</span> : null}
                    </div>
                    {o.profile.email && o.profile.email !== o.profile.display_name ? (
                      <div className="nx-ur-sub nx-ur-ltr">{o.profile.email}</div>
                    ) : null}
                  </div>
                  {o.profile.phone ? <div className="nx-ur-owner__meta nx-ur-ltr">{o.profile.phone}</div> : null}
                  <div className="nx-ur-owner__meta nx-ur-ltr">{o.membership.start_date ?? '—'}</div>
                  <span className={`nx-ur-badge nx-ur-badge--${o.membership.status.code}`}>{o.membership.status.label}</span>
                  <div className="nx-ur-actions">
                    {o.available_actions.edit_profile ? (
                      <RowIconAction
                        icon={ROW_ACTION_GLYPH.edit}
                        label={T('edit_details')}
                        onClick={() => setModal({ kind: 'profile', memberId: o.member_id })}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          <div className="nx-ur-sheet">
            <div className="nx-ur-table-scroll">
              <table className="nx-ur-table nx-ur-table--members">
                <thead>
                  <tr>
                    <th className="nx-ur-th--num">{T('number_short')}</th>
                    <th>{T('name')}</th>
                    <th>{T('role')}</th>
                    <th>{T('clients')}</th>
                    <th>{T('modules')}</th>
                    <th>{T('start_date')}</th>
                    <th>{T('status')}</th>
                    <th className="nx-ur-th--actions">{T('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.members.map((m) => (
                    <tr key={m.member_id} className={m.membership.status.code === 'active' ? '' : 'is-closed'}>
                      <td className="nx-ur-td--num">{m.display_number ?? ''}</td>
                      <td className="nx-ur-td--name">
                        <div className="nx-ur-name">
                          {m.profile.display_name}
                          {m.is_self ? <span className="nx-ur-you">{T('you')}</span> : null}
                        </div>
                        <div className="nx-ur-subline">
                          {m.profile.email && m.profile.email !== m.profile.display_name ? (
                            <span className="nx-ur-sub nx-ur-ltr">{m.profile.email}</span>
                          ) : null}
                          {m.profile.phone ? <span className="nx-ur-sub nx-ur-ltr">{m.profile.phone}</span> : null}
                        </div>
                      </td>
                      <td>{m.role.label}</td>
                      <td>{m.client_access.summary}</td>
                      <td>{m.module_access.summary}</td>
                      <td className="nx-ur-ltr">{m.membership.start_date ?? '—'}</td>
                      <td>
                        <span className={`nx-ur-badge nx-ur-badge--${m.membership.status.code}`}>
                          {m.membership.status.label}
                        </span>
                      </td>
                      <td className="nx-ur-td--actions">
                        <div className="nx-ur-actions">
                          {m.available_actions.edit_profile ? (
                            <RowIconAction
                              icon={ROW_ACTION_GLYPH.edit}
                              label={T('edit_details')}
                              onClick={() => setModal({ kind: 'profile', memberId: m.member_id })}
                            />
                          ) : null}
                          {m.available_actions.manage_clients ? (
                            <RowIconAction
                              icon={ROW_ACTION_GLYPH.clients}
                              label={T('manage_clients')}
                              onClick={() => setModal({ kind: 'clients', memberId: m.member_id })}
                            />
                          ) : null}
                          {m.available_actions.manage_modules ? (
                            <RowIconAction
                              icon={ROW_ACTION_GLYPH.modules}
                              label={T('manage_modules')}
                              onClick={() => setModal({ kind: 'modules', memberId: m.member_id })}
                            />
                          ) : null}
                          {m.available_actions.close_access ? (
                            <RowIconAction
                              icon={ROW_ACTION_GLYPH.close_access}
                              label={T('close_access')}
                              tone="destructive"
                              onClick={() => setModal({ kind: 'close', memberId: m.member_id })}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.members.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="nx-ur-td--empty">
                        {T('no_members')}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>

          <h2 className="nx-ur-section-title">{T('invitations')}</h2>
          <div className="nx-ur-sheet">
            <div className="nx-ur-table-scroll">
              <table className="nx-ur-table">
                <thead>
                  <tr>
                    <th>{T('email')}</th>
                    <th>{T('role')}</th>
                    <th>{T('status')}</th>
                    <th>{T('last_sent')}</th>
                    <th className="nx-ur-th--actions">{T('actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invitations.map((inv) => (
                    <tr key={inv.invitation_id}>
                      <td className="nx-ur-ltr">{inv.email}</td>
                      <td>{inv.role.label}</td>
                      <td>
                        <span className={`nx-ur-badge nx-ur-badge--${inv.status.code}`}>{inv.status.label}</span>
                      </td>
                      <td className="nx-ur-sub">{inv.sent_summary}</td>
                      <td className="nx-ur-td--actions">
                        <div className="nx-ur-actions">
                          {inv.available_actions.resend ? (
                            <button
                              type="button"
                              className="nx-btn nx-btn-secondary nx-ur-btn nx-ur-btn--sm nx-ur-btn--action"
                              disabled={inviteRowBusy === inv.invitation_id}
                              onClick={() => resendInvite(inv.invitation_id)}
                            >
                              {T('resend')}
                            </button>
                          ) : null}
                          {inv.available_actions.cancel ? (
                            <button
                              type="button"
                              className="nx-btn nx-btn-secondary nx-ur-btn nx-ur-btn--sm nx-ur-btn--action nx-ur-btn--soft-danger"
                              disabled={inviteRowBusy === inv.invitation_id}
                              onClick={() => cancelInvite(inv.invitation_id, inv.cancel_confirm)}
                            >
                              {T('cancel')}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {data.invitations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="nx-ur-td--empty">
                        {T('no_invitations')}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : !error ? (
        <p className="nx-ur-empty">…</p>
      ) : null}

      {ui && modal && modalMember && modal.kind === 'profile' ? (
        <MemberProfileModal
          orgId={orgId}
          member={modalMember}
          ui={ui}
          onClose={() => setModal(null)}
          onSaved={applyTruth}
        />
      ) : null}
      {ui && modal && modalMember && modal.kind === 'clients' ? (
        <MemberClientsModal
          orgId={orgId}
          member={modalMember}
          ui={ui}
          onClose={() => setModal(null)}
          onSaved={applyTruth}
        />
      ) : null}
      {ui && modal && modalMember && modal.kind === 'modules' ? (
        <MemberModulesModal
          orgId={orgId}
          member={modalMember}
          ui={ui}
          onClose={() => setModal(null)}
          onSaved={applyTruth}
        />
      ) : null}
      {ui && modal && modalMember && modal.kind === 'close' ? (
        <CloseAccessModal
          orgId={orgId}
          member={modalMember}
          ui={ui}
          onClose={() => setModal(null)}
          onClosed={applyTruth}
        />
      ) : null}
    </div>
  );
}
