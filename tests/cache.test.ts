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

  it("differs by response_format → different cache key", () => {
    const k1 = cacheKeyFor(KEY_HASH, { ...BODY_A, response_format: { type: "json_object" } });
    const k2 = cacheKeyFor(KEY_HASH, { ...BODY_A, response_format: { type: "text" } });
    expect(k1).not.toBe(k2);
  });

  it("differs by stop → different cache key", () => {
    const k1 = cacheKeyFor(KEY_HASH, { ...BODY_A, stop: ["END"] });
    const k2 = cacheKeyFor(KEY_HASH, { ...BODY_A, stop: ["STOP"] });
    expect(k1).not.toBe(k2);
  });

  it("differs by seed → different cache key", () => {
    const k1 = cacheKeyFor(KEY_HASH, { ...BODY_A, seed: 1 });
    const k2 = cacheKeyFor(KEY_HASH, { ...BODY_A, seed: 2 });
    expect(k1).not.toBe(k2);
  });

  it("differs by model → different cache key (HIGH 12)", () => {
    // Two bodies identical except `model`. Kills a mutation that drops "model"
    // from CACHE_FIELDS — both would then hash to the same key and a gpt-4o
    // request could be served a gpt-4o-mini cached response.
    const k1 = cacheKeyFor(KEY_HASH, { ...BODY_A, model: "openai/gpt-4o" });
    const k2 = cacheKeyFor(KEY_HASH, { ...BODY_A, model: "openai/gpt-4o-mini" });
    expect(k1).not.toBe(k2);
  });

  // ── Cache-key completeness (Class 3) ───────────────────────────────────────
  // EVERY output-affecting OpenAI parameter must change the key, or two requests
  // that differ only in that param would collide and serve a poisoned response.
  // This parametrized test fails if ANY field is dropped from CACHE_FIELDS.
  describe("every output-affecting param changes the cache key", () => {
    const OUTPUT_AFFECTING: Array<[string, unknown, unknown]> = [
      ["temperature", 0.1, 0.9],
      ["top_p", 0.1, 0.95],
      ["max_tokens", 16, 4096],
      ["stop", ["END"], ["STOP"]],
      ["seed", 1, 2],
      ["response_format", { type: "json_object" }, { type: "text" }],
      ["frequency_penalty", 0, 1.5],
      ["presence_penalty", 0, 1.5],
      ["logit_bias", { "1": -100 }, { "2": 50 }],
      ["n", 1, 3],
      ["tools", [{ type: "function", function: { name: "a" } }], [{ type: "function", function: { name: "b" } }]],
      ["tool_choice", "auto", "required"],
      ["model", "openai/gpt-4o", "openai/gpt-4o-mini"],
    ];
    for (const [field, a, b] of OUTPUT_AFFECTING) {
      it(`differs by ${field}`, () => {
        const k1 = cacheKeyFor(KEY_HASH, { ...BODY_A, [field]: a });
        const k2 = cacheKeyFor(KEY_HASH, { ...BODY_A, [field]: b });
        expect(k1).not.toBe(k2);
      });
    }

    it("messages content change → different key", () => {
      const k1 = cacheKeyFor(KEY_HASH, { ...BODY_A, messages: [{ role: "user", content: "a" }] });
      const k2 = cacheKeyFor(KEY_HASH, { ...BODY_A, messages: [{ role: "user", content: "b" }] });
      expect(k1).not.toBe(k2);
    });

    it("a NON-output param (`user`) does NOT change the key — allowlist is tight", () => {
      const k1 = cacheKeyFor(KEY_HASH, { ...BODY_A, user: "alice" });
      const k2 = cacheKeyFor(KEY_HASH, { ...BODY_A, user: "bob" });
      const base = cacheKeyFor(KEY_HASH, BODY_A);
      expect(k1).toBe(k2);
      expect(k1).toBe(base);
    });

    it("a __proto__ key in the body cannot collide distinct bodies (only allowlisted fields hash)", () => {
      const k1 = cacheKeyFor(KEY_HASH, JSON.parse('{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"__proto__":{"a":1}}'));
      const k2 = cacheKeyFor(KEY_HASH, JSON.parse('{"model":"openai/gpt-4o","messages":[{"role":"user","content":"x"}],"__proto__":{"a":2}}'));
      // __proto__ is not in CACHE_FIELDS so it is ignored — same allowlisted
      // content → same key (the extra junk doesn't break or poison anything).
      expect(k1).toBe(k2);
    });
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
