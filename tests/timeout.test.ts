import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRedisForTests, resolveGatewayAuth, withTimeout, REDIS_TIMEOUT_MS } from "@/lib/config-store";
import { checkRateLimit } from "@/lib/ratelimit";

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
