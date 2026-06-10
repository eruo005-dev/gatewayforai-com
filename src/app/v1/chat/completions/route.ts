import { after } from "next/server";
import { redisBreaker } from "@/lib/breaker";
import { cacheKeyFor, getCached, setCached } from "@/lib/cache";
import { getConfig } from "@/lib/config-store";
import { sha256 } from "@/lib/crypto";
import { errJson } from "@/lib/errors";
import { resolveChain, routeRequest } from "@/lib/gateway";
import { checkRateLimit, retryAfterSeconds } from "@/lib/ratelimit";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

function bearerKey(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** Parse x-gateway-cache header → TTL in seconds (1..86400), or null to skip caching. */
function parseCacheTtl(req: Request): number | null {
  const raw = req.headers.get("x-gateway-cache");
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(n, 1), 86400);
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
  if (typeof body?.model !== "string" || !Array.isArray(body?.messages)) {
    return errJson(400, "invalid_request_error", "`model` (string) and `messages` (array) are required.");
  }

  let chain;
  try {
    chain = resolveChain(body.model, config.fallbackChain, config.providers);
  } catch (e) {
    return errJson(400, "invalid_request_error", (e as Error).message);
  }

  const started = Date.now();

  // Opt-in response cache — only for non-streaming requests
  const cacheTtl = parseCacheTtl(req);
  const cacheable = cacheTtl !== null && !body.stream;

  if (cacheable) {
    const cacheKey = cacheKeyFor(keyHash, body);
    const cached = await getCached(cacheKey);
    if (cached) {
      after(() =>
        recordUsage(keyHash, {
          provider: cached.provider,
          fallbacks: 0,
          error: false,
        }).catch(() => {}),
      );
      return new Response(cached.body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-gateway-provider": cached.provider,
          "x-gateway-cache": "hit",
          "x-gateway-fallback-count": "0",
          "x-gateway-latency-ms": String(Date.now() - started),
        },
      });
    }

    // Cache miss — run the request, read body text, cache async
    const result = await routeRequest({ body, chain, keys: config.providers, breaker: redisBreaker(keyHash) });

    after(() =>
      recordUsage(keyHash, {
        provider: result.provider === "none" ? undefined : result.provider,
        fallbacks: result.fallbacks,
        error: !result.response.ok,
      }).catch(() => {}),
    );

    const headers = new Headers(result.response.headers);
    headers.set("x-gateway-provider", result.provider);
    headers.set("x-gateway-fallback-count", String(result.fallbacks));
    headers.set("x-gateway-latency-ms", String(Date.now() - started));

    if (
      result.response.ok &&
      (result.response.headers.get("content-type") ?? "").includes("application/json")
    ) {
      const text = await result.response.text();
      headers.set("x-gateway-cache", "miss");
      after(() =>
        setCached(cacheKey, { body: text, provider: result.provider }, cacheTtl).catch(() => {}),
      );
      return new Response(text, { status: result.response.status, headers });
    }

    // Non-JSON or error response: pass through without caching
    return new Response(result.response.body, { status: result.response.status, headers });
  }

  // No caching — original pass-through path (streaming safe)
  const result = await routeRequest({ body, chain, keys: config.providers, breaker: redisBreaker(keyHash) });

  after(() =>
    recordUsage(keyHash, {
      provider: result.provider === "none" ? undefined : result.provider,
      fallbacks: result.fallbacks,
      error: !result.response.ok,
    }).catch(() => {}),
  );

  const headers = new Headers(result.response.headers);
  headers.set("x-gateway-provider", result.provider);
  headers.set("x-gateway-fallback-count", String(result.fallbacks));
  headers.set("x-gateway-latency-ms", String(Date.now() - started));
  return new Response(result.response.body, { status: result.response.status, headers });
}
