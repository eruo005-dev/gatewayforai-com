import { incrByWithExpire, redis } from "./config-store";

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
      // Atomic INCR+EXPIRE in one round-trip: a crash between a separate incr and
      // expire would leave the breaker counter without a TTL — it would never
      // reset and the provider would stay permanently "open". One Lua call closes
      // that leak. (incr is incrByWithExpire with n=1.)
      await incrByWithExpire(key(provider), 1, OPEN_SECONDS);
    },
    async onSuccess(provider) {
      await redis().del(key(provider));
    },
  };
}
