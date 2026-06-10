import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./config-store";

export interface LimitResult {
  success: boolean;
  reset: number; // epoch ms when the window resets
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
