import { PROVIDERS } from "./providers/registry";
import type { ChainEntry, GatewayConfig, ProviderId } from "./types";

export interface ValidationResult {
  value?: Omit<GatewayConfig, "createdAt">;
  error?: string;
}

export function validateConfigInput(input: unknown): ValidationResult {
  const o = (input ?? {}) as Record<string, any>;

  const providers: Partial<Record<ProviderId, string>> = {};
  const rawProviders = o.providers ?? {};
  for (const [p, k] of Object.entries(rawProviders)) {
    if (!(p in PROVIDERS)) return { error: `Unknown provider "${p}".` };
    if (typeof k !== "string" || !k.trim()) return { error: `Empty API key for "${p}".` };
    providers[p as ProviderId] = k.trim();
  }
  if (!Object.keys(providers).length) return { error: "Add at least one provider API key." };

  const rawChain = o.fallbackChain;
  if (!Array.isArray(rawChain) || !rawChain.length) {
    return { error: "Fallback chain must contain at least one entry." };
  }
  if (rawChain.length > 8) return { error: "Fallback chain supports at most 8 entries." };
  const fallbackChain: ChainEntry[] = [];
  for (const e of rawChain) {
    const provider = e?.provider as ProviderId;
    if (!(provider in PROVIDERS)) return { error: `Unknown provider "${e?.provider}" in chain.` };
    if (!providers[provider]) return { error: `Chain entry "${provider}" has no key configured.` };
    if (typeof e?.model !== "string" || !e.model.trim()) {
      return { error: `Chain entry "${provider}" needs a model name.` };
    }
    fallbackChain.push({ provider, model: e.model.trim() });
  }

  const rpm = o.rateLimit?.rpm ?? 60;
  if (!Number.isInteger(rpm) || rpm < 1 || rpm > 1000) {
    return { error: "rateLimit.rpm must be an integer between 1 and 1000." };
  }

  const tpm = o.rateLimit?.tpm;
  if (tpm !== undefined && tpm !== null) {
    if (!Number.isInteger(tpm) || tpm < 1000 || tpm > 10_000_000) {
      return { error: "rateLimit.tpm must be an integer between 1000 and 10000000." };
    }
  }

  return { value: { providers, fallbackChain, rateLimit: { rpm, ...(tpm && { tpm }) } } };
}
