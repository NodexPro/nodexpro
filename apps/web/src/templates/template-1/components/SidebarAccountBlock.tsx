import { useEffect, useMemo, useRef, useState } from 'react';
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
  const languageSelectorVisible = block.language_selector?.visible !== false;
  const [languageOpen, setLanguageOpen] = useState(false);
  const languageFieldRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!languageOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!languageFieldRef.current?.contains(event.target as Node)) setLanguageOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLanguageOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [languageOpen]);
  const showLogout = block.logout_action?.visible !== false;
  const showOfficeContext = Boolean(block.office_context?.visible && block.office_context.name);
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

      {block.organization_name && !showOfficeContext ? (
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

      {languageSelectorVisible ? (
        <div
          className="t1-sidebar-account__field t1-sidebar-account__language"
          data-testid="sidebar-language-selector"
          ref={languageFieldRef}
        >
          <span className="t1-sidebar-account__label" id="t1-sidebar-language-label">
            {block.language_selector.label}
          </span>
          <button
            type="button"
            id="t1-sidebar-language-select"
            className="t1-sidebar-account__select t1-sidebar-account__language-trigger"
            disabled={busy}
            aria-haspopup="listbox"
            aria-expanded={languageOpen}
            aria-labelledby="t1-sidebar-language-label"
            onClick={() => setLanguageOpen((open) => !open)}
          >
            {block.language_selector.options.find((option) => option.value === block.language_selector.current_value)?.label ??
              block.language_selector.current_value}
          </button>
          {languageOpen ? (
            <ul className="t1-sidebar-account__language-menu" role="listbox" aria-labelledby="t1-sidebar-language-label">
              {block.language_selector.options.map((option) => {
                const selected = option.value === block.language_selector.current_value;
                return (
                  <li key={option.value} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`t1-sidebar-account__language-option${selected ? ' is-selected' : ''}`}
                      disabled={busy}
                      onClick={() => {
                        const code = option.value;
                        setLanguageOpen(false);
                        if (code !== 'en' && code !== 'he') return;
                        void onSetLanguage(code);
                      }}
                    >
                      {option.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="t1-sidebar-account__user" title={block.user_email}>
        {block.user_display_name}
      </div>

      {showLogout ? (
        <button
          type="button"
          className="t1-sidebar-account__logout nx-btn nx-btn-taxes-compact"
          disabled={busy}
          onClick={() => void onLogout()}
        >
          {block.logout_action.label}
        </button>
      ) : null}

      {showOfficeContext && block.office_context ? (
        <div className="t1-sidebar-account__office" data-testid="sidebar-office-context">
          <div className="t1-sidebar-account__office-label">{block.office_context.label}</div>
          <div className="t1-sidebar-account__office-name" title={block.office_context.name ?? undefined}>
            {block.office_context.name}
          </div>
        </div>
      ) : null}
    </div>
  );
}
