import { errJson } from "./errors";
import { callProvider } from "./providers/call";
import { PROVIDERS } from "./providers/registry";
import type { ChainEntry, ProviderId } from "./types";

const MAX_ATTEMPTS = 4; // primary + 3 fallback hops (spec §4)
const DEFAULT_TIMEOUT_MS = 25_000;

export interface RouteOpts {
  body: Record<string, any>;
  chain: ChainEntry[];
  keys: Partial<Record<ProviderId, string>>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface GatewayResult {
  response: Response;
  provider: string; // "none" when every attempt failed
  fallbacks: number;
}

interface Attempt {
  provider: ProviderId;
  model: string;
  status: number; // 0 = no HTTP response (timeout / network error)
  error?: string;
}

/**
 * "auto" → configured chain filtered to providers with keys.
 * "provider/model" → single explicit entry (errors pass through, no fallback).
 */
export function resolveChain(
  model: string,
  chain: ChainEntry[],
  keys: Partial<Record<ProviderId, string>>,
): ChainEntry[] {
  if (model === "auto") {
    const usable = chain.filter((e) => keys[e.provider]);
    if (!usable.length) throw new Error("No API key configured for any provider in the fallback chain.");
    return usable;
  }
  const slash = model.indexOf("/");
  const provider = (slash === -1 ? model : model.slice(0, slash)) as ProviderId;
  const bare = slash === -1 ? "" : model.slice(slash + 1);
  if (!PROVIDERS[provider] || !bare) {
    throw new Error(
      `Unknown provider in model "${model}". Use "provider/model" (e.g. "openai/gpt-4o") or "auto".`,
    );
  }
  if (!keys[provider]) throw new Error(`No API key configured for provider "${provider}".`);
  return [{ provider, model: bare }];
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function routeRequest(opts: RouteOpts): Promise<GatewayResult> {
  const { body, chain, keys, fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const attempts: Attempt[] = [];
  const max = Math.min(chain.length, MAX_ATTEMPTS);

  for (let i = 0; i < max; i++) {
    const entry = chain[i];
    try {
      const response = await callProvider({
        provider: entry.provider,
        model: entry.model,
        body,
        apiKey: keys[entry.provider]!,
        timeoutMs,
        fetchFn,
      });
      const passThrough =
        response.ok || !isRetryable(response.status) || chain.length === 1;
      if (passThrough) return { response, provider: entry.provider, fallbacks: i };
      attempts.push({ provider: entry.provider, model: entry.model, status: response.status });
    } catch (e) {
      attempts.push({
        provider: entry.provider,
        model: entry.model,
        status: 0,
        error: (e as Error).constructor.name,
      });
    }
  }

  return {
    response: errJson(502, "all_providers_failed", "All fallback providers failed.", { attempts }),
    provider: "none",
    fallbacks: attempts.length,
  };
}
