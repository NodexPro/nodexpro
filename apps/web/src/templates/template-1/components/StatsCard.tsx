export function StatsCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, border: '1px solid #E5E7EB', background: '#FFFFFF' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
        {label}
      </div>
      <div style={{ marginTop: 8, fontSize: 26, fontWeight: 700, color: '#111827', lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

