import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./config-store";

export interface LimitResult {
  success: boolean;
  reset: number; // epoch ms when the window resets
}

/** Returns the epoch-minute bucket number for a given timestamp. */
function epochMinute(nowMs: number): number {
  return Math.floor(nowMs / 60_000);
}

/**
 * Sliding-minute token budget. Compares (current + previous bucket) against tpm.
 * Returns success=false when spent >= tpm.
 * Conservative: sums full previous bucket even if most of that minute has elapsed.
 */
export async function checkTokenLimit(
  keyHash: string,
  tpm: number,
  nowMs = Date.now(),
): Promise<LimitResult> {
  const r = redis();
  const cur = epochMinute(nowMs);
  const [curVal, prevVal] = await Promise.all([
    r.get<string | number>(`tok:${keyHash}:${cur}`),
    r.get<string | number>(`tok:${keyHash}:${cur - 1}`),
  ]);
  const spent = Number(curVal ?? 0) + Number(prevVal ?? 0);
  const reset = (cur + 1) * 60_000; // start of next minute
  return { success: spent < tpm, reset };
}

/**
 * Records token usage for the current minute bucket.
 * Key expires after 180s so old buckets are cleaned up automatically.
 */
export async function recordTokens(
  keyHash: string,
  tokens: number,
  nowMs = Date.now(),
): Promise<void> {
  const r = redis();
  const cur = epochMinute(nowMs);
  const key = `tok:${keyHash}:${cur}`;
  await r.incrby(key, tokens);
  await r.expire(key, 180);
}

/** Per-gateway-key RPM limit (sliding window). */
export async function checkRateLimit(keyHash: string, rpm: number): Promise<LimitResult> {
  const rl = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(rpm, "60 s"),
    prefix: "rl",
  });
  const { success, reset } = await rl.limit(keyHash);
  return { success, reset };
}

/** Per-IP limit for config endpoints (anti key-spam / brute force). */
export async function checkIpLimit(ip: string): Promise<LimitResult> {
  const rl = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "rlip",
  });
  const { success, reset } = await rl.limit(ip);
  return { success, reset };
}

export function retryAfterSeconds(reset: number): string {
  return String(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
}
