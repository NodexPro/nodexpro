import { useMemo } from 'react';
import type { SidebarAccountBlockModel } from '../../../types/session';

function initialsFromDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  const one = parts[0] ?? name;
  return one.slice(0, 2).toUpperCase();
}

export function SidebarAccountBlock(props: {
  block: SidebarAccountBlockModel;
  expanded: boolean;
  onSelectOrganization: (organizationId: string) => void | Promise<void>;
  onSetLanguage: (languageCode: 'en' | 'he') => void | Promise<void>;
  onLogout: () => void | Promise<void>;
  busy?: boolean;
}) {
  const { block, expanded, onSelectOrganization, onSetLanguage, onLogout, busy = false } = props;
  const initials = useMemo(() => initialsFromDisplayName(block.user_display_name), [block.user_display_name]);

  if (!expanded) {
    return (
      <div className="t1-sidebar-account t1-sidebar-account--compact" title={block.user_display_name}>
        <button
          type="button"
          className="t1-sidebar-account__avatar"
          aria-label={block.user_display_name}
          disabled={busy}
        >
          {initials}
        </button>
      </div>
    );
  }

  return (
    <div className="t1-sidebar-account" aria-label="Account">
      <div className="t1-sidebar-account__divider" role="presentation" />

      {block.organization_name ? (
        <div className="t1-sidebar-account__org-name" title={block.organization_name}>
          {block.organization_name}
        </div>
      ) : null}

      {block.organization_switcher.visible ? (
        <div className="t1-sidebar-account__field">
          <label className="t1-sidebar-account__label" htmlFor="t1-sidebar-org-select">
            {block.organization_switcher.label}
          </label>
          <select
            id="t1-sidebar-org-select"
            className="t1-sidebar-account__select"
            disabled={busy}
            value={block.organization_switcher.organizations.find((o) => o.selected)?.organization_id ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              void onSelectOrganization(id);
            }}
          >
            {block.organization_switcher.organizations.map((o) => (
              <option key={o.organization_id} value={o.organization_id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="t1-sidebar-account__user" title={block.user_email}>
        {block.user_display_name}
      </div>

      <div className="t1-sidebar-account__field">
        <label className="t1-sidebar-account__label" htmlFor="t1-sidebar-lang-select">
          {block.language_selector.label}
        </label>
        <select
          id="t1-sidebar-lang-select"
          className="t1-sidebar-account__select"
          disabled={busy}
          value={block.language_selector.current_value}
          onChange={(e) => {
            const v = e.target.value === 'he' ? 'he' : 'en';
            void onSetLanguage(v);
          }}
        >
          {block.language_selector.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="t1-sidebar-account__logout nx-btn nx-btn-taxes-compact"
        disabled={busy}
        onClick={() => void onLogout()}
      >
        {block.logout_action.label}
      </button>
    </div>
  );
}
