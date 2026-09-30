/**
 * Process-local, bounded TTL cache with in-flight coalescing.
 *
 * Read-side optimization ONLY — never a source of truth.
 * - Failed builds are never cached (rejection clears the in-flight slot).
 * - `invalidateWhere` removes settled entries AND detaches in-flight builds, so a build that
 *   started before an invalidation is returned to its callers but never stored afterwards.
 * - Bounded: once `maxEntries` is exceeded the oldest settled entries are evicted first.
 * - Process-local: multi-instance deployments hold independent caches (TTL bounds staleness).
 */
export type BoundedTtlCacheOptions = {
  ttlMs: number;
  maxEntries: number;
  /** Injectable clock (tests). */
  now?: () => number;
};

export type BoundedTtlCacheSource = 'hit' | 'coalesced' | 'built';

type SettledEntry<V> = { value: V; expiresAt: number };
type InFlightEntry<V> = { promise: Promise<V> };

export class BoundedTtlCache<V> {
  private readonly settled = new Map<string, SettledEntry<V>>();
  private readonly inflight = new Map<string, InFlightEntry<V>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: BoundedTtlCacheOptions) {
    if (!(options.ttlMs > 0)) throw new Error('BoundedTtlCache: ttlMs must be > 0');
    if (!(options.maxEntries > 0)) throw new Error('BoundedTtlCache: maxEntries must be > 0');
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? (() => Date.now());
  }

  /** Settled, non-expired value (expired entries are dropped lazily). */
  peek(key: string): V | undefined {
    const entry = this.settled.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.settled.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    // Re-insert to keep Map insertion order == recency order.
    this.settled.delete(key);
    this.settled.set(key, { value, expiresAt: this.now() + this.ttlMs });
    this.evictOverflow();
  }

  /**
   * Return a fresh settled value, join an in-flight build for the same key, or start a build.
   * A build rejection propagates to every joined caller and nothing is cached.
   */
  getOrBuild(
    key: string,
    build: () => Promise<V>,
  ): Promise<{ value: V; source: BoundedTtlCacheSource }> {
    const hit = this.peek(key);
    if (hit !== undefined) return Promise.resolve({ value: hit, source: 'hit' });
    const joined = this.inflight.get(key);
    if (joined) return joined.promise.then((value) => ({ value, source: 'coalesced' }));

    // Register the slot BEFORE running the builder so a synchronous throw inside `build()`
    // still clears it in `finally` (otherwise a permanently rejected slot would be joined forever).
    const record: InFlightEntry<V> = { promise: Promise.resolve(undefined as unknown as V) };
    this.inflight.set(key, record);
    record.promise = (async () => {
      try {
        const value = await build();
        // Store only when this build is still the current one (not invalidated meanwhile).
        if (this.inflight.get(key) === record) this.set(key, value);
        return value;
      } finally {
        if (this.inflight.get(key) === record) this.inflight.delete(key);
      }
    })();
    return record.promise.then((value) => ({ value, source: 'built' }));
  }

  /** Remove settled + in-flight entries whose key matches. Returns removed count. */
  invalidateWhere(predicate: (key: string) => boolean): number {
    let removed = 0;
    for (const key of [...this.settled.keys()]) {
      if (predicate(key)) {
        this.settled.delete(key);
        removed += 1;
      }
    }
    for (const key of [...this.inflight.keys()]) {
      if (predicate(key)) {
        this.inflight.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  invalidateByPrefix(prefix: string): number {
    return this.invalidateWhere((key) => key.startsWith(prefix));
  }

  clear(): void {
    this.settled.clear();
    this.inflight.clear();
  }

  get size(): number {
    return this.settled.size;
  }

  get inflightSize(): number {
    return this.inflight.size;
  }

  private evictOverflow(): void {
    while (this.settled.size > this.maxEntries) {
      const oldest = this.settled.keys().next();
      if (oldest.done) break;
      this.settled.delete(oldest.value);
    }
  }
}
