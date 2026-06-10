import { after } from "next/server";
import { getConfig } from "@/lib/config-store";
import { sha256 } from "@/lib/crypto";
import { errJson } from "@/lib/errors";
import { PROVIDERS } from "@/lib/providers/registry";
import { checkRateLimit, retryAfterSeconds } from "@/lib/ratelimit";
import type { ProviderId } from "@/lib/types";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

function bearerKey(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export async function POST(req: Request) {
  const gwKey = bearerKey(req);
  if (!gwKey.startsWith("gw_")) {
    return errJson(401, "invalid_api_key", "Pass your gateway key as: Authorization: Bearer gw_live_...");
  }
  const config = await getConfig(gwKey);
  if (!config) return errJson(401, "invalid_api_key", "Unknown gateway key.");
  const keyHash = sha256(gwKey);

  const rl = await checkRateLimit(keyHash, config.rateLimit.rpm);
  if (!rl.success) {
    return errJson(
      429,
      "rate_limit_exceeded",
      `Rate limit of ${config.rateLimit.rpm} requests/min exceeded.`,
      undefined,
      { "retry-after": retryAfterSeconds(rl.reset) },
    );
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Request body must be valid JSON.");
  }

  if (typeof body?.model !== "string" || body.input === undefined) {
    return errJson(400, "invalid_request_error", "`model` (string) and `input` are required.");
  }

  // Require explicit provider/model — no "auto" for embeddings
  const slash = body.model.indexOf("/");
  if (slash === -1) {
    return errJson(
      400,
      "invalid_request_error",
      "Use provider/model for embeddings, e.g. openai/text-embedding-3-small",
    );
  }

  const provider = body.model.slice(0, slash) as ProviderId;
  const bareModel = body.model.slice(slash + 1);

  if (!PROVIDERS[provider]) {
    return errJson(
      400,
      "invalid_request_error",
      `Unknown provider "${provider}". Use provider/model, e.g. openai/text-embedding-3-small`,
    );
  }

  // Anthropic has no embeddings API
  if (provider === "anthropic") {
    return errJson(
      400,
      "invalid_request_error",
      "Anthropic does not support embeddings. Use openai/text-embedding-3-small or another provider.",
    );
  }

  const apiKey = config.providers[provider];
  if (!apiKey) {
    return errJson(
      400,
      "invalid_request_error",
      `No API key configured for provider "${provider}".`,
    );
  }

  const providerDef = PROVIDERS[provider];
  const upstreamBody = { ...body, model: bareModel };
  const upstreamUrl = `${providerDef.baseURL}/embeddings`;

  let response: Response;
  try {
    response = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...providerDef.authHeader(apiKey),
      },
      body: JSON.stringify(upstreamBody),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    return errJson(502, "api_error", `Upstream request failed: ${(e as Error).message}`);
  }

  after(() =>
    recordUsage(keyHash, {
      provider,
      fallbacks: 0,
      error: !response.ok,
    }).catch(() => {}),
  );

  const headers = new Headers(response.headers);
  headers.set("x-gateway-provider", provider);
  return new Response(response.body, { status: response.status, headers });
}
