export function publicPasswordResetResponse(): { ok: true; requested: true } {
  return { ok: true, requested: true };
}

export function normalizePasswordResetEmail(raw: string | null | undefined): string {
  return String(raw ?? '').trim().toLowerCase();
}

export function allowedPasswordResetRedirect(input: {
  requested?: string | null;
  allowedOrigins: string[];
}): string {
  const origins = input.allowedOrigins
    .map((item) => String(item ?? '').trim().replace(/\/$/, ''))
    .filter((item) => /^https?:\/\//i.test(item));
  const fallbackOrigin = origins[0] ?? 'http://localhost:5173';
  const fallback = `${fallbackOrigin}/reset-password`;
  const raw = String(input.requested ?? '').trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (url.pathname !== '/reset-password') return fallback;
    if (url.username || url.password) return fallback;
    const origin = `${url.protocol}//${url.host}`;
    if (!origins.includes(origin)) return fallback;
    return `${origin}/reset-password`;
  } catch {
    return fallback;
  }
}
