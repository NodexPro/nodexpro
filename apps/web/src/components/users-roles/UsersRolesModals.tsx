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
  fillCount,
  filterCatalogClients,
  initialModuleDraft,
  toggleSelected,
  uiText,
  type UsersRolesUi,
} from './users-roles-selection.pure';
import './UsersRoles.css';

/**
 * Every modal receives `ui` from the Users & Roles aggregate that opened it: same language, same
 * direction, same backend text. The modals never decide a language themselves.
 */

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

function ModalShell(props: {
  ui: UsersRolesUi;
  title: string;
  subtitle?: string;
  busy: boolean;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="nx-ur-overlay"
      role="presentation"
      dir={props.ui.direction}
      lang={props.ui.locale}
      onClick={() => !props.busy && props.onClose()}
    >
      <div className="nx-ur-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="nx-ur-modal__header">
          <div>
            <h2 className="nx-ur-modal__title">{props.title}</h2>
            {props.subtitle ? <div className="nx-ur-modal__subtitle">{props.subtitle}</div> : null}
          </div>
          <button
            type="button"
            className="nx-ur-modal__close"
            aria-label={uiText(props.ui, 'close')}
            disabled={props.busy}
            onClick={props.onClose}
          >
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
  ui: UsersRolesUi;
  onClose: () => void;
  onSaved: (aggregate: UsersRolesAggregate) => void;
}) {
  const { member, ui } = props;
  const t = (key: string) => uiText(ui, key);
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
      setError(errorText(e, t('something_went_wrong')));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      ui={ui}
      title={t('edit_details')}
      subtitle={member.profile.email ?? undefined}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="nx-btn nx-btn-secondary nx-ur-btn" disabled={busy} onClick={props.onClose}>
            {t('close')}
          </button>
          <button type="button" className="nx-btn nx-btn-primary nx-ur-btn" disabled={busy} onClick={save}>
            {busy ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      {error ? <div className="nx-ur-error">{error}</div> : null}
      <div className="nx-ur-form-grid">
        <label className="nx-ur-field">
          <span>{t('first_name')}</span>
          <input value={first} maxLength={80} onChange={(e) => setFirst(e.target.value)} />
        </label>
        <label className="nx-ur-field">
          <span>{t('last_name')}</span>
          <input value={last} maxLength={80} onChange={(e) => setLast(e.target.value)} />
        </label>
        <label className="nx-ur-field nx-ur-field--wide">
          <span>{t('phone')}</span>
          <input
            className="nx-ur-input-ltr"
            dir="ltr"
            value={phone}
            maxLength={32}
            inputMode="tel"
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
      </div>
    </ModalShell>
  );
}

/* ----------------------------- Manage clients ----------------------------- */

