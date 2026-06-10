import { describe, it, expect, beforeEach } from "vitest";
import { FakeRedis } from "./fake-redis";
import {
  setRedisForTests, createConfig, getConfig, updateConfig, deleteConfig, rotateKey,
} from "@/lib/config-store";

const INPUT = {
  providers: { openai: "sk-openai-123", groq: "gsk-groq-456" },
  fallbackChain: [
    { provider: "openai" as const, model: "gpt-4o" },
    { provider: "groq" as const, model: "llama-3.3-70b-versatile" },
  ],
  rateLimit: { rpm: 60 },
};

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTests(redis as never);
});

describe("config-store", () => {
  it("creates and reads back a config with decrypted keys", async () => {
    await createConfig("gw_live_test1", INPUT);
    const cfg = await getConfig("gw_live_test1");
    expect(cfg?.providers.openai).toBe("sk-openai-123");
    expect(cfg?.fallbackChain).toHaveLength(2);
    expect(cfg?.rateLimit.rpm).toBe(60);
    expect(cfg?.createdAt).toBeTruthy();
  });

  it("never stores plaintext provider keys or the raw gateway key", async () => {
    await createConfig("gw_live_test1", INPUT);
    const dump = JSON.stringify([...redis.store.entries()]);
    expect(dump).not.toContain("sk-openai-123");
    expect(dump).not.toContain("gw_live_test1");
  });

  it("returns null for unknown keys", async () => {
    expect(await getConfig("gw_live_nope")).toBeNull();
  });

  it("patches: replaces a key, removes via null, updates chain + rpm", async () => {
    await createConfig("gw_live_test1", INPUT);
    const ok = await updateConfig("gw_live_test1", {
      providers: { openai: "sk-new", groq: null },
      fallbackChain: [{ provider: "openai", model: "gpt-4o-mini" }],
      rateLimit: { rpm: 120 },
    });
    expect(ok).toBe(true);
    const cfg = await getConfig("gw_live_test1");
    expect(cfg?.providers.openai).toBe("sk-new");
    expect(cfg?.providers.groq).toBeUndefined();
    expect(cfg?.fallbackChain[0].model).toBe("gpt-4o-mini");
    expect(cfg?.rateLimit.rpm).toBe(120);
  });

  it("updateConfig returns false for unknown key", async () => {
    expect(await updateConfig("gw_live_nope", { rateLimit: { rpm: 5 } })).toBe(false);
  });

  it("deletes a config", async () => {
    await createConfig("gw_live_test1", INPUT);
    expect(await deleteConfig("gw_live_test1")).toBe(true);
    expect(await getConfig("gw_live_test1")).toBeNull();
  });

  it("rotates: old key dead, new key works, data intact", async () => {
    await createConfig("gw_live_test1", INPUT);
    const newKey = await rotateKey("gw_live_test1");
    expect(newKey).toMatch(/^gw_live_/);
    expect(await getConfig("gw_live_test1")).toBeNull();
    expect((await getConfig(newKey!))?.providers.openai).toBe("sk-openai-123");
  });

  it("rotateKey returns null for unknown key", async () => {
    expect(await rotateKey("gw_live_nope")).toBeNull();
  });
});
