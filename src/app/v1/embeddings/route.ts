import { after } from "next/server";
import { clientIp } from "@/lib/client-ip";
import { resolveGatewayAuth } from "@/lib/config-store";
import { errJson } from "@/lib/errors";
import { PROVIDERS } from "@/lib/providers/registry";
import { checkGatewayIpLimit, checkRateLimit, retryAfterSeconds } from "@/lib/ratelimit";
import type { ProviderId } from "@/lib/types";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

function bearerKey(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export async function POST(req: Request) {
  // Per-IP economic-DoS backstop — BEFORE auth (see chat/completions route).
  const ipLimit = await checkGatewayIpLimit(clientIp(req));
  if (!ipLimit.success) {
    return errJson(429, "rate_limit_exceeded", "Too many requests from this IP.", undefined, {
      "retry-after": retryAfterSeconds(ipLimit.reset),
    });
  }

  const gwKey = bearerKey(req);
  if (!gwKey.startsWith("gw_")) {
    return errJson(401, "invalid_api_key", "Pass your gateway key as: Authorization: Bearer gw_live_...");
  }
  const auth = await resolveGatewayAuth(gwKey);
  if (!auth) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  // keyHash = sub-key's own hash (own rate-limit buckets)
  // parentHash = parent config hash (usage recorded there)
  const { config, keyHash, limits, parentHash } = auth;

  const rl = await checkRateLimit(keyHash, limits.rpm);
  if (!rl.success) {
    return errJson(
      429,
      "rate_limit_exceeded",
      `Rate limit of ${limits.rpm} requests/min exceeded.`,
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

  // Object.hasOwn, not truthiness: PROVIDERS["constructor"]/["__proto__"] are
  // truthy inherited members and would slip a bogus provider past this check.
  if (!Object.hasOwn(PROVIDERS, provider)) {
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
    recordUsage(parentHash, {
      provider,
      fallbacks: 0,
      error: !response.ok,
    }).catch(() => {}),
  );

  const headers = new Headers(response.headers);
  headers.set("x-gateway-provider", provider);
  return new Response(response.body, { status: response.status, headers });
}
