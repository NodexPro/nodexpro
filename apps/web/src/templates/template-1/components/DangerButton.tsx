import React from 'react';

export function DangerButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }
) {
  const { children, style, ...rest } = props;
  return (
    <button
      {...rest}
      style={{
        height: 36,
        padding: '0 14px',
        borderRadius: 10,
        border: 'none',
        background: '#FEF2F2',
        color: '#B91C1C',
        fontSize: 14,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        fontWeight: 500,
        ...(style ?? {}),
      }}
    >
      {children}
    </button>
  );
}

