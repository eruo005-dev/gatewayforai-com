/** USD per million tokens: { in: input price, out: output price } */
const PRICES: Record<string, { in: number; out: number }> = {
  "openai/gpt-4o": { in: 2.5, out: 10 },
  "openai/gpt-4o-mini": { in: 0.15, out: 0.6 },
  "openai/gpt-4.1": { in: 2, out: 8 },
  "anthropic/claude-sonnet-4-6": { in: 3, out: 15 },
  "anthropic/claude-haiku-4-5": { in: 1, out: 5 },
  "anthropic/claude-opus-4-8": { in: 15, out: 75 },
  "gemini/gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "gemini/gemini-2.5-pro": { in: 1.25, out: 10 },
  "groq/llama-3.3-70b-versatile": { in: 0.59, out: 0.79 },
  "mistral/mistral-large-latest": { in: 2, out: 6 },
  "deepseek/deepseek-chat": { in: 0.27, out: 1.1 },
  "deepseek/deepseek-reasoner": { in: 0.55, out: 2.19 },
  "together/meta-llama/Llama-3.3-70B-Instruct-Turbo": { in: 0.88, out: 0.88 },
};

export interface UsageTokens {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * Returns the estimated cost in USD, rounded to 6 decimal places.
 * Returns null if the model is unknown or usage is missing/empty.
 */
export function estimateCostUsd(
  providerModel: string,
  usage: UsageTokens | undefined,
): number | null {
  if (!usage) return null;
  const price = PRICES[providerModel];
  if (!price) return null;
  const inTokens = usage.prompt_tokens ?? 0;
  const outTokens = usage.completion_tokens ?? 0;
  if (inTokens === 0 && outTokens === 0) return null;
  const cost = (inTokens * price.in + outTokens * price.out) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
