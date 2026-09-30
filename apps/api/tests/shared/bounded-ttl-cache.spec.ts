/**
 * BoundedTtlCache — process-local TTL cache with in-flight coalescing.
 * Read-side optimization only: TTL expiry, bounded size, failed builds never cached,
 * invalidation detaches in-flight builds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedTtlCache } from '../../src/shared/bounded-ttl-cache.js';

function fakeClock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

test('miss builds once; subsequent reads within TTL are hits (no rebuild)', async () => {
  const clock = fakeClock();
  const cache = new BoundedTtlCache<string>({ ttlMs: 10_000, maxEntries: 10, now: clock.now });
  let builds = 0;
  const build = async () => `v${++builds}`;
  const first = await cache.getOrBuild('k', build);
  assert.equal(first.source, 'built');
  assert.equal(first.value, 'v1');
  clock.advance(3_000);
  const second = await cache.getOrBuild('k', build);
  assert.equal(second.source, 'hit');
  assert.equal(second.value, 'v1');
  clock.advance(3_000);
  const third = await cache.getOrBuild('k', build);
  assert.equal(third.source, 'hit');
  assert.equal(builds, 1);
});

test('after TTL the entry expires and is rebuilt', async () => {
  const clock = fakeClock();
  const cache = new BoundedTtlCache<string>({ ttlMs: 10_000, maxEntries: 10, now: clock.now });
  let builds = 0;
  const build = async () => `v${++builds}`;
  await cache.getOrBuild('k', build);
  clock.advance(9_999);
  assert.equal((await cache.getOrBuild('k', build)).source, 'hit');
  clock.advance(1);
  const rebuilt = await cache.getOrBuild('k', build);
  assert.equal(rebuilt.source, 'built');
  assert.equal(rebuilt.value, 'v2');
  assert.equal(builds, 2);
});

test('different keys never share values', async () => {
  const cache = new BoundedTtlCache<string>({ ttlMs: 10_000, maxEntries: 10 });
  let builds = 0;
  const a = await cache.getOrBuild('a', async () => `a${++builds}`);
  const b = await cache.getOrBuild('b', async () => `b${++builds}`);
  assert.equal(a.value, 'a1');
  assert.equal(b.value, 'b2');
  assert.equal(builds, 2);
});

test('concurrent callers for the same key coalesce into one build', async () => {
  const cache = new BoundedTtlCache<number>({ ttlMs: 10_000, maxEntries: 10 });
  let builds = 0;
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const build = async () => {
    builds += 1;
    await gate;
    return 42;
  };
  const p1 = cache.getOrBuild('k', build);
  const p2 = cache.getOrBuild('k', build);
  const p3 = cache.getOrBuild('k', build);
  assert.equal(cache.inflightSize, 1);
  release!();
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(builds, 1);
  assert.equal(r1.source, 'built');
  assert.equal(r2.source, 'coalesced');
  assert.equal(r3.source, 'coalesced');
  assert.deepEqual([r1.value, r2.value, r3.value], [42, 42, 42]);
  assert.equal(cache.inflightSize, 0);
  assert.equal(cache.size, 1);
});

test('failed build is not cached and propagates to all joined callers; next call rebuilds', async () => {
  const cache = new BoundedTtlCache<string>({ ttlMs: 10_000, maxEntries: 10 });
  let builds = 0;
  const failing = async () => {
    builds += 1;
    throw new Error('db down');
  };
  const p1 = cache.getOrBuild('k', failing);
  const p2 = cache.getOrBuild('k', failing);
  await assert.rejects(p1, /db down/);
  await assert.rejects(p2, /db down/);
  assert.equal(builds, 1);
  assert.equal(cache.size, 0);
  assert.equal(cache.inflightSize, 0);
  const ok = await cache.getOrBuild('k', async () => 'recovered');
  assert.equal(ok.source, 'built');
  assert.equal(ok.value, 'recovered');
});

test('synchronous throw inside build is treated like a rejection (nothing cached)', async () => {
  const cache = new BoundedTtlCache<string>({ ttlMs: 10_000, maxEntries: 10 });
  await assert.rejects(
    cache.getOrBuild('k', () => {
      throw new Error('sync boom');
    }),
    /sync boom/,
  );
  assert.equal(cache.size, 0);
  assert.equal(cache.inflightSize, 0);
});

test('invalidateByPrefix drops settled entries only for that prefix', async () => {
  const cache = new BoundedTtlCache<string>({ ttlMs: 10_000, maxEntries: 10 });
  await cache.getOrBuild('orgA|x', async () => 'ax');
  await cache.getOrBuild('orgA|y', async () => 'ay');
  await cache.getOrBuild('orgB|x', async () => 'bx');
  assert.equal(cache.invalidateByPrefix('orgA|'), 2);
  assert.equal(cache.peek('orgA|x'), undefined);
  assert.equal(cache.peek('orgA|y'), undefined);
  assert.equal(cache.peek('orgB|x'), 'bx');
});

test('invalidation during an in-flight build: callers get the value but it is NOT stored', async () => {
  const cache = new BoundedTtlCache<string>({ ttlMs: 10_000, maxEntries: 10 });
  let release: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = cache.getOrBuild('org|k', async () => {
    await gate;
    return 'pre-mutation rows';
  });
  // A write happens while the read is still building.
  assert.equal(cache.invalidateByPrefix('org|'), 1);
  release!();
  const resolved = await pending;
  assert.equal(resolved.value, 'pre-mutation rows');
  assert.equal(cache.peek('org|k'), undefined, 'stale build must not be stored after invalidation');
  const next = await cache.getOrBuild('org|k', async () => 'post-mutation rows');
  assert.equal(next.source, 'built');
  assert.equal(next.value, 'post-mutation rows');
});

test('bounded: oldest entries are evicted once maxEntries is exceeded', async () => {
  const cache = new BoundedTtlCache<number>({ ttlMs: 10_000, maxEntries: 3 });
  for (let i = 1; i <= 5; i += 1) {
    await cache.getOrBuild(`k${i}`, async () => i);
  }
  assert.equal(cache.size, 3);
  assert.equal(cache.peek('k1'), undefined);
  assert.equal(cache.peek('k2'), undefined);
  assert.equal(cache.peek('k3'), 3);
  assert.equal(cache.peek('k5'), 5);
});

test('constructor rejects non-positive ttl / size', () => {
  assert.throws(() => new BoundedTtlCache<number>({ ttlMs: 0, maxEntries: 1 }));
  assert.throws(() => new BoundedTtlCache<number>({ ttlMs: 1, maxEntries: 0 }));
});
