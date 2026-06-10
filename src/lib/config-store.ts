import { Redis } from "@upstash/redis";
import { decrypt, encrypt, generateGatewayKey, sha256 } from "./crypto";
import type { ChainEntry, ConfigPatch, GatewayConfig, ProviderId } from "./types";

let _redis: Redis | null = null;

export function redis(): Redis {
  return (_redis ??= Redis.fromEnv());
}

export function setRedisForTests(r: Redis) {
  _redis = r;
}

const configKey = (hash: string) => `config:${hash}`;

interface StoredConfig {
  providers: Partial<Record<ProviderId, string>>; // ciphertext values
  fallbackChain: ChainEntry[];
  rateLimit: { rpm: number };
  createdAt: string;
}

async function loadStored(gatewayKey: string): Promise<StoredConfig | null> {
  const raw = await redis().get<string | StoredConfig>(configKey(sha256(gatewayKey)));
  if (!raw) return null;
  // Upstash auto-deserializes JSON values; handle both shapes.
  return typeof raw === "string" ? (JSON.parse(raw) as StoredConfig) : raw;
}

async function saveStored(gatewayKey: string, stored: StoredConfig): Promise<void> {
  await redis().set(configKey(sha256(gatewayKey)), JSON.stringify(stored));
}

export async function createConfig(
  gatewayKey: string,
  input: Omit<GatewayConfig, "createdAt">,
): Promise<void> {
  await saveStored(gatewayKey, {
    providers: Object.fromEntries(
      Object.entries(input.providers).map(([p, k]) => [p, encrypt(k as string)]),
    ),
    fallbackChain: input.fallbackChain,
    rateLimit: input.rateLimit,
    createdAt: new Date().toISOString(),
  });
}

export async function getConfig(gatewayKey: string): Promise<GatewayConfig | null> {
  const stored = await loadStored(gatewayKey);
  if (!stored) return null;
  return {
    ...stored,
    providers: Object.fromEntries(
      Object.entries(stored.providers).map(([p, ct]) => [p, decrypt(ct as string)]),
    ),
  };
}

export async function updateConfig(gatewayKey: string, patch: ConfigPatch): Promise<boolean> {
  const stored = await loadStored(gatewayKey);
  if (!stored) return false;
  if (patch.providers) {
    for (const [p, v] of Object.entries(patch.providers)) {
      if (v === null) delete stored.providers[p as ProviderId];
      else if (typeof v === "string") stored.providers[p as ProviderId] = encrypt(v);
    }
  }
  if (patch.fallbackChain) stored.fallbackChain = patch.fallbackChain;
  if (patch.rateLimit) stored.rateLimit = patch.rateLimit;
  await saveStored(gatewayKey, stored);
  return true;
}

export async function deleteConfig(gatewayKey: string): Promise<boolean> {
  return (await redis().del(configKey(sha256(gatewayKey)))) > 0;
}

/** Moves the stored record to a fresh gateway key. Returns the new key, or null if unknown. */
export async function rotateKey(oldKey: string): Promise<string | null> {
  const stored = await loadStored(oldKey);
  if (!stored) return null;
  const newKey = generateGatewayKey();
  await saveStored(newKey, stored);
  await redis().del(configKey(sha256(oldKey)));
  return newKey;
}
