import React, { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { Template1SidebarItem } from '../TemplateLayout';
import type { SidebarAccountBlockModel } from '../../../types/session';
import { SidebarAccountBlock } from './SidebarAccountBlock';
import logoSrc from '../assets/nodexpro-logo.png';
import '../t1-sidebar-account.css';

type SidebarMode = 'default' | 'collapsedHover';
type SidebarAppearance = 'default' | 'co-navy-glass';

function iconForNavItem(to: string, label: string): string {
  if (to.includes('/work-engine')) return '📋';
  return iconForLabel(label);
}

function iconForLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('docflow') || l.includes('chat') || l.includes('צ׳אט') || l.includes('צאט')) return '💬';
  if (l.includes('dashboard')) return '📊';
  if (l.includes('settings')) return '⚙️';
  if (l.includes('users')) return '👥';
  if (l.includes('clients')) return '🗂️';
  if (l.includes('documents')) return '📄';
  if (l.includes('nodex') || l.includes('operations') || l.includes('client operations')) return '🧾';
  if (l.includes('modules')) return '🧩';
  if (l.includes('billing')) return '💳';
  return '•';
}

/**
 * CO navy-glass appearance only: monochrome `currentColor` line glyphs so the
 * approved icon colors (#A9C9EE / #7DECF7 / #FFFFFF) apply exactly. Same nav
 * mapping as the emoji set — presentation only; emoji stays for other modules.
 */
const CO_GLYPH_PATHS: Record<string, React.ReactNode> = {
  '🧾': (
    <>
      <path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6-2.4-1.6z" />
      <path d="M9 8.5h6M9 12h6M9 15.5h4" />
    </>
  ),
  '📊': (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-5M12 16V6M17 16v-8" />
    </>
  ),
  '⚙️': (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </>
  ),
  '👥': (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.8a3 3 0 0 1 0 5.4M17 14.2a5.5 5.5 0 0 1 3.5 4.8" />
    </>
  ),
  '🗂️': (
    <>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
      <path d="M3.5 11h17" />
    </>
  ),
  '📄': (
    <>
      <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20z" />
      <path d="M14 3.5v4h4M9.5 13h5M9.5 16.5h5" />
    </>
  ),
  '🧩': (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </>
  ),
  '💳': (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17M7 14.5h3" />
    </>
  ),
  '📋': (
    <>
      <rect x="5.5" y="5" width="13" height="15.5" rx="1.5" />
      <path d="M9 5V3.8A.8.8 0 0 1 9.8 3h4.4a.8.8 0 0 1 .8.8V5M9 11h6M9 14.5h6" />
    </>
  ),
  '💬': (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 3.5V16A2.5 2.5 0 0 1 4 13.5z" />
      <path d="M8.5 9.5h7M8.5 12.5h4.5" />
    </>
  ),
  // Row-action glyphs (Users & Roles) — same 24 / 1.7 / round language as the navigation set.
  edit: (
    <>
      <path d="M4.5 19.5l.9-4L16.4 4.5a2.1 2.1 0 0 1 3 3L8.4 18.6z" />
      <path d="M14.6 6.3l3 3" />
    </>
  ),
  close_access: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16.5 10.5h5" />
    </>
  ),
};

/** Glyph keys for Users & Roles row actions — clients/modules are the EXISTING sidebar glyphs (no duplicates). */
export const ROW_ACTION_GLYPH = {
  edit: 'edit',
  clients: '🗂️',
  modules: '🧩',
  close_access: 'close_access',
} as const;

/** Canonical line glyph (also reused for Users & Roles row actions): 24 viewBox, 20px, stroke 1.7, round. */
export function CoNavGlyph({ icon, className = 't1-sidebar__glyph' }: { icon: string; className?: string }) {
  const paths = CO_GLYPH_PATHS[icon];
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths ?? <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />}
    </svg>
  );
}