export function MemberClientsModal(props: {
  orgId: string;
  member: UsersRolesMemberRow;
  ui: UsersRolesUi;
  onClose: () => void;
  onSaved: (aggregate: UsersRolesAggregate) => void;
}) {
  const { ui } = props;
  const t = (key: string) => uiText(ui, key);
  const failedText = t('something_went_wrong');
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
      .catch((e) => alive && setError(errorText(e, failedText)));
    return () => {
      alive = false;
    };
  }, [props.orgId, props.member.member_id, failedText]);

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
      setError(errorText(e, t('something_went_wrong')));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      ui={ui}
      title={t('manage_clients')}
      subtitle={editor?.member.display_name ?? props.member.profile.display_name}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="nx-btn nx-btn-secondary nx-ur-btn" disabled={busy} onClick={props.onClose}>
            {t('close')}
          </button>
          <button type="button" className="nx-btn nx-btn-primary nx-ur-btn" disabled={busy || !editor} onClick={save}>
            {busy ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      {error ? <div className="nx-ur-error">{error}</div> : null}
      {!editor && !error ? <div className="nx-ur-muted">{t('loading')}</div> : null}
      {editor ? (
        <>
          <div className="nx-ur-choice" role="radiogroup" aria-label={t('client_access_label')}>
            <label className="nx-ur-choice__item">
              <input type="radio" name="client-mode" checked={mode === 'all'} onChange={() => setMode('all')} />
              <span>
                <strong>{t('all_clients')}</strong>
                <small>{t('all_clients_hint')}</small>
              </span>
            </label>
            <label className="nx-ur-choice__item">
              <input type="radio" name="client-mode" checked={mode === 'selected'} onChange={() => setMode('selected')} />
              <span>
                <strong>{t('selected_clients')}</strong>
                <small>{t('selected_clients_hint')}</small>
              </span>
            </label>
          </div>
          {mode === 'selected' ? (
            <>
              <div className="nx-ur-search-row">
                <input
                  className="nx-ur-search"
                  placeholder={t('search_placeholder')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span className="nx-ur-muted">{fillCount(t('selected_count'), selected.size)}</span>
              </div>
              <div className="nx-ur-list" role="group" aria-label={t('clients_list_label')}>
                {visible.map((c) => (
                  <label key={c.client_id} className="nx-ur-list__row">
                    <input
                      type="checkbox"
                      checked={selected.has(c.client_id)}
                      onChange={() => setSelected((prev) => toggleSelected(prev, c.client_id))}
                    />
                    <span className="nx-ur-list__name">{c.display_name}</span>
                    <span className="nx-ur-list__meta nx-ur-ltr">{c.tax_id ?? ''}</span>
                  </label>
                ))}
                {visible.length === 0 ? <div className="nx-ur-muted nx-ur-pad">{t('no_clients_found')}</div> : null}
              </div>
              {editor.catalog_truncated ? <div className="nx-ur-muted">{t('catalog_truncated')}</div> : null}
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
  ui: UsersRolesUi;
  onClose: () => void;
  onSaved: (aggregate: UsersRolesAggregate) => void;
}) {
  const { ui } = props;
  const t = (key: string) => uiText(ui, key);
  const failedText = t('something_went_wrong');
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
      .catch((e) => alive && setError(errorText(e, failedText)));
    return () => {
      alive = false;
    };
  }, [props.orgId, props.member.member_id, failedText]);

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
      setError(errorText(e, t('something_went_wrong')));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      ui={ui}
      title={t('manage_modules')}
      subtitle={truth?.member_display_name ?? props.member.profile.display_name}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="nx-btn nx-btn-secondary nx-ur-btn" disabled={busy} onClick={props.onClose}>
            {t('close')}
          </button>
          <button type="button" className="nx-btn nx-btn-primary nx-ur-btn" disabled={busy || !truth} onClick={save}>
            {busy ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      {error ? <div className="nx-ur-error">{error}</div> : null}
      {!truth && !error ? <div className="nx-ur-muted">{t('loading')}</div> : null}
      {truth ? (
        <>
          <p className="nx-ur-muted nx-ur-intro">{t('modules_intro')}</p>
          <div className="nx-ur-list" role="group" aria-label={t('modules_list_label')}>
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
            {assignable.length === 0 ? <div className="nx-ur-muted nx-ur-pad">{t('no_modules_available')}</div> : null}
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
  ui: UsersRolesUi;
  onClose: () => void;
  onClosed: (aggregate: UsersRolesAggregate) => void;
}) {
  const { member, ui } = props;
  const t = (key: string) => uiText(ui, key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Blocker state and its sentence are backend-owned (close_access); the command enforces the same rule.
  const blockerMessage = member.close_access?.message ?? null;
  const blocked = Boolean(member.close_access?.blocked);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      props.onClosed(await closeMemberAccessCommand(props.orgId, member.member_id));
    } catch (e) {
      setError(errorText(e, t('something_went_wrong')));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      ui={ui}
      title={t('close_access')}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <button type="button" className="nx-btn nx-btn-secondary nx-ur-btn" disabled={busy} onClick={props.onClose}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="nx-btn nx-ur-btn nx-ur-btn--danger"
            disabled={busy || blocked}
            onClick={confirm}
          >
            {busy ? t('closing') : t('close_access')}
          </button>
        </>
      }
    >
      {error ? <div className="nx-ur-error">{error}</div> : null}
      <p className="nx-ur-confirm-name">
        <strong>{member.profile.display_name}</strong>
        {member.profile.email && member.profile.email !== member.profile.display_name ? (
          <span className="nx-ur-muted nx-ur-ltr"> · {member.profile.email}</span>
        ) : null}
      </p>
      {blocked && blockerMessage ? (
        <div className="nx-ur-warning">{blockerMessage}</div>
      ) : (
        <p className="nx-ur-intro">{t('close_access_intro')}</p>
      )}
    </ModalShell>
  );
}
