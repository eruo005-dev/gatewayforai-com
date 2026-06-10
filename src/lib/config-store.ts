import { Redis } from "@upstash/redis";
import { decrypt, encrypt, generateGatewayKey, generateSubKey, sha256 } from "./crypto";
import type { ChainEntry, ConfigPatch, GatewayConfig, ProviderId } from "./types";

/** Wraps decrypt so crypto details never reach HTTP callers. */
function safeDecrypt(ct: string): string {
  try {
    return decrypt(ct);
  } catch {
    throw new Error("config record corrupt");
  }
}

let _redis: Redis | null = null;

export function redis(): Redis {
  // Supports both naming schemes: UPSTASH_REDIS_REST_* (direct Upstash) and
  // KV_REST_API_* (injected by the Vercel marketplace Upstash integration).
  return (_redis ??= new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "",
    token: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "",
  }));
}

export function setRedisForTests(r: Redis) {
  _redis = r;
}

const configKey = (hash: string) => `config:${hash}`;
const subkeyKey = (hash: string) => `subkey:${hash}`;

const SUB_KEY_LIMIT = 20;

interface SubKeyRecord {
  parentHash: string;
  label: string;
  rpm?: number;
  tpm?: number;
  createdAt: string;
}

interface SubKeyIndex {
  label: string;
  rpm?: number;
  tpm?: number;
  createdAt: string;
}

interface StoredConfig {
  providers: Partial<Record<ProviderId, string>>; // ciphertext values
  fallbackChain: ChainEntry[];
  rateLimit: { rpm: number; tpm?: number };
  createdAt: string;
  subKeys?: Record<string, SubKeyIndex>; // key = sub-key hash
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function loadStoredByHash(hash: string): Promise<StoredConfig | null> {
  const raw = await redis().get<string | StoredConfig>(configKey(hash));
  if (!raw) return null;
  return typeof raw === "string" ? (JSON.parse(raw) as StoredConfig) : raw;
}

async function saveStoredByHash(hash: string, stored: StoredConfig): Promise<void> {
  await redis().set(configKey(hash), JSON.stringify(stored));
}

async function loadStored(gatewayKey: string): Promise<StoredConfig | null> {
  return loadStoredByHash(sha256(gatewayKey));
}

async function saveStored(gatewayKey: string, stored: StoredConfig): Promise<void> {
  await saveStoredByHash(sha256(gatewayKey), stored);
}

// ─── Config CRUD ─────────────────────────────────────────────────────────────

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
      Object.entries(stored.providers).map(([p, ct]) => [p, safeDecrypt(ct as string)]),
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
  if (Array.isArray(patch.fallbackChain)) stored.fallbackChain = patch.fallbackChain;
  if (typeof patch.rateLimit?.rpm === "number") stored.rateLimit = patch.rateLimit;
  await saveStored(gatewayKey, stored);
  return true;
}

export async function deleteConfig(gatewayKey: string): Promise<boolean> {
  return (await redis().del(configKey(sha256(gatewayKey)))) > 0;
}

/**
 * Moves the stored record to a fresh gateway key. Returns the new key, or null if unknown.
 *
 * NOTE: non-atomic — this is two separate operations (write new record, delete old).
 * A crash between them leaves an unreachable duplicate record under the old key.
 * There is no correctness impact (the old key is already discarded by the caller),
 * but it does constitute a storage leak until manual cleanup.
 */
export async function rotateKey(oldKey: string): Promise<string | null> {
  const stored = await loadStored(oldKey);
  if (!stored) return null;
  const newKey = generateGatewayKey();
  await saveStored(newKey, stored);
  await redis().del(configKey(sha256(oldKey)));
  return newKey;
}

// ─── Sub-key management ──────────────────────────────────────────────────────

/**
 * Mint a new sub-key scoped to an existing parent config.
 * Returns the new gw_sub_... key, or null if parent is unknown.
 * Throws Error("sub-key limit reached") if the parent already has 20 sub-keys.
 */
