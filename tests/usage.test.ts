import { describe, it, expect, beforeEach } from "vitest";
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
});
