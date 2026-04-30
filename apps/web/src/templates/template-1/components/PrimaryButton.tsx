import React from 'react';

export function PrimaryButton(
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
        background: 'var(--t1-primary-gradient)',
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: 500,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        ...(style ?? {}),
      }}
    >
      {children}
    </button>
  );
}

