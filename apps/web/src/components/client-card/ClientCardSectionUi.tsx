import React from 'react';

export const clientCardSectionStyle: React.CSSProperties = {
  marginBottom: 32,
  padding: 20,
  background: '#ffffff',
  borderRadius: 14,
  border: '1px solid #e5e7eb',
};

export const clientCardTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  margin: '0 0 16px 0',
  color: '#111827',
};

export const clientCardFieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 6,
  display: 'block',
};

export const clientCardFieldValueStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 400,
  color: '#111827',
  lineHeight: 1.5,
  wordBreak: 'break-word',
};

export const clientCardFieldValueMediumStyle: React.CSSProperties = {
  ...clientCardFieldValueStyle,
  fontWeight: 500,
};

export const clientCardFieldGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '20px 28px',
};

export const clientCardFormStackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxWidth: 440,
};

export const clientCardInputStyle: React.CSSProperties = {
  display: 'block',
  marginTop: 6,
  padding: '8px 12px',
  width: '100%',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  fontSize: 14,
  color: '#111827',
  boxSizing: 'border-box',
  background: '#ffffff',
};

export const clientCardSubsectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  margin: '16px 0 8px 0',
  color: '#111827',
};

export function ClientCardSection({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <section style={{ ...clientCardSectionStyle, ...style }}>{children}</section>;
}

export function ClientCardSectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={clientCardTitleStyle}>{children}</h2>;
}

export function ClientCardFieldGrid({ children }: { children: React.ReactNode }) {
  return <div style={clientCardFieldGridStyle}>{children}</div>;
}

export function ClientCardField({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <span style={clientCardFieldLabelStyle}>{label}</span>
      <div style={clientCardFieldValueStyle}>{children}</div>
    </div>
  );
}

export function ClientCardFieldMono({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <span style={clientCardFieldLabelStyle}>{label}</span>
      <div style={{ ...clientCardFieldValueStyle, fontFamily: 'monospace' }}>{children}</div>
    </div>
  );
}

export function ClientCardFormField({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', margin: 0 }}>
      <span style={clientCardFieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

export function ClientCardToolbarRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 18,
        marginBottom: 10,
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

export function ClientCardTableShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderTop: '1px solid #e5e7eb',
        marginTop: 6,
      }}
    >
      {children}
    </div>
  );
}

export const clientCardContactGridColumns: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1.4fr 1fr 1.4fr auto',
  columnGap: 20,
  alignItems: 'start',
};

export function ClientCardContactColumnHeader({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return <div style={{ ...clientCardFieldLabelStyle, marginBottom: 0, padding: '10px 0', ...style }}>{children}</div>;
}

export function ClientCardContactValueCell({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ padding: '12px 0', minWidth: 0, ...clientCardFieldValueStyle, ...style }}>{children}</div>
  );
}

export function ClientCardContactFormColumn({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span style={{ ...clientCardFieldLabelStyle, marginBottom: 6 }}>{label}</span>
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
  return <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px 0' }}>{children}</p>;
}

export const clientCardContactInputFocusProps = {
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = '#93c5fd';
    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(147,197,253,0.2)';
    e.currentTarget.style.outline = 'none';
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = '#d1d5db';
    e.currentTarget.style.boxShadow = 'none';
  },
};

export const clientCardContactInputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  fontSize: 13,
  color: '#111827',
  width: '100%',
  boxSizing: 'border-box',
};
