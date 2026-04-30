import { NavLink } from 'react-router-dom';

interface Item {
  to: string;
  label: string;
}

export function Sidebar({ items }: { items: Item[] }) {
  return (
    <aside style={{ width: 220, borderRight: '1px solid #eee', padding: 16 }}>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              padding: '8px 12px',
              borderRadius: 6,
              textDecoration: 'none',
              color: isActive ? '#0a0' : '#333',
              background: isActive ? '#eee' : 'transparent',
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
