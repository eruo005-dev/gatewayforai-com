export type ProviderId =
  | "openai" | "anthropic" | "gemini" | "groq"
  | "mistral" | "together" | "deepseek" | "openrouter";

export interface ChainEntry {
  provider: ProviderId;
  model: string;
}

/** In-memory form — provider key values are PLAINTEXT (decrypted). */
export interface GatewayConfig {
  providers: Partial<Record<ProviderId, string>>;
  fallbackChain: ChainEntry[];
  rateLimit: { rpm: number; tpm?: number };
  createdAt: string;
}

export interface ConfigPatch {
  /** string = set/replace key (plaintext in), null = remove provider */
  providers?: Partial<Record<ProviderId, string | null>>;
  fallbackChain?: ChainEntry[];
  rateLimit?: { rpm: number; tpm?: number };
}
