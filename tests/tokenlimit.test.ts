import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeRedis } from "./fake-redis";
import { setRedisForTests } from "@/lib/config-store";
import { checkTokenLimit, recordTokens } from "@/lib/ratelimit";

let redis: FakeRedis;
const NOW = 1_700_000_000_000; // fixed timestamp for deterministic tests

beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTests(redis as never);
});

describe("checkTokenLimit", () => {
  it("returns success=true when no tokens have been recorded", async () => {
    const result = await checkTokenLimit("hash1", 1000, NOW);
    expect(result.success).toBe(true);
  });

  it("returns success=false when spent >= tpm", async () => {
    await recordTokens("hash1", 600, NOW);
    await recordTokens("hash1", 500, NOW);
    const result = await checkTokenLimit("hash1", 1000, NOW);
    expect(result.success).toBe(false);
  });

  it("accumulates across multiple recordTokens calls", async () => {
    await recordTokens("hash1", 300, NOW);
    expect((await checkTokenLimit("hash1", 1000, NOW)).success).toBe(true);
    await recordTokens("hash1", 300, NOW);
    expect((await checkTokenLimit("hash1", 1000, NOW)).success).toBe(true);
    await recordTokens("hash1", 401, NOW);
    // 300 + 300 + 401 = 1001 >= 1000 → false
    expect((await checkTokenLimit("hash1", 1000, NOW)).success).toBe(false);
  });

  it("includes previous minute bucket in total (conservative sliding)", async () => {
    const prevMinute = NOW - 60_000;
    await recordTokens("hash1", 800, prevMinute);
    // Only 100 in current minute, but 800 from prev → 900 < 1000 → still passes
    await recordTokens("hash1", 100, NOW);
    expect((await checkTokenLimit("hash1", 1000, NOW)).success).toBe(true);
    // Add 100 more → 800 + 200 = 1000 → false
    await recordTokens("hash1", 100, NOW);
    expect((await checkTokenLimit("hash1", 1000, NOW)).success).toBe(false);
  });

  it("separate keyHashes are independent", async () => {
    await recordTokens("hash1", 900, NOW);
    await recordTokens("hash2", 100, NOW);
    expect((await checkTokenLimit("hash1", 1000, NOW)).success).toBe(true);
    expect((await checkTokenLimit("hash2", 1000, NOW)).success).toBe(true);
    await recordTokens("hash1", 100, NOW);
    // hash1 at 1000, hash2 at 100
    expect((await checkTokenLimit("hash1", 1000, NOW)).success).toBe(false);
    expect((await checkTokenLimit("hash2", 1000, NOW)).success).toBe(true);
  });

  it("reset is start of next minute in epoch ms", async () => {
    const result = await checkTokenLimit("hash1", 1000, NOW);
    const expectedReset = (Math.floor(NOW / 60_000) + 1) * 60_000;
    expect(result.reset).toBe(expectedReset);
  });
});

describe("recordTokens — in-flight reservation + reconciliation (FIX 4)", () => {
  it("a reservation is reflected in checkTokenLimit before reconciliation", async () => {
    // Reserve the estimate up front — a concurrent checkTokenLimit must see it.
    await recordTokens("hashR", 950, NOW);
    expect((await checkTokenLimit("hashR", 1000, NOW)).success).toBe(true);
    await recordTokens("hashR", 50, NOW); // pushes to 1000
    expect((await checkTokenLimit("hashR", 1000, NOW)).success).toBe(false);
  });

  it("reconciles with a NEGATIVE delta when actual < estimate", async () => {
    // Reserve 800, then reconcile down by 300 (actual was 500). Net = 500.
    await recordTokens("hashD", 800, NOW);
    await recordTokens("hashD", -300, NOW);
    // 500 < 1000 → still passes; prove the bucket actually dropped.
    expect((await checkTokenLimit("hashD", 600, NOW)).success).toBe(true);
    expect((await checkTokenLimit("hashD", 500, NOW)).success).toBe(false); // 500 >= 500
  });

  it("a full refund (−estimate) bills 0 for a failed request", async () => {
    await recordTokens("hashF", 400, NOW); // reservation
    await recordTokens("hashF", -400, NOW); // refund (upstream failed)
    // Net 0 → a 1-token limit still passes.
    expect((await checkTokenLimit("hashF", 1, NOW)).success).toBe(true);
  });
});

describe("recordTokens — atomic INCRBY+EXPIRE (FIX 5)", () => {
  it("uses redis.eval (single round-trip), not separate incrby+expire", async () => {
    const evalSpy = vi.spyOn(redis, "eval");
    await recordTokens("hashE", 123, NOW);
    expect(evalSpy).toHaveBeenCalledTimes(1);
    // The script must carry both the INCRBY and the EXPIRE.
    const script = evalSpy.mock.calls[0][0] as string;
    expect(script).toContain("INCRBY");
    expect(script).toContain("EXPIRE");
  });
});
