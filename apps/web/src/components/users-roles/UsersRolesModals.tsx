import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  closeMemberAccessCommand,
  fetchMemberClientAccessEditor,
  fetchMemberModuleAssignability,
  setMemberClientAccessCommand,
  setMemberModuleAccessCommand,
  setMemberProfileCommand,
  type MemberClientAccessEditorAggregate,
  type MemberModuleAssignabilityAggregate,
  type UsersRolesAggregate,
  type UsersRolesMemberRow,
} from '../../api/users-roles';
import {
  buildClientAccessPayload,
  buildModuleAccessPayload,
  describeCloseAccessBlockers,
  filterCatalogClients,
  initialModuleDraft,
  toggleSelected,
} from './users-roles-selection.pure';
import './UsersRoles.css';

function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Something went wrong. Please try again.';
}

function ModalShell(props: {
  title: string;
  subtitle?: string;
  busy: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="nx-ur-overlay" role="presentation" onClick={() => !props.busy && props.onClose()}>
      <div className="nx-ur-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="nx-ur-modal__header">
          <div>
            <h2 className="nx-ur-modal__title">{props.title}</h2>
            {props.subtitle ? <div className="nx-ur-modal__subtitle">{props.subtitle}</div> : null}
          </div>
          <button type="button" className="nx-ur-modal__close" aria-label="Close" disabled={props.busy} onClick={props.onClose}>
            ×
          </button>
        </div>
        <div className="nx-ur-modal__body">{props.children}</div>
        <div className="nx-ur-modal__footer">{props.footer}</div>
      </div>
    </div>
  );
}

/* ------------------------------ Edit details ------------------------------ */

export function MemberProfileModal(props: {
  orgId: string;
  member: UsersRolesMemberRow;
  onClose: () => void;
  onSaved: (aggregate: UsersRolesAggregate) => void;
}) {
  const { member } = props;
  const [first, setFirst] = useState(member.profile.first_name ?? '');
  const [last, setLast] = useState(member.profile.last_name ?? '');
  const [phone, setPhone] = useState(member.profile.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const aggregate = await setMemberProfileCommand(props.orgId, member.member_id, {
        first_name: first,
        last_name: last,
        phone,
      });
      props.onSaved(aggregate);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Edit details"
      subtitle={member.profile.email ?? undefined}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="nx-btn nx-ur-btn" disabled={busy} onClick={props.onClose}>
            Close
          </button>
          <button type="button" className="nx-btn nx-btn-primary nx-ur-btn" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error ? <div className="nx-ur-error">{error}</div> : null}
      <div className="nx-ur-form-grid">
        <label className="nx-ur-field">
          <span>First name</span>
          <input value={first} maxLength={80} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="nx-ur-field">
          <span>Last name</span>
          <input value={last} maxLength={80} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="nx-ur-field nx-ur-field--wide">
          <span>Phone</span>
          <input value={phone} maxLength={32} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>
    </ModalShell>
  );
}

/* ----------------------------- Manage clients ----------------------------- */

