# Cloudflare WAF for NodexPro

This is configuration, not a claim that WAF is live. Protection is inactive until DNS, origin routing, managed rules and Owner verification are done.

Cover both:

- `https://www.nodexpro.com` (Vercel)
- `https://nodexpro.onrender.com` (Render API)

Direct API origin bypass is addressed only after `CLOUDFLARE_ORIGIN_PROTECTION=true` and `CLOUDFLARE_ORIGIN_PULL_SECRET` match a Cloudflare Transform header.

## Managed rules

Enable Cloudflare Free/Pro WAF managed ruleset, OWASP Core, and Bot Fight / Super Bot Fight on both hostnames.

Suggested custom rate rules (challenge, do not block the whole office):

- `/api/v1/auth/login` — 40 req / 10 min / IP, managed challenge
- `/api/v1/auth/*mfa*` and password recovery — 20 req / 15 min / IP, managed challenge
- `/api/v1/**/invites*` — 15 req / 10 min / IP
- Other `/api/v1/**` — 240 req / 1 min / IP

Never create an automatic block rule on a shared office NAT.

## Authenticated origin pull

1. Cloudflare → Rules → Transform Rules → add request header `x-nodexpro-origin-secret` = the same value as Render `CLOUDFLARE_ORIGIN_PULL_SECRET`.
2. Point `api.nodexpro.com` (or the current API hostname) through Cloudflare orange-cloud.
3. Set Render `CLOUDFLARE_ORIGIN_PROTECTION=true`.
4. Confirm `GET /api/v1/health` still works from Render health checks.
5. Confirm a request that skips Cloudflare is rejected.
6. Only then set `EDGE_PROTECTION_VERIFIED=true`.
