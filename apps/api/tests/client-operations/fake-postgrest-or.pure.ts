/**
 * PostgREST `or=` matcher for in-memory fakes.
 * Splits on commas outside parentheses so `client_id.is.null,client_id.in.(id1,id2)` stays intact.
 */
export function rowMatchesPostgrestOr(row: Record<string, unknown>, expr: string): boolean {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of expr) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(buf);
      buf = '';
    } else buf += ch;
  }
  if (buf) parts.push(buf);
  return parts.some((part) => {
    const p = part.trim();
    const isNull = p.match(/^(\w+)\.is\.null$/);
    if (isNull) return row[isNull[1]] == null;
    const inList = p.match(/^(\w+)\.in\.\(([^)]*)\)$/);
    if (inList) {
      const ids = inList[2]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return ids.includes(String(row[inList[1]] ?? ''));
    }
    const first = p.indexOf('.');
    const second = p.indexOf('.', first + 1);
    if (first < 0 || second < 0) return false;
    const col = p.slice(0, first);
    const val = p.slice(second + 1);
    return new RegExp(`^${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i').test(
      String(row[col] ?? ''),
    );
  });
}