export function MemberClientsModal(props: {
  orgId: string;
  member: UsersRolesMemberRow;
  onClose: () => void;
  onSaved: (aggregate: UsersRolesAggregate) => void;
}) {
  const [editor, setEditor] = useState<MemberClientAccessEditorAggregate | null>(null);
  const [mode, setMode] = useState<'all' | 'selected'>('selected');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchMemberClientAccessEditor(props.orgId, props.member.member_id)
      .then((agg) => {
        if (!alive) return;
        setEditor(agg);
        setMode(agg.access_mode);
        setSelected(new Set(agg.selected_client_ids));
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [props.orgId, props.member.member_id]);

  const visible = useMemo(() => filterCatalogClients(editor?.clients ?? [], query), [editor, query]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await setMemberClientAccessCommand(
        props.orgId,
        props.member.member_id,
        buildClientAccessPayload(mode, selected),
      );
      props.onSaved(out.users_roles_aggregate);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Manage clients"
      subtitle={editor?.member.display_name ?? props.member.profile.display_name}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="nx-btn nx-ur-btn" disabled={busy} onClick={props.onClose}>
            Close
          </button>
          <button type="button" className="nx-btn nx-btn-primary nx-ur-btn" disabled={busy || !editor} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error ? <div className="nx-ur-error">{error}</div> : null}
      {!editor && !error ? <div className="nx-ur-muted">Loading…</div> : null}
      {editor ? (
        <>
          <div className="nx-ur-choice" role="radiogroup" aria-label="Client access">
            <label className="nx-ur-choice__item">
              <input type="radio" name="client-mode" checked={mode === 'all'} onChange={() => setMode('all')} />
              <span>
                <strong>All clients</strong>
                <small>Every current client and every client you add later.</small>
              </span>
            </label>
            <label className="nx-ur-choice__item">
              <input type="radio" name="client-mode" checked={mode === 'selected'} onChange={() => setMode('selected')} />
              <span>
                <strong>Selected clients</strong>
                <small>Only the clients you tick below. New clients are not added automatically.</small>
              </span>
            </label>
          </div>
          {mode === 'selected' ? (
            <>
              <div className="nx-ur-search-row">
                <input
                  className="nx-ur-search"
                  placeholder="Search by name or ID"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span className="nx-ur-muted">{selected.size} selected</span>
              </div>
              <div className="nx-ur-list" role="group" aria-label="Clients">
                {visible.map((c) => (
                  <label key={c.client_id} className="nx-ur-list__row">
                    <input
                      type="checkbox"
                      checked={selected.has(c.client_id)}
                      onChange={() => setSelected((prev) => toggleSelected(prev, c.client_id))}
                    />
                    <span className="nx-ur-list__name">{c.display_name}</span>
                    <span className="nx-ur-list__meta">{c.tax_id ?? ''}</span>
                  </label>
                ))}
                {visible.length === 0 ? <div className="nx-ur-muted nx-ur-pad">No clients found.</div> : null}
              </div>
              {editor.catalog_truncated ? (
                <div className="nx-ur-muted">Showing the first clients only. Use search to narrow the list.</div>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </ModalShell>
  );
}

/* ----------------------------- Manage modules ----------------------------- */

export function MemberModulesModal(props: {
  orgId: string;
  member: UsersRolesMemberRow;
  onClose: () => void;
  onSaved: (aggregate: UsersRolesAggregate) => void;
}) {
  const [truth, setTruth] = useState<MemberModuleAssignabilityAggregate | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchMemberModuleAssignability(props.orgId, props.member.member_id)
      .then((agg) => {
        if (!alive) return;
        setTruth(agg);
        setChecked(initialModuleDraft(agg.modules));
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [props.orgId, props.member.member_id]);

  // Backend decides which modules are employee choices; nothing else is rendered.
  const assignable = (truth?.modules ?? []).filter((m) => m.member_assignable);

  const save = async () => {
    if (!truth) return;
    setBusy(true);
    setError('');
    try {
      const out = await setMemberModuleAccessCommand(
        props.orgId,
        props.member.member_id,
        buildModuleAccessPayload(truth.modules, checked),
      );
      props.onSaved(out.users_roles_aggregate);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Manage modules"
      subtitle={truth?.member_display_name ?? props.member.profile.display_name}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="nx-btn nx-ur-btn" disabled={busy} onClick={props.onClose}>
            Close
          </button>
          <button type="button" className="nx-btn nx-btn-primary nx-ur-btn" disabled={busy || !truth} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error ? <div className="nx-ur-error">{error}</div> : null}
      {!truth && !error ? <div className="nx-ur-muted">Loading…</div> : null}
      {truth ? (
        <>
          <p className="nx-ur-muted nx-ur-intro">Choose which areas of the system this employee can open.</p>
          <div className="nx-ur-list" role="group" aria-label="Modules">
            {assignable.map((m) => (
              <label key={m.module_id} className="nx-ur-list__row">
                <input
                  type="checkbox"
                  checked={checked.has(m.module_id)}
                  onChange={() => setChecked((prev) => toggleSelected(prev, m.module_id))}
                />
                <span className="nx-ur-list__name">{m.display_name}</span>
              </label>
            ))}
            {assignable.length === 0 ? (
              <div className="nx-ur-muted nx-ur-pad">No modules are available for employees yet.</div>
            ) : null}
          </div>
        </>
      ) : null}
    </ModalShell>
  );
}

/* ------------------------------ Close access ------------------------------ */

export function CloseAccessModal(props: {
  orgId: string;
  member: UsersRolesMemberRow;
  onClose: () => void;
  onClosed: (aggregate: UsersRolesAggregate) => void;
}) {
  const { member } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Counts are backend-owned (close_access.blockers); the command enforces the same rule.
  const blockerText = member.close_access ? describeCloseAccessBlockers(member.close_access.blockers) : null;
  const blocked = Boolean(member.close_access?.blocked);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      props.onClosed(await closeMemberAccessCommand(props.orgId, member.member_id));
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Close access"
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="nx-btn nx-ur-btn" disabled={busy} onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="nx-btn nx-ur-btn nx-ur-btn--danger"
            disabled={busy || blocked}
            onClick={confirm}
          >
            {busy ? 'Closing…' : 'Close access'}
          </button>
        </>
      }
    >
      {error ? <div className="nx-ur-error">{error}</div> : null}
      <p className="nx-ur-confirm-name">
        <strong>{member.profile.display_name}</strong>
        {member.profile.email && member.profile.email !== member.profile.display_name ? (
          <span className="nx-ur-muted"> · {member.profile.email}</span>
        ) : null}
      </p>
      {blocked && blockerText ? (
        <div className="nx-ur-warning">
          This employee still has {blockerText}. Reassign them first, then close access.
        </div>
      ) : (
        <p className="nx-ur-intro">
          This employee will no longer be able to sign in to the office. Their history, documents and past work stay
          exactly as they are.
        </p>
      )}
    </ModalShell>
  );
}
