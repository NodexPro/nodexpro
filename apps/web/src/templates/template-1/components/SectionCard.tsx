import React from 'react';

export function SectionCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section className="t1-sectionCard" style={style}>
      {children}
    </section>
  );
}

