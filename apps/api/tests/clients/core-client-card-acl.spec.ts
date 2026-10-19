/**
 * Core client card ACL: auth/org context must exist before :clientId param.
 * Source contract + Express order. No live Supabase.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router, type Request } from 'express';

const dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(dir, '../../../..');

function readRepo(rel: string): string {
  return readFileSync(join(repoRoot, rel), 'utf8');
}

async function listenFetch(
  app: express.Express,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('failed to bind test server');
  }
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test('Core clients mount auth/org on a parent router before :clientId param', () => {
  const routes = readRepo('apps/api/src/domains/clients/clients.routes.ts');
  const wrapIdx = routes.indexOf('clientsRoutes.use(authMiddleware, requireOrg, router)');
  const paramIdx = routes.indexOf("router.param('clientId'");
  assert.ok(wrapIdx >= 0, 'parent wrap with authMiddleware + requireOrg is required');
  assert.ok(paramIdx >= 0, 'canonical :clientId ACL remains');
  assert.match(routes, /export const clientsRoutes = Router\(\)/);
  assert.doesNotMatch(routes, /export const clientsRoutes = router\s*;/);
  const co = readRepo('apps/api/src/domains/client-operations/client-operations.routes.ts');
  assert.match(
    co,
    /clientOperationsModuleRouter\.use\(authMiddleware, requireOrg, requireModuleActive\(MODULE_CODE\), router\)/,
  );
});

test('createClient returns a canonical top-level id; card read is org-scoped', () => {
  const service = readRepo('apps/api/src/domains/clients/clients.service.ts');
  assert.match(service, /export async function createClient/);
  assert.match(service, /const canonicalId = String\(\(client as \{ id\?: unknown \}\)\.id \?\? ''\)\.trim\(\)/);
  assert.match(service, /return created/);
  assert.doesNotMatch(service.slice(service.indexOf('export async function createClient')), /setTimeout|sleep\(/);

  const card = readRepo('apps/api/src/domains/clients/client-card.service.ts');
  assert.match(card, /assertCanAccessClientFromContext\(ctx, clientId\)/);
  assert.match(card, /\.eq\('id', clientId\)\.eq\('organization_id', orgId\)/);
  assert.match(card, /throw forbidden\('Client not found'\)/);
});

test('Express param-before-route-auth is the broken order (403 without context)', async () => {
  const app = express();
  const router = Router();
  let sawContextInParam = false;
  router.param('clientId', (req, res, next) => {
    sawContextInParam = Boolean((req as Request & { context?: unknown }).context);
    if (!(req as Request & { context?: unknown }).context) {
      return res.status(403).json({ message: 'Organization context required' });
    }
    next();
  });
  router.get('/:id/clients/:clientId/full', (req, _res, next) => {
    (req as Request & { context?: { organizationId: string } }).context = { organizationId: 'org' };
    next();
  }, (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/v1/organizations', router);

  const out = await listenFetch(app, '/api/v1/organizations/org/clients/client-1/full');
  assert.equal(out.status, 403);
  assert.equal(sawContextInParam, false);
});

test('Parent auth then inner param has organization context (create → card order)', async () => {
  const app = express();
  const parent = Router();
  parent.use((req, _res, next) => {
    (req as Request & { context?: { organizationId: string } }).context = { organizationId: 'org' };
    next();
  });
  const inner = Router();
  let sawContextInParam = false;
  inner.param('clientId', (req, _res, next) => {
    sawContextInParam = Boolean((req as Request & { context?: { organizationId: string } }).context?.organizationId);
    next();
  });
  inner.get('/:id/clients/:clientId/full', (_req, res) => {
    res.json({ client: { id: 'client-1' } });
  });
  parent.use(inner);
  app.use('/api/v1/organizations', parent);

  const out = await listenFetch(app, '/api/v1/organizations/org/clients/client-1/full');
  assert.equal(out.status, 200);
  assert.equal(sawContextInParam, true);
  assert.deepEqual(out.body, { client: { id: 'client-1' } });
});
