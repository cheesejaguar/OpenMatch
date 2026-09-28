/** Bounded TTL cache with shared in-flight loads and invalidation fencing. */
export class AsyncCache<K, V> {
  private entries = new Map<K, { promise: Promise<V>; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 256,
  ) {}

  clear(): void {
    this.entries.clear();
  }

  get(key: K, load: () => Promise<V>): Promise<V> {
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    const entry = { promise: Promise.resolve().then(load), expiresAt: Number.POSITIVE_INFINITY };
    this.entries.delete(key);
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, entry);
    entry.promise = entry.promise.then(
      (value) => {
        entry.expiresAt = Date.now() + this.ttlMs;
        return value;
      },
      (error: unknown) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      },
    );
    return entry.promise;
  }
}
