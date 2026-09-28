import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncCache } from "../src/lib/async-cache.js";

describe("AsyncCache", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces concurrent misses and starts TTL after completion", async () => {
    vi.useFakeTimers();
    const cache = new AsyncCache<string, string>(100);
    let resolve!: (value: string) => void;
    const load = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const first = cache.get("key", load);
    const second = cache.get("key", load);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    resolve("value");
    expect(await first).toBe("value");
    expect(await second).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get("key", load)).toBe("value");
    await vi.advanceTimersByTimeAsync(101);
    expect(await cache.get("key", async () => "fresh")).toBe("fresh");
  });

  it("does not let an old load repopulate or evict a newer entry after invalidation", async () => {
    const cache = new AsyncCache<string, string>(1000);
    let reject!: (error: Error) => void;
    const old = cache.get(
      "key",
      () =>
        new Promise<string>((_, fail) => {
          reject = fail;
        }),
    );
    await Promise.resolve();
    cache.clear();
    expect(await cache.get("key", async () => "new")).toBe("new");
    reject(new Error("old failure"));
    await expect(old).rejects.toThrow("old failure");
    expect(await cache.get("key", async () => "wrong")).toBe("new");
  });

  it("retries rejected loads and evicts entries at capacity", async () => {
    const cache = new AsyncCache<string, string>(1000, 1);
    await expect(
      cache.get("a", async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow();
    expect(await cache.get("a", async () => "recovered")).toBe("recovered");
    await cache.get("b", async () => "b");
    expect(await cache.get("a", async () => "reloaded")).toBe("reloaded");
  });
});
