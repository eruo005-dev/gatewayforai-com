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
   * Minimal chainable pipeline mirroring @upstash/redis: queued commands run in
   * order on `.exec()`, which resolves to an array of their results (one per
   * queued command, same order). Only the ops actually pipelined in the app are
   * implemented (get, expire); add more as needed. Commands run sequentially
   * against this same in-memory store — good enough for unit assertions.
   */
  pipeline() {
    const ops: Array<() => Promise<unknown>> = [];
    const chain = {
      get: (k: string) => { ops.push(() => this.get(k)); return chain; },
      expire: (k: string, s: number) => { ops.push(() => this.expire(k, s)); return chain; },
      set: (k: string, v: unknown, opts?: { ex?: number }) => { ops.push(() => this.set(k, v, opts)); return chain; },
      del: (...keys: string[]) => { ops.push(() => this.del(...keys)); return chain; },
      exec: async () => {
        const out: unknown[] = [];
        for (const op of ops) out.push(await op());
        return out;
      },
    };
    return chain;
  }

  /**
   * Minimal `eval` supporting only the atomic INCRBY+EXPIRE script used by
   * recordTokens and breaker.onFailure. Recognizes the inline Lua we ship; any
   * other script throws so a drift in the script body is caught loudly in tests.
   * Signature mirrors @upstash/redis: eval(script, keys[], args[]).
   */
  async eval(script: string, keys: string[], args: (string | number)[]) {
    // ── atomic rotate: GET old → SET new (with EX) → DEL old ──
    if (script.includes("GET") && script.includes("SET") && script.includes("DEL")) {
      const [oldKey, newKey] = keys;
      const v = this.store.get(oldKey);
      if (v === undefined || v === null) return false; // missing → caller maps to null
      const ttl = Number(args[0]);
      this.store.set(newKey, v);
      this.ttls.set(newKey, ttl);
      this.ttls.delete(oldKey);
      this.store.delete(oldKey);
      return v;
    }
    // ── atomic usage: HINCRBY pairs from ARGV[2..] then EXPIRE(ARGV[1]) ──
    if (script.includes("HINCRBY") && script.includes("EXPIRE")) {
      const key = keys[0];
      const ttl = Number(args[0]);
      const h = this.hashes.get(key) ?? new Map<string, number>();
      for (let i = 1; i < args.length; i += 2) {
        const field = String(args[i]);
        const by = Number(args[i + 1]);
        h.set(field, (h.get(field) ?? 0) + by);
      }
      this.hashes.set(key, h);
      this.ttls.set(key, ttl);
      return 1;
    }
    // ── atomic INCRBY + EXPIRE (token buckets, breaker counters) ──
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
