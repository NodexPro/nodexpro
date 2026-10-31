/**
 * Trusted first-visit country signal from Vercel. Presentation only.
 * Never overwrites an explicit nx-lang preference.
 */
export const config = {
  matcher: ['/', '/login', '/register', '/forgot-password', '/reset-password', '/index.html'],
};

export default function middleware(request) {
  const country = String(request.headers.get('x-vercel-ip-country') || '')
    .trim()
    .toUpperCase();
  const cookies = request.headers.get('cookie') || '';
  const hasLang = /(?:^|;\s*)nx-lang=/.test(cookies);
  const headers = new Headers({
    'x-middleware-next': '1',
  });
  if (!hasLang && /^[A-Z]{2}$/.test(country)) {
    headers.append(
      'Set-Cookie',
      `nx-geo-country=${country}; Path=/; Max-Age=2592000; SameSite=Lax`,
    );
  }
  return new Response(null, { headers });
}
