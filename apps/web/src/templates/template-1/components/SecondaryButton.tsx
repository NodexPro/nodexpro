import React from 'react';

export function SecondaryButton(
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
        border: '1px solid #D1D5DB',
        background: '#FFFFFF',
        color: '#111827',
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

