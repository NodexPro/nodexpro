import { NavLink, Outlet, useLocation } from 'react-router-dom';
import './owner-modules/nx-owner-modules.css';

const NAV = [
  { to: '/platform-owner/legal-control', label: 'Legal Control', end: true },
  { to: '/platform-owner/modules', label: 'Modules', end: false },
  { to: '/platform-owner/legal-control?section=system', label: 'System', end: true },
  { to: '/platform-owner/legal-control?section=clients', label: 'Clients', end: true },
  {
    to: '/platform-owner/legal-control?section=invoice_document_builder',
    label: 'Invoice Document Builder',
    end: true,
  },
] as const;

function navActive(pathname: string, search: string, item: (typeof NAV)[number]): boolean {
  if (item.to.startsWith('/platform-owner/modules')) {
    return pathname.startsWith('/platform-owner/modules');
  }
  if (!pathname.startsWith('/platform-owner/legal-control')) return false;
  const section = new URLSearchParams(search).get('section');
  if (item.to.includes('section=system')) return section === 'system';
  if (item.to.includes('section=clients')) return section === 'clients';
  if (item.to.includes('section=invoice_document_builder')) return section === 'invoice_document_builder';
  return !section || section === 'legal';
}

export function PlatformOwnerShell() {
  const location = useLocation();
  return (
    <div className="nx-owner-shell">
      <aside className="nx-owner-shell__sidebar" aria-label="Platform Owner">
        <div className="nx-owner-shell__brand">NodexPro Owner</div>
        <nav className="nx-owner-shell__nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={() =>
                `nx-owner-shell__nav-link${navActive(location.pathname, location.search, item) ? ' is-active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="nx-owner-shell__main">
        <Outlet />
      </main>
    </div>
  );
}
