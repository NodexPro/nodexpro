export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, lineHeight: 1.2, color: '#111827' }}>{title}</h1>
      {subtitle && (
        <p style={{ margin: '8px 0 0', fontSize: 15, fontWeight: 400, color: '#6B7280' }}>{subtitle}</p>
      )}
    </div>
  );
}

