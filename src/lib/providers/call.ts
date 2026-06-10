import type { ProviderId } from "../types";
import { PROVIDERS } from "./registry";
import { fromAnthropicResponse, toAnthropicBody, translateAnthropicSSE } from "./anthropic";

export interface CallOpts {
  provider: ProviderId;
  model: string; // bare model name, provider prefix already stripped
  body: Record<string, any>;
  apiKey: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

/**
 * Makes one upstream call. Timeout covers time-to-headers (≈ first token for
 * streams); the timer is cleared once headers arrive so long streams are safe.
 */
export async function callProvider(opts: CallOpts): Promise<Response> {
  const { provider, model, body, apiKey, timeoutMs, fetchFn = fetch } = opts;
  const def = PROVIDERS[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (def.style === "anthropic") {
      const res = await fetchFn(`${def.baseURL}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...def.authHeader(apiKey) },
        body: JSON.stringify(toAnthropicBody({ ...body, model })),
        signal: controller.signal,
      });
      if (!res.ok) return res;
      if (body.stream) {
        return new Response(translateAnthropicSSE(res.body!, `${provider}/${model}`), {
          status: 200,
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }
      return Response.json(fromAnthropicResponse(await res.json(), `${provider}/${model}`));
    }

    return await fetchFn(`${def.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...def.authHeader(apiKey) },
      body: JSON.stringify({ ...body, model }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
