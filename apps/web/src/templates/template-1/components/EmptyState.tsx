import React from 'react';

export function EmptyState({
  title,
  description,
  cta,
}: {
  title: string;
  description?: string;
  cta?: React.ReactNode;
}) {
  return (
    <div
      className="t1-emptyState"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{title}</div>
      {description && <div style={{ fontSize: 14, color: '#6B7280', fontWeight: 400, maxWidth: 520 }}>{description}</div>}
      {cta}
    </div>
  );
}

