import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeRedis } from "./fake-redis";
import { setRedisForTests } from "@/lib/config-store";
import { recordUsage, getUsage } from "@/lib/usage";

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTests(redis as never);
});

describe("usage", () => {
  it("increments requests, provider, fallbacks and errors", async () => {
    await recordUsage("hash1", { provider: "openai" }, "2026-06-10");
    await recordUsage("hash1", { provider: "groq", fallbacks: 1 }, "2026-06-10");
    await recordUsage("hash1", { error: true }, "2026-06-10");
    const days = await getUsage("hash1", ["2026-06-10"]);
    expect(days[0]).toMatchObject({
      date: "2026-06-10",
      requests: 3,
      errors: 1,
      fallbacks: 1,
      "provider:openai": 1,
      "provider:groq": 1,
    });
  });

  it("returns zeroed rows for days with no traffic", async () => {
    const days = await getUsage("hash1", ["2026-06-09", "2026-06-10"]);
    expect(days).toHaveLength(2);
    expect(days[0].requests).toBe(0);
  });

  it("coalesces all increments + the EXPIRE into ONE atomic eval (atomic path)", async () => {
    const evalSpy = vi.spyOn(redis, "eval");
    // A request with provider + error + fallbacks → 4 HINCRBYs + 1 EXPIRE, but
    // exactly ONE round-trip via eval (not 5 sequential ops).
    await recordUsage("hashA", { provider: "openai", error: true, fallbacks: 2 }, "2026-06-11");
    expect(evalSpy).toHaveBeenCalledTimes(1);
    const script = evalSpy.mock.calls[0][0] as string;
    expect(script).toContain("HINCRBY");
    expect(script).toContain("EXPIRE");
    // Behavior is preserved: the same fields are incremented as the old path.
    const days = await getUsage("hashA", ["2026-06-11"]);
    expect(days[0]).toMatchObject({
      requests: 1,
      errors: 1,
      fallbacks: 2,
      "provider:openai": 1,
    });
  });
});
