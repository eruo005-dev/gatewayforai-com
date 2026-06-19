import { redis } from "./config-store";

const DAY_SECONDS = 60 * 60 * 24;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns the last `n` dates (YYYY-MM-DD), oldest first, ending today. */
export function lastDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(now - i * DAY_SECONDS * 1000).toISOString().slice(0, 10));
  }
  return out;
}

export interface UsageFields {
  provider?: string;
  error?: boolean;
  fallbacks?: number;
}

// Lua: HINCRBY every (field, amount) pair packed into ARGV, then EXPIRE the hash —
// in ONE round-trip. ARGV layout: [ttl, field1, amt1, field2, amt2, ...]. Folding
// the up-to-4 HINCRBYs + the EXPIRE into a single eval means a crash can never land
// between the increments and the expire (which would leak the daily hash with no
// TTL) and saves up to 4 sequential network hops on the hot path.
const RECORD_USAGE_LUA =
  "for i = 2, #ARGV, 2 do redis.call('HINCRBY', KEYS[1], ARGV[i], ARGV[i + 1]) end; " +
  "redis.call('EXPIRE', KEYS[1], ARGV[1]); return 1";

export async function recordUsage(
  keyHash: string,
  fields: UsageFields,
  day: string = today(),
): Promise<void> {
  const k = `usage:${keyHash}:${day}`;
  // [ttl, field, amount, ...] — same set of increments as the old sequential path.
  const argv: (string | number)[] = [90 * DAY_SECONDS, "requests", 1];
  if (fields.error) argv.push("errors", 1);
  if (fields.fallbacks) argv.push("fallbacks", fields.fallbacks);
  if (fields.provider) argv.push(`provider:${fields.provider}`, 1);
  await redis().eval(RECORD_USAGE_LUA, [k], argv);
}

export type UsageDay = { date: string; requests: number; errors: number; fallbacks: number } & Record<string, number | string>;

export async function getUsage(keyHash: string, days: string[]): Promise<UsageDay[]> {
  const r = redis();
  return Promise.all(
    days.map(async (date) => {
      const h = (await r.hgetall<Record<string, unknown>>(`usage:${keyHash}:${date}`)) ?? {};
      const nums = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v)]));
      return { requests: 0, errors: 0, fallbacks: 0, ...nums, date };
    }),
  );
}
