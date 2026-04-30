/** Light client-side expiry check (MM/YY or MM/YYYY as returned from API). Not a PCI boundary — same visible field as UI. */
export function isCardExpiryInPast(expiryRaw: string | null | undefined): boolean {
  const s = String(expiryRaw ?? '').trim();
  if (!s) return false;
  const m = s.match(/^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/);
  if (!m) return false;
  let mm = parseInt(m[1], 10);
  let yy = parseInt(m[2], 10);
  if (!Number.isFinite(mm) || !Number.isFinite(yy)) return false;
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12) return false;
  const lastDay = new Date(yy, mm, 0, 23, 59, 59, 999);
  return Date.now() > lastDay.getTime();
}
