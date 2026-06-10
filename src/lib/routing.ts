import { PRICES } from "./pricing";
import type { ChainEntry } from "./types";

export type RouteStrategy = "cheapest" | "fastest";

/**
 * Static median-latency rank, lower = faster.
 * Groq/Gemini Flash are fast lanes; Anthropic/OpenRouter are slower.
 */
const SPEED_RANK: Record<string, number> = {
  groq: 1,
  gemini: 2,
  openai: 3,
  deepseek: 4,
  mistral: 5,
  together: 6,
  anthropic: 7,
  openrouter: 8,
};

/**
 * Sort a chain by the given strategy without mutating the original array.
 *
 * "cheapest": sort by average per-token cost (in+out) ascending.
 *   Unknown-price entries go after all known-price entries, preserving their
 *   relative order among themselves.
 *
 * "fastest": sort by SPEED_RANK[provider] ascending.
 *   Providers absent from the rank table go last, preserving relative order.
 */
export function sortChain(chain: ChainEntry[], strategy: RouteStrategy): ChainEntry[] {
  const copy = [...chain];

  if (strategy === "cheapest") {
    const cost = (e: ChainEntry): number => {
      const key = `${e.provider}/${e.model}`;
      const price = PRICES[key];
      if (!price) return Infinity;
      return price.in + price.out;
    };
    // Stable sort: known-price entries sorted by cost; unknown-price entries
    // keep their original relative order and appear after all known-price entries.
    const known = copy.filter((e) => cost(e) !== Infinity).sort((a, b) => cost(a) - cost(b));
    const unknown = copy.filter((e) => cost(e) === Infinity);
    return [...known, ...unknown];
  }

  // "fastest": sort by SPEED_RANK, unknown providers go last (preserving relative order)
  const rank = (e: ChainEntry): number => SPEED_RANK[e.provider] ?? Infinity;
  const fast = copy.filter((e) => rank(e) !== Infinity).sort((a, b) => rank(a) - rank(b));
  const slow = copy.filter((e) => rank(e) === Infinity);
  return [...fast, ...slow];
}
