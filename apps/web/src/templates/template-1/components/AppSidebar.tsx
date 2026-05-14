import React, { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { Template1SidebarItem } from '../TemplateLayout';
import logoSrc from '../assets/nodexpro-logo.png';

type SidebarMode = 'default' | 'collapsedHover';

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

export function AppSidebar({ items, mode = 'default' }: { items: Template1SidebarItem[]; mode?: SidebarMode }) {
  const [expanded, setExpanded] = useState(false);

  const showExpanded = mode !== 'collapsedHover' ? true : expanded;
  const width = mode === 'collapsedHover' ? (showExpanded ? 240 : 64) : 240;

  const itemsWithIcons = useMemo(() => {
    return items.map((i) => ({ ...i, icon: iconForNavItem(i.to, i.label) }));
  }, [items]);

  return (
    <aside
      onMouseEnter={() => mode === 'collapsedHover' && setExpanded(true)}
      onMouseLeave={() => mode === 'collapsedHover' && setExpanded(false)}
      style={{
        width,
        background: '#FFFFFF',
        borderRight: '1px solid #E5E7EB',
        padding: showExpanded ? 16 : 10,
        transition: 'width 160ms ease, padding 160ms ease',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: showExpanded ? 10 : 0,
          padding: showExpanded ? '4px 8px 16px 8px' : '4px 0 16px 0',
          justifyContent: showExpanded ? 'flex-start' : 'center',
        }}
      >
        <img src={logoSrc} alt="NodexPro" style={{ width: 42, height: 42, display: 'block' }} />
        {showExpanded && (
          <div style={{ fontSize: 18, fontWeight: 600, color: '#111827', lineHeight: 1 }}>
            NodexPro
          </div>
        )}
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {itemsWithIcons.map((item) => (
          <React.Fragment key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/modules'}
              style={({ isActive }) => ({
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
              })}
            >
              <span aria-hidden="true" style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}>
                {item.icon}
              </span>
              {showExpanded && <span style={{ marginLeft: 8 }}>{item.label}</span>}
            </NavLink>
            {showExpanded &&
              item.children?.map((child) => (
                <NavLink
                  key={child.to}
                  to={child.to}
                  style={({ isActive }) => ({
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
                  })}
                >
                  <span aria-hidden="true" style={{ width: 22, display: 'inline-flex', justifyContent: 'center' }}>
                    {iconForLabel(child.label)}
                  </span>
                  <span style={{ marginLeft: 8 }}>{child.label}</span>
                </NavLink>
              ))}
          </React.Fragment>
        ))}
      </nav>
    </aside>
  );
}