export async function createSubKey(
  parentKey: string,
  opts: { label: string; rpm?: number; tpm?: number },
): Promise<string | null> {
  const parentHash = sha256(parentKey);
  const stored = await loadStoredByHash(parentHash);
  if (!stored) return null;

  const existing = stored.subKeys ?? {};
  if (Object.keys(existing).length >= SUB_KEY_LIMIT) {
    throw new Error("sub-key limit reached");
  }

  const subKey = generateSubKey();
  const subHash = sha256(subKey);
  const createdAt = new Date().toISOString();

  // Write the subkey record
  const record: SubKeyRecord = {
    parentHash,
    label: opts.label.trim(),
    createdAt,
    ...(opts.rpm !== undefined ? { rpm: opts.rpm } : {}),
    ...(opts.tpm !== undefined ? { tpm: opts.tpm } : {}),
  };
  await redis().set(subkeyKey(subHash), JSON.stringify(record));

  // Update parent index
  stored.subKeys = {
    ...existing,
    [subHash]: {
      label: opts.label.trim(),
      createdAt,
      ...(opts.rpm !== undefined ? { rpm: opts.rpm } : {}),
      ...(opts.tpm !== undefined ? { tpm: opts.tpm } : {}),
    },
  };
  await saveStoredByHash(parentHash, stored);

  return subKey;
}

/**
 * List all sub-keys for a parent.
 * Returns null if parent is unknown, empty array if no sub-keys.
 */
export async function listSubKeys(
  parentKey: string,
): Promise<Array<{ keyHash: string; label: string; rpm?: number; tpm?: number; createdAt: string }> | null> {
  const stored = await loadStored(parentKey);
  if (!stored) return null;
  const subKeys = stored.subKeys ?? {};
  return Object.entries(subKeys).map(([keyHash, info]) => ({ keyHash, ...info }));
}

/**
 * Revoke a sub-key by its hash. Deletes the subkey record and removes from parent index.
 * Returns false if the sub-key hash is not found in the parent's index.
 */
export async function revokeSubKey(parentKey: string, subKeyHash: string): Promise<boolean> {
  const parentHash = sha256(parentKey);
  const stored = await loadStoredByHash(parentHash);
  if (!stored) return false;

  const subKeys = stored.subKeys ?? {};
  if (!(subKeyHash in subKeys)) return false;

  // Delete subkey record
  await redis().del(subkeyKey(subKeyHash));

  // Remove from parent index
  delete subKeys[subKeyHash];
  stored.subKeys = subKeys;
  await saveStoredByHash(parentHash, stored);

  return true;
}

// ─── Unified gateway auth resolution ─────────────────────────────────────────

export interface GatewayAuthResult {
  config: GatewayConfig;
  keyHash: string;
  limits: { rpm: number; tpm?: number };
  parentHash: string;
}

/**
 * The ONE function gateway routes use to resolve any gw_ key.
 *
 * Sub-key (gw_sub_...):
 *   - keyHash  = sha256(subKey)         — own rate-limit buckets
 *   - parentHash = subkey record's parentHash — usage/breaker/cache scoped here
 *   - limits   = sub-key overrides, falling back to parent rateLimit
 *
 * Parent key (gw_live_...):
 *   - keyHash = parentHash = sha256(key)
 *   - limits  = config.rateLimit
 *
 * Returns null on any miss (unknown key, revoked sub-key, orphaned sub-key).
 */
export async function resolveGatewayAuth(key: string): Promise<GatewayAuthResult | null> {
  if (key.startsWith("gw_sub_")) {
    const subHash = sha256(key);
    const raw = await redis().get<string | SubKeyRecord>(subkeyKey(subHash));
    if (!raw) return null;
    const record: SubKeyRecord = typeof raw === "string" ? JSON.parse(raw) : raw;

    const stored = await loadStoredByHash(record.parentHash);
    if (!stored) return null;

    const config: GatewayConfig = {
      ...stored,
      providers: Object.fromEntries(
        Object.entries(stored.providers).map(([p, ct]) => [p, safeDecrypt(ct as string)]),
      ),
    };

    const limits: { rpm: number; tpm?: number } = {
      rpm: record.rpm ?? stored.rateLimit.rpm,
      ...(record.tpm !== undefined
        ? { tpm: record.tpm }
        : stored.rateLimit.tpm !== undefined
          ? { tpm: stored.rateLimit.tpm }
          : {}),
    };

    return {
      config,
      keyHash: subHash,
      limits,
      parentHash: record.parentHash,
    };
  }

  // Parent / live key path
  const hash = sha256(key);
  const stored = await loadStoredByHash(hash);
  if (!stored) return null;

  const config: GatewayConfig = {
    ...stored,
    providers: Object.fromEntries(
      Object.entries(stored.providers).map(([p, ct]) => [p, safeDecrypt(ct as string)]),
    ),
  };

  return {
    config,
    keyHash: hash,
    limits: stored.rateLimit,
    parentHash: hash,
  };
}
