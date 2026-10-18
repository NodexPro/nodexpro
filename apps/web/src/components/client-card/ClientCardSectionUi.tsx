import React from 'react';
import '../../styles/nx-glass-surface.css';
import '../../styles/nx-clients.css';

export const clientCardInputClass = 'nx-glass-input';
export const clientCardContactInputClass = 'nx-glass-input';
export const clientCardFormStackClass = 'nx-clients-form-stack';
export const clientCardSubsectionTitleClass = 'nx-clients-subhead';
export const clientCardContactGridClass = 'nx-clients-contact-grid';

export function ClientCardSection({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="nx-glass-card nx-clients-section" style={style}>
      {children}
    </section>
  );
}

export function ClientCardSectionTitle({ children }: { children: React.ReactNode }) {
  return <h2>{children}</h2>;
}

export function ClientCardFieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="nx-clients-field-grid">{children}</div>;
}

export function ClientCardField({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <span className="nx-clients-field-label">{label}</span>
      <div className="nx-clients-field-value">{children}</div>
    </div>
  );
}

export function ClientCardFieldMono({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <span className="nx-clients-field-label">{label}</span>
      <div className="nx-clients-field-value nx-clients-input--mono">{children}</div>
    </div>
  );
}

export function ClientCardFormField({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', margin: 0 }}>
      <span className="nx-clients-field-label">{label}</span>
      {children}
    </label>
  );
}

export function ClientCardToolbarRow({ children }: { children: React.ReactNode }) {
  return <div className="nx-clients-toolbar-row">{children}</div>;
}

export function ClientCardTableShell({ children }: { children: React.ReactNode }) {
  return <div className="nx-clients-table-shell">{children}</div>;
}

export function ClientCardContactColumnHeader({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="nx-clients-field-label" style={{ marginBottom: 0, padding: '10px 0', ...style }}>
      {children}
    </div>
  );
}

export function ClientCardContactValueCell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="nx-clients-field-value" style={{ padding: '12px 0', minWidth: 0, ...style }}>
      {children}
    </div>
  );
}

export function ClientCardContactFormColumn({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span className="nx-clients-field-label">{label}</span>
      {children}
    </div>
  );
}

export function ClientCardContactActionsCell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        gap: 8,
        padding: '12px 0',
        alignSelf: 'stretch',
      }}
    >
      {children}
    </div>
  );
}

export function ClientCardHint({ children }: { children: React.ReactNode }) {
  return <p className="nx-clients-hint">{children}</p>;
}
