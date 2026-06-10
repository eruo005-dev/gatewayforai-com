import { redis } from "./config-store";

const THRESHOLD = 3;        // consecutive retryable failures to open
const OPEN_SECONDS = 60;    // how long an open breaker skips the provider

export interface BreakerHooks {
  isOpen(provider: string): Promise<boolean>;
  onFailure(provider: string): Promise<void>;
  onSuccess(provider: string): Promise<void>;
}

/** Redis-backed breaker, scoped to one gateway config (keyHash). */
export function redisBreaker(keyHash: string): BreakerHooks {
  const key = (provider: string) => `breaker:${keyHash}:${provider}`;
  return {
    async isOpen(provider) {
      const n = await redis().get<number>(key(provider));
      return Number(n ?? 0) >= THRESHOLD;
    },
    async onFailure(provider) {
      const k = key(provider);
      await redis().incr(k);
      await redis().expire(k, OPEN_SECONDS);
    },
    async onSuccess(provider) {
      await redis().del(key(provider));
    },
  };
}
