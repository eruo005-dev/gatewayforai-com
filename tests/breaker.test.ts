import { describe, it, expect, beforeEach, vi } from "vitest";
import { FakeRedis } from "./fake-redis";
import { setRedisForTests } from "@/lib/config-store";
import { redisBreaker } from "@/lib/breaker";

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTests(redis as never);
});

describe("redisBreaker", () => {
  it("opens after 3 failures and closes on success", async () => {
    const b = redisBreaker("hash1");
    expect(await b.isOpen("openai")).toBe(false);
    await b.onFailure("openai");
    await b.onFailure("openai");
    expect(await b.isOpen("openai")).toBe(false);
    await b.onFailure("openai");
    expect(await b.isOpen("openai")).toBe(true);
    await b.onSuccess("openai");
    expect(await b.isOpen("openai")).toBe(false);
  });

  it("is scoped per provider and per keyHash", async () => {
    const b = redisBreaker("hash1");
    for (let i = 0; i < 3; i++) await b.onFailure("openai");
    expect(await b.isOpen("groq")).toBe(false);
    expect(await redisBreaker("hash2").isOpen("openai")).toBe(false);
  });

  it("onFailure increments atomically via redis.eval (INCRBY+EXPIRE, FIX 5)", async () => {
    const evalSpy = vi.spyOn(redis, "eval");
    await redisBreaker("hash1").onFailure("openai");
    expect(evalSpy).toHaveBeenCalledTimes(1);
    const script = evalSpy.mock.calls[0][0] as string;
    expect(script).toContain("INCRBY");
    expect(script).toContain("EXPIRE");
  });
});