export function AppSidebar({
  items,
  mode = 'default',
  appearance = 'default',
  accountBlock,
  accountBusy = false,
  onSelectOrganization,
  onSetLanguage,
  onLogout,
}: {
  items: Template1SidebarItem[];
  mode?: SidebarMode;
  /** Presentation-only: navy glass when Client Operations module is active. */
  appearance?: SidebarAppearance;
  accountBlock: SidebarAccountBlockModel;
  accountBusy?: boolean;
  onSelectOrganization: (organizationId: string) => void | Promise<void>;
  onSetLanguage: (languageCode: 'en' | 'he') => void | Promise<void>;
  onLogout: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const coGlass = appearance === 'co-navy-glass';

  const showExpanded = mode !== 'collapsedHover' ? true : expanded;
  const width = mode === 'collapsedHover' ? (showExpanded ? 240 : 64) : 240;

  const itemsWithIcons = useMemo(() => {
    return items.map((i) => ({ ...i, icon: iconForNavItem(i.to, i.label) }));
  }, [items]);

  return (
    <aside
      className="t1-sidebar"
      onMouseEnter={() => mode === 'collapsedHover' && setExpanded(true)}
      onMouseLeave={() => mode === 'collapsedHover' && setExpanded(false)}
      style={{
        width,
        padding: showExpanded ? 16 : 10,
        transition: 'width 160ms ease, padding 160ms ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: showExpanded ? 10 : 0,
          padding: showExpanded ? '4px 8px 12px 8px' : '4px 0 12px 0',
          justifyContent: showExpanded ? 'flex-start' : 'center',
          flexShrink: 0,
        }}
      >
        <img
          src={logoSrc}
          alt="NodexPro"
          style={{
            width: 42,
            height: 42,
            display: 'block',
            objectFit: 'contain',
            flexShrink: 0,
          }}
        />
        {showExpanded ? (
          <div
            className={coGlass ? 't1-sidebar__brand-name' : undefined}
            style={{ fontSize: 18, fontWeight: 600, color: coGlass ? undefined : '#111827', lineHeight: 1 }}
          >
            NodexPro
          </div>
        ) : null}
      </div>

      <nav className="t1-sidebar__nav" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {itemsWithIcons.map((item) => (
          <React.Fragment key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/modules'}
              className={({ isActive }) =>
                coGlass ? `t1-sidebar__link${isActive ? ' is-active' : ''}` : undefined
              }
              style={({ isActive }) =>
                coGlass
                  ? {
                      padding: showExpanded ? '0 12px' : '0 0',
                      justifyContent: showExpanded ? 'flex-start' : 'center',
                    }
                  : {
                      height: 40,
                      display: 'flex',
                      alignItems: 'center',
                      padding: showExpanded ? '0 12px' : '0 0',
                      borderRadius: 10,
                      textDecoration: 'none',
                      color: '#111827',
                      fontWeight: isActive ? 600 : 500,
                      background: isActive ? 'rgba(59,130,246,0.10)' : 'transparent',
                      border: '1px solid ' + (isActive ? 'rgba(59,130,246,0.20)' : 'transparent'),
                      transition: 'background 120ms ease',
                      justifyContent: showExpanded ? 'flex-start' : 'center',
                    }
              }
            >
              <span
                aria-hidden="true"
                className={coGlass ? 't1-sidebar__icon' : undefined}
                style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}
              >
                {coGlass ? <CoNavGlyph icon={item.icon} /> : item.icon}
              </span>
              {showExpanded && <span style={{ marginLeft: 8 }}>{item.label}</span>}
            </NavLink>
            {showExpanded &&
              item.children?.map((child) => (
                <NavLink
                  key={child.to}
                  to={child.to}
                  className={({ isActive }) =>
                    coGlass
                      ? `t1-sidebar__link t1-sidebar__link-child${isActive ? ' is-active' : ''}`
                      : undefined
                  }
                  style={({ isActive }) =>
                    coGlass
                      ? { padding: '0 12px 0 36px' }
                      : {
                          height: 36,
                          display: 'flex',
                          alignItems: 'center',
                          padding: '0 12px 0 36px',
                          borderRadius: 10,
                          textDecoration: 'none',
                          color: '#374151',
                          fontSize: 14,
                          fontWeight: isActive ? 600 : 500,
                          background: isActive ? 'rgba(59,130,246,0.08)' : 'transparent',
                          border: '1px solid ' + (isActive ? 'rgba(59,130,246,0.15)' : 'transparent'),
                        }
                  }
                >
                  <span
                    aria-hidden="true"
                    className={coGlass ? 't1-sidebar__icon' : undefined}
                    style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}
                  >
                    {coGlass ? <CoNavGlyph icon={iconForLabel(child.label)} /> : iconForLabel(child.label)}
                  </span>
                  <span style={{ marginLeft: 8 }}>{child.label}</span>
                </NavLink>
              ))}
          </React.Fragment>
        ))}
      </nav>

      <SidebarAccountBlock
        block={accountBlock}
        expanded={showExpanded}
        busy={accountBusy}
        onSelectOrganization={onSelectOrganization}
        onSetLanguage={onSetLanguage}
        onLogout={onLogout}
      />
    </aside>
  );
}
