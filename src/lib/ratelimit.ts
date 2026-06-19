import { Ratelimit } from "@upstash/ratelimit";
import { incrByWithExpire, redis, withTimeout } from "./config-store";

export interface LimitResult {
  success: boolean;
  reset: number; // epoch ms when the window resets
}

/**
 * Timeout budget for limiter ops (ms). Tighter than the auth budget: a limiter is
 * not on the correctness-critical path, so we'd rather fail fast and fall open.
 * Degradation policy for RATE LIMITING: FAIL OPEN. If Redis is slow/brown the
 * limiter call times out and we treat it as success — availability over strictness,
 * since auth (which fails CLOSED) already gates access. Configurable via
 * REDIS_TIMEOUT_MS indirectly is NOT done here on purpose; this stays a dedicated
 * tighter constant.
 */
const LIMITER_TIMEOUT_MS = 1500;

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
 * Records token usage for the current minute bucket. `tokens` MAY be negative —
 * the TPM accounting uses reserve-then-reconcile, so a reconciliation passes a
 * signed delta (actual − estimate) which can be below zero. INCRBY of a negative
 * is fine; the bucket can dip but the sliding window self-heals each minute.
 *
 * Atomic re: TTL — the INCRBY and the EXPIRE(180s) run in one Lua call so a crash
 * can never leave the bucket without a TTL (which would leak the key forever).
 */
export async function recordTokens(
  keyHash: string,
  tokens: number,
  nowMs = Date.now(),
): Promise<void> {
  const cur = epochMinute(nowMs);
  const key = `tok:${keyHash}:${cur}`;
  await incrByWithExpire(key, tokens, 180);
}

/** Per-gateway-key RPM limit (sliding window). Fails OPEN on Redis timeout. */
export async function checkRateLimit(keyHash: string, rpm: number): Promise<LimitResult> {
  const rl = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(rpm, "60 s"),
    prefix: "rl",
  });
  return withTimeout(
    rl.limit(keyHash).then(({ success, reset }) => ({ success, reset })),
    LIMITER_TIMEOUT_MS,
    () => ({ success: true, reset: Date.now() + 60_000 }), // fail open
  );
}

/**
 * Coarse per-IP limit for the public /v1/* gateway routes. Checked BEFORE auth so
 * a flood of bogus keys is throttled by IP before any Redis auth lookup runs.
 * Generous (120 req / 60s) — it's an economic-DoS backstop, not a per-user quota.
 * Fails OPEN on Redis timeout.
 */
export async function checkGatewayIpLimit(ip: string): Promise<LimitResult> {
  const rl = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(120, "60 s"),
    prefix: "rlgw",
  });
  return withTimeout(
    rl.limit(ip).then(({ success, reset }) => ({ success, reset })),
    LIMITER_TIMEOUT_MS,
    () => ({ success: true, reset: Date.now() + 60_000 }), // fail open
  );
}

/** Per-IP limit for config endpoints (anti key-spam / brute force). Fails OPEN. */
export async function checkIpLimit(ip: string): Promise<LimitResult> {
  const rl = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "rlip",
  });
  return withTimeout(
    rl.limit(ip).then(({ success, reset }) => ({ success, reset })),
    LIMITER_TIMEOUT_MS,
    () => ({ success: true, reset: Date.now() + 60_000 }), // fail open
  );
}

export function retryAfterSeconds(reset: number): string {
  return String(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
}
