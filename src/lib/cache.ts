import { redis } from "./config-store";
import { sha256 } from "./crypto";

const CACHE_FIELDS = ["model", "messages", "temperature", "top_p", "max_tokens", "tools", "tool_choice"] as const;

export function cacheKeyFor(keyHash: string, body: Record<string, any>): string {
  const relevant: Record<string, unknown> = {};
  for (const field of CACHE_FIELDS) {
    if (field in body) relevant[field] = body[field];
  }
  return `cache:${keyHash}:${sha256(JSON.stringify(relevant))}`;
}

export interface CacheEntry {
  body: string;
  provider: string;
}

export async function getCached(key: string): Promise<CacheEntry | null> {
  const raw = await redis().get<string | CacheEntry>(key);
  if (!raw) return null;
  // Handle Upstash string-or-object dual shape (same pattern as config-store)
  return typeof raw === "string" ? (JSON.parse(raw) as CacheEntry) : raw;
}

export async function setCached(key: string, value: CacheEntry, ttlSeconds: number): Promise<void> {
  await redis().set(key, JSON.stringify(value), { ex: ttlSeconds });
}
