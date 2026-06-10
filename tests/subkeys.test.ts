import { describe, it, expect, beforeEach } from "vitest";
import { FakeRedis } from "./fake-redis";
import {
  setRedisForTests,
  createConfig,
  deleteConfig,
  createSubKey,
  listSubKeys,
  revokeSubKey,
  resolveGatewayAuth,
} from "@/lib/config-store";
import { sha256 } from "@/lib/crypto";

const PARENT_KEY = "gw_live_parenttest";
const INPUT = {
  providers: { openai: "sk-openai-test" },
  fallbackChain: [{ provider: "openai" as const, model: "gpt-4o" }],
  rateLimit: { rpm: 60, tpm: 50_000 },
};

let redis: FakeRedis;
beforeEach(async () => {
  redis = new FakeRedis();
  setRedisForTests(redis as never);
  await createConfig(PARENT_KEY, INPUT);
});

describe("createSubKey", () => {
  it("returns a gw_sub_ prefixed key", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "ci-bot" });
    expect(subKey).toMatch(/^gw_sub_/);
  });

  it("updates the parent subKeys index", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "ci-bot" });
    const parentHash = sha256(PARENT_KEY);
    // Find config entry in redis store
    const raw = redis.store.get(`config:${parentHash}`);
    const stored = JSON.parse(raw as string);
    const subHash = sha256(subKey!);
    expect(stored.subKeys).toBeDefined();
    expect(stored.subKeys[subHash]).toBeDefined();
    expect(stored.subKeys[subHash].label).toBe("ci-bot");
  });

  it("stores rpm/tpm overrides in index when provided", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "limited", rpm: 10, tpm: 5000 });
    const parentHash = sha256(PARENT_KEY);
    const raw = redis.store.get(`config:${parentHash}`);
    const stored = JSON.parse(raw as string);
    const subHash = sha256(subKey!);
    expect(stored.subKeys[subHash].rpm).toBe(10);
    expect(stored.subKeys[subHash].tpm).toBe(5000);
  });

  it("returns null for unknown parent", async () => {
    const result = await createSubKey("gw_live_unknown", { label: "test" });
    expect(result).toBeNull();
  });

  it("throws limit error on 21st sub-key", async () => {
    for (let i = 0; i < 20; i++) {
      await createSubKey(PARENT_KEY, { label: `bot-${i}` });
    }
    await expect(createSubKey(PARENT_KEY, { label: "too-many" })).rejects.toThrow(/limit/);
  });
});

describe("resolveGatewayAuth — sub-key path", () => {
  it("resolves sub-key to parent config", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "worker" });
    const auth = await resolveGatewayAuth(subKey!);
    expect(auth).not.toBeNull();
    expect(auth!.config.providers.openai).toBe("sk-openai-test");
  });

  it("sub-key keyHash differs from parent hash", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "worker" });
    const auth = await resolveGatewayAuth(subKey!);
    expect(auth!.keyHash).toBe(sha256(subKey!));
    expect(auth!.parentHash).toBe(sha256(PARENT_KEY));
    expect(auth!.keyHash).not.toBe(auth!.parentHash);
  });

  it("uses sub-key override limits when set", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "limited", rpm: 10, tpm: 5000 });
    const auth = await resolveGatewayAuth(subKey!);
    expect(auth!.limits.rpm).toBe(10);
    expect(auth!.limits.tpm).toBe(5000);
  });

  it("falls back to parent limits when no overrides", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "inherit" });
    const auth = await resolveGatewayAuth(subKey!);
    expect(auth!.limits.rpm).toBe(60);
    expect(auth!.limits.tpm).toBe(50_000);
  });

  it("returns null after revoke", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "temp" });
    const subHash = sha256(subKey!);
    await revokeSubKey(PARENT_KEY, subHash);
    expect(await resolveGatewayAuth(subKey!)).toBeNull();
  });

  it("returns null when parent config is deleted", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "orphan" });
    await deleteConfig(PARENT_KEY);
    expect(await resolveGatewayAuth(subKey!)).toBeNull();
  });
});

describe("resolveGatewayAuth — parent key path", () => {
  it("resolves parent key, keyHash equals parentHash", async () => {
    const auth = await resolveGatewayAuth(PARENT_KEY);
    expect(auth).not.toBeNull();
    expect(auth!.keyHash).toBe(sha256(PARENT_KEY));
    expect(auth!.parentHash).toBe(sha256(PARENT_KEY));
    expect(auth!.keyHash).toBe(auth!.parentHash);
  });

  it("limits come from config.rateLimit", async () => {
    const auth = await resolveGatewayAuth(PARENT_KEY);
    expect(auth!.limits.rpm).toBe(60);
    expect(auth!.limits.tpm).toBe(50_000);
  });

  it("returns null for unknown parent key", async () => {
    expect(await resolveGatewayAuth("gw_live_unknown")).toBeNull();
  });
});

describe("listSubKeys", () => {
  it("returns empty array when no sub-keys", async () => {
    const list = await listSubKeys(PARENT_KEY);
    expect(list).toEqual([]);
  });

  it("returns created sub-keys with label", async () => {
    await createSubKey(PARENT_KEY, { label: "alpha" });
    await createSubKey(PARENT_KEY, { label: "beta", rpm: 5 });
    const list = await listSubKeys(PARENT_KEY);
    expect(list).toHaveLength(2);
    const labels = list!.map((x) => x.label);
    expect(labels).toContain("alpha");
    expect(labels).toContain("beta");
  });

  it("returns null for unknown parent", async () => {
    expect(await listSubKeys("gw_live_unknown")).toBeNull();
  });
});

describe("revokeSubKey", () => {
  it("removes sub-key from parent index and kills resolution", async () => {
    const subKey = await createSubKey(PARENT_KEY, { label: "temp" });
    const subHash = sha256(subKey!);
    const result = await revokeSubKey(PARENT_KEY, subHash);
    expect(result).toBe(true);

    // No longer in list
    const list = await listSubKeys(PARENT_KEY);
    expect(list!.find((x) => x.keyHash === subHash)).toBeUndefined();
  });

  it("returns false for unknown subKeyHash", async () => {
    expect(await revokeSubKey(PARENT_KEY, "nonexistent")).toBe(false);
  });
});
