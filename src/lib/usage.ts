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

export async function recordUsage(
  keyHash: string,
  fields: UsageFields,
  day: string = today(),
): Promise<void> {
  const k = `usage:${keyHash}:${day}`;
  const r = redis();
  await r.hincrby(k, "requests", 1);
  if (fields.error) await r.hincrby(k, "errors", 1);
  if (fields.fallbacks) await r.hincrby(k, "fallbacks", fields.fallbacks);
  if (fields.provider) await r.hincrby(k, `provider:${fields.provider}`, 1);
  await r.expire(k, 90 * DAY_SECONDS);
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
