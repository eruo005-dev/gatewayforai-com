import { describe, it, expect, beforeEach } from "vitest";
import { FakeRedis } from "./fake-redis";
import { setRedisForTests } from "@/lib/config-store";
import { cacheKeyFor, getCached, setCached } from "@/lib/cache";

const KEY_HASH = "abc123";

const BODY_A = {
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "hello" }],
  temperature: 0.7,
};

const BODY_B = {
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "different" }],
  temperature: 0.7,
};

let fakeRedis: FakeRedis;

beforeEach(() => {
  fakeRedis = new FakeRedis();
  setRedisForTests(fakeRedis as never);
});

describe("cacheKeyFor", () => {
  it("same body + same keyHash → same cache key", () => {
    const k1 = cacheKeyFor(KEY_HASH, BODY_A);
    const k2 = cacheKeyFor(KEY_HASH, BODY_A);
    expect(k1).toBe(k2);
  });

  it("different messages → different cache key", () => {
    const k1 = cacheKeyFor(KEY_HASH, BODY_A);
    const k2 = cacheKeyFor(KEY_HASH, BODY_B);
    expect(k1).not.toBe(k2);
  });

  it("different keyHash → different cache key", () => {
    const k1 = cacheKeyFor(KEY_HASH, BODY_A);
    const k2 = cacheKeyFor("other_hash", BODY_A);
    expect(k1).not.toBe(k2);
  });

  it("key starts with cache: prefix", () => {
    expect(cacheKeyFor(KEY_HASH, BODY_A)).toMatch(/^cache:/);
  });
});

describe("getCached / setCached round-trip", () => {
  it("returns null on miss", async () => {
    const result = await getCached("cache:missing");
    expect(result).toBeNull();
  });

  it("round-trips set then get", async () => {
    const key = cacheKeyFor(KEY_HASH, BODY_A);
    const value = { body: '{"id":"chatcmpl-1"}', provider: "openai" };
    await setCached(key, value, 60);
    const got = await getCached(key);
    expect(got).toEqual(value);
  });

  it("getCached handles Upstash string-or-object dual shape", async () => {
    const key = cacheKeyFor(KEY_HASH, BODY_A);
    const value = { body: '{"id":"chatcmpl-2"}', provider: "groq" };
    // Simulate Upstash auto-deserializing (object shape, not string)
    fakeRedis.store.set(key, value);
    const got = await getCached(key);
    expect(got).toEqual(value);
  });
});
