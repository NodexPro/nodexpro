import React from 'react';

export function StatusBadge({
  variant,
  children,
}: {
  variant: 'active' | 'inactive' | 'archived' | 'trial' | 'uploaded' | 'pending' | 'completed' | 'warning';
  children: React.ReactNode;
}) {
  let bg = '#F3F4F6';
  let color = '#374151';
  if (variant === 'active') {
    bg = 'rgba(5,150,105,0.12)';
    color = '#059669';
  } else if (variant === 'inactive') {
    bg = 'rgba(156,163,175,0.18)';
    color = '#6B7280';
  } else if (variant === 'archived') {
    bg = 'rgba(107,114,128,0.18)';
    color = '#6B7280';
  } else if (variant === 'pending') {
    bg = 'rgba(37,99,235,0.12)';
    color = '#2563EB';
  } else if (variant === 'warning') {
    bg = 'rgba(217,119,6,0.12)';
    color = '#D97706';
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '6px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

