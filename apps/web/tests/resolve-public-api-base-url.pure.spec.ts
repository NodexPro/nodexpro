import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PRODUCTION_PUBLIC_API_BASE,
  PRODUCTION_RENDER_API_ORIGIN,
  isLocalhostApiBaseUrl,
  resolvePublicApiBaseUrl,
} from '../src/lib/resolve-public-api-base-url.pure.ts';

const dir = dirname(fileURLToPath(import.meta.url));

test('production builds reject localhost and empty API URL', () => {
  assert.equal(isLocalhostApiBaseUrl('http://localhost:4000/api/v1'), true);
  assert.equal(isLocalhostApiBaseUrl('http://127.0.0.1:4000/api/v1'), true);
  assert.equal(isLocalhostApiBaseUrl('https://nodexpro.onrender.com/api/v1'), false);
  assert.equal(resolvePublicApiBaseUrl('http://localhost:4000/api/v1', true), PRODUCTION_PUBLIC_API_BASE);
  assert.equal(resolvePublicApiBaseUrl('', true), PRODUCTION_PUBLIC_API_BASE);
  assert.equal(resolvePublicApiBaseUrl(undefined, true), PRODUCTION_PUBLIC_API_BASE);
  assert.equal(resolvePublicApiBaseUrl('http://localhost:4000/api/v1', false), 'http://localhost:4000/api/v1');
  assert.equal(
    resolvePublicApiBaseUrl(PRODUCTION_RENDER_API_ORIGIN, true),
    PRODUCTION_RENDER_API_ORIGIN,
  );
});

test('client and Vite production config cannot bake localhost', () => {
  const client = readFileSync(join(dir, '../src/api/client.ts'), 'utf8');
  const vite = readFileSync(join(dir, '../vite.config.ts'), 'utf8');
  const vercel = readFileSync(join(dir, '../vercel.json'), 'utf8');
  assert.match(client, /resolvePublicApiBaseUrl/);
  assert.match(client, /import\.meta\.env\.PROD/);
  assert.doesNotMatch(client, /localhost:4000/);
  assert.match(vite, /PRODUCTION_PUBLIC_API_BASE/);
  assert.match(vite, /mode === 'production'/);
  assert.match(vercel, /https:\/\/nodexpro\.onrender\.com\/api\/v1\/\$1/);
});
