import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRedisForTests, resolveGatewayAuth, withTimeout, REDIS_TIMEOUT_MS } from "@/lib/config-store";
import { checkRateLimit, checkGatewayIpLimit, checkIpLimit, _resetMemFallback } from "@/lib/ratelimit";

/**
 * Redis timeout + degradation policy (FIX 3).
 *
 * Strategy: inject a "hanging" redis whose ops return a never-resolving promise.
 * We then advance vitest fake timers past the timeout budget and assert the
 * fallback fired:
 *   - AUTH fails CLOSED  → resolveGatewayAuth returns null (→ 401 at the route).
 *   - RATE LIMIT fails OPEN → checkRateLimit returns success.
 */

/** A redis stand-in whose every method hangs forever. */
function hangingRedis() {
  const never = () => new Promise(() => {}); // never resolves
  return new Proxy(
    {},
    {
      get() {
        return never;
      },
    },
  ) as never;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("withTimeout", () => {
  it("resolves to onTimeout() when the promise hangs past the budget", async () => {
    const p = withTimeout(new Promise<string>(() => {}), 500, () => "fallback");
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toBe("fallback");
  });

  it("resolves to the real value when it arrives before the budget", async () => {
    const p = withTimeout(Promise.resolve("real"), 500, () => "fallback");
    // microtask flush — no timer advance needed
    expect(await p).toBe("real");
  });

  it("falls back when the underlying promise rejects", async () => {
    const p = withTimeout(Promise.reject(new Error("boom")), 500, () => "fb");
    expect(await p).toBe("fb");
  });
});

describe("resolveGatewayAuth — AUTH fails CLOSED on Redis timeout", () => {
  it("returns null within the timeout budget when redis.get hangs", async () => {
    setRedisForTests(hangingRedis());
    const promise = resolveGatewayAuth("gw_live_whatever");
    // Advance past the configured auth budget; the hanging GET should time out
    // and the fallback (null) must be returned — never hangs to the 25s upstream.
    await vi.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS + 10);
    expect(await promise).toBeNull();
  });

  it("returns null for a hanging sub-key lookup too", async () => {
    setRedisForTests(hangingRedis());
    const promise = resolveGatewayAuth("gw_sub_whatever");
    await vi.advanceTimersByTimeAsync(REDIS_TIMEOUT_MS + 10);
    expect(await promise).toBeNull();
  });
});

describe("checkRateLimit — RATE LIMIT fails OPEN on Redis timeout", () => {
  it("returns success=true when the limiter hangs", async () => {
    setRedisForTests(hangingRedis());
    const promise = checkRateLimit("hash1", 60);
    // Limiter timeout budget is 1500ms; advance past it.
    await vi.advanceTimersByTimeAsync(1600);
    const result = await promise;
    expect(result.success).toBe(true);
  });
});

/**
 * FIX 2 — in-memory brownout fallback for the IP-flood limiters.
 *
 * When Redis times out, checkGatewayIpLimit / checkIpLimit must NOT blindly
 * succeed forever; they consult a per-instance in-memory sliding counter that
 * eventually returns success=false once the generous bound is exceeded.
 *
 * Deterministic strategy: fire N concurrent limiter calls (all with the SAME ip),
 * then advance the fake clock ONCE past the 1500ms limiter budget. Every call's
 * timeout fires at ~the same Date.now(), so all N in-memory hits land inside the
 * 60s window. With the bound = B, the first B succeed and the (B+1)-th fails.
 */
describe("IP-flood limiters — in-memory fallback bounds on Redis timeout (FIX 2)", () => {
  beforeEach(() => _resetMemFallback());
  afterEach(() => _resetMemFallback());

  it("checkGatewayIpLimit: success until the 300/min bound is exceeded", async () => {
    setRedisForTests(hangingRedis());
    const BOUND = 300;
    // Fire BOUND + 1 concurrent calls for one IP.
    const calls = Array.from({ length: BOUND + 1 }, () => checkGatewayIpLimit("9.9.9.9"));
    await vi.advanceTimersByTimeAsync(1600); // trip every limiter timeout at once
    const results = await Promise.all(calls);
    const failures = results.filter((r) => !r.success);
    // Exactly one call (the (BOUND+1)-th hit) should be denied by the fallback.
    expect(failures).toHaveLength(1);
    expect(results.filter((r) => r.success)).toHaveLength(BOUND);
  });

  it("checkIpLimit: success until the 60/min bound is exceeded", async () => {
    setRedisForTests(hangingRedis());
    const BOUND = 60;
    const calls = Array.from({ length: BOUND + 1 }, () => checkIpLimit("7.7.7.7"));
    await vi.advanceTimersByTimeAsync(1600);
    const results = await Promise.all(calls);
    expect(results.filter((r) => !r.success)).toHaveLength(1);
    expect(results.filter((r) => r.success)).toHaveLength(BOUND);
  });

  it("a fresh IP starts allowed (separate in-memory bucket)", async () => {
    setRedisForTests(hangingRedis());
    const one = checkIpLimit("a.a.a.a");
    await vi.advanceTimersByTimeAsync(1600);
    expect((await one).success).toBe(true);
  });
});
