/** Minimal in-memory stand-in for @upstash/redis used by unit tests. */
export class FakeRedis {
  store = new Map<string, unknown>();
  hashes = new Map<string, Map<string, number>>();
  /** Records the TTL (seconds) last associated with each key, so tests can assert
   *  that a write/refresh attached an expiry. `set({ex})` and `expire()` both feed
   *  this map; the fake store itself does NOT evict on TTL (no wall-clock tracking). */
  ttls = new Map<string, number>();

  async get(k: string) { return this.store.get(k) ?? null; }
  async set(k: string, v: unknown, opts?: { ex?: number }) {
    this.store.set(k, v);
    if (opts?.ex !== undefined) this.ttls.set(k, opts.ex);
    return "OK";
  }
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) {
      this.ttls.delete(k);
      if (this.store.delete(k)) n++;
    }
    return n;
  }

  async incr(k: string) {
    const v = Number(this.store.get(k) ?? 0) + 1;
    this.store.set(k, v);
    return v;
  }

  async incrby(k: string, n: number) {
    const v = Number(this.store.get(k) ?? 0) + n;
    this.store.set(k, v);
    return v;
  }

  async hincrby(k: string, field: string, by: number) {
    const h = this.hashes.get(k) ?? new Map();
    h.set(field, (h.get(field) ?? 0) + by);
    this.hashes.set(k, h);
    return h.get(field)!;
  }
  async hgetall(k: string) {
    const h = this.hashes.get(k);
    return h && h.size ? Object.fromEntries(h) : null;
  }
  async expire(k: string, s: number) { this.ttls.set(k, s); return 1; }

  /**
   * Minimal `eval` supporting only the atomic INCRBY+EXPIRE script used by
   * recordTokens and breaker.onFailure. Recognizes the inline Lua we ship; any
   * other script throws so a drift in the script body is caught loudly in tests.
   * Signature mirrors @upstash/redis: eval(script, keys[], args[]).
   */
  async eval(script: string, keys: string[], args: (string | number)[]) {
    if (script.includes("INCRBY") && script.includes("EXPIRE")) {
      const key = keys[0];
      const n = Number(args[0]);
      const v = Number(this.store.get(key) ?? 0) + n;
      this.store.set(key, v);
      // EXPIRE is a no-op in the fake store (no TTL tracking), but we return the
      // post-increment value exactly like the real script does.
      return v;
    }
    throw new Error(`FakeRedis.eval: unrecognized script: ${script}`);
  }
}
