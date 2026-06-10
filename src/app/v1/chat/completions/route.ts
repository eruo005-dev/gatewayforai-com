import { after } from "next/server";
import { redisBreaker } from "@/lib/breaker";
import { cacheKeyFor, getCached, setCached } from "@/lib/cache";
import { resolveGatewayAuth } from "@/lib/config-store";
import { errJson } from "@/lib/errors";
import { resolveChain, routeRequest } from "@/lib/gateway";
import { estimateCostUsd } from "@/lib/pricing";
import { checkRateLimit, checkTokenLimit, recordTokens, retryAfterSeconds } from "@/lib/ratelimit";
import { sortChain } from "@/lib/routing";
import type { RouteStrategy } from "@/lib/routing";
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
  const auth = await resolveGatewayAuth(gwKey);
  if (!auth) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  // keyHash = sub-key's own hash (own rate-limit buckets)
  // parentHash = parent config hash (usage, breaker, cache)
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

  if (limits.tpm) {
    const tl = await checkTokenLimit(keyHash, limits.tpm);
    if (!tl.success) {
      return errJson(
        429,
        "token_limit_exceeded",
        `Token limit of ${limits.tpm} tokens/min exceeded.`,
        undefined,
        { "retry-after": retryAfterSeconds(tl.reset) },
      );
    }
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

  // x-gateway-route: "cheapest" | "fastest" — only applies when model === "auto"
  const routeHeader = req.headers.get("x-gateway-route");
  const routeStrategy =
    (routeHeader === "cheapest" || routeHeader === "fastest") && body.model === "auto"
      ? (routeHeader as RouteStrategy)
      : null;
  if (routeStrategy) {
    chain = sortChain(chain, routeStrategy);
  }

  const started = Date.now();

  // Opt-in response cache — only for non-streaming requests
  // Cache keyed by parentHash: sub-keys share the parent's cache (same providers, safe)
  const cacheTtl = parseCacheTtl(req);
  const cacheable = cacheTtl !== null && !body.stream;

  // Conservative token estimate for paths where we can't read the response body
  // (streaming + pass-through). Approximates input tokens as message bytes / 4.
  const estimatedTokens = Math.ceil(JSON.stringify(body.messages).length / 4);

  // Breaker scoped to parentHash: shared provider health per config (correct semantics)
  const breaker = redisBreaker(parentHash);

  if (cacheable) {
    const cacheKey = cacheKeyFor(parentHash, body);
    const cached = await getCached(cacheKey);
    if (cached) {
      after(() =>
        recordUsage(parentHash, {
          provider: cached.provider,
          fallbacks: 0,
          error: false,
        }).catch(() => {}),
      );
      // Record token usage from cached body (parsed usage.total_tokens)
      // Token limits per keyHash (sub-key budget)
      if (limits.tpm) {
        try {
          const parsed = JSON.parse(cached.body);
          const total = parsed?.usage?.total_tokens;
          if (typeof total === "number" && total > 0) {
            after(() => recordTokens(keyHash, total).catch(() => {}));
          } else {
            after(() => recordTokens(keyHash, estimatedTokens).catch(() => {}));
          }
        } catch {
          after(() => recordTokens(keyHash, estimatedTokens).catch(() => {}));
        }
      }
      return new Response(cached.body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-gateway-provider": cached.provider,
          "x-gateway-cache": "hit",
          "x-gateway-fallback-count": "0",
          "x-gateway-latency-ms": String(Date.now() - started),
          ...(routeStrategy && { "x-gateway-route": routeStrategy }),
        },
      });
    }

    // Cache miss — run the request, read body text, cache async
    const result = await routeRequest({ body, chain, keys: config.providers, breaker });

    after(() =>
      recordUsage(parentHash, {
        provider: result.provider === "none" ? undefined : result.provider,
        fallbacks: result.fallbacks,
        error: !result.response.ok,
      }).catch(() => {}),
    );

    const headers = new Headers(result.response.headers);
    headers.set("x-gateway-provider", result.provider);
    headers.set("x-gateway-fallback-count", String(result.fallbacks));
    headers.set("x-gateway-latency-ms", String(Date.now() - started));
    if (routeStrategy) headers.set("x-gateway-route", routeStrategy);

    if (
      result.response.ok &&
      (result.response.headers.get("content-type") ?? "").includes("application/json")
    ) {
      const text = await result.response.text();
      headers.set("x-gateway-cache", "miss");
      after(() =>
        setCached(cacheKey, { body: text, provider: result.provider }, cacheTtl).catch(() => {}),
      );
      // Cost estimate — body already read, so we can parse it here
      try {
        const parsed = JSON.parse(text);
        const providerModel =
          typeof parsed.model === "string"
            ? `${result.provider}/${parsed.model}`
            : undefined;
        if (providerModel) {
          const cost = estimateCostUsd(providerModel, parsed.usage);
          if (cost !== null) headers.set("x-gateway-cost-estimate-usd", String(cost));
        }
        // Record actual token usage when available — per keyHash (sub-key budget)
        if (limits.tpm) {
          const total = parsed?.usage?.total_tokens;
          after(() =>
            recordTokens(
              keyHash,
              typeof total === "number" && total > 0 ? total : estimatedTokens,
            ).catch(() => {}),
          );
        }
      } catch {
        // ignore parse errors — cost header is best-effort
        if (limits.tpm) {
          after(() => recordTokens(keyHash, estimatedTokens).catch(() => {}));
        }
      }
      return new Response(text, { status: result.response.status, headers });
    }

    // Non-JSON or error response: pass through without caching
    // Use conservative estimate since we can't read the body
    if (limits.tpm) {
      after(() => recordTokens(keyHash, estimatedTokens).catch(() => {}));
    }
    return new Response(result.response.body, { status: result.response.status, headers });
  }

  // No caching — original pass-through path (streaming safe)
  // Use conservative estimate — body is not read here (would break streaming)
  const result = await routeRequest({ body, chain, keys: config.providers, breaker });

  after(() =>
    recordUsage(parentHash, {
      provider: result.provider === "none" ? undefined : result.provider,
      fallbacks: result.fallbacks,
      error: !result.response.ok,
    }).catch(() => {}),
  );

  // Conservative token approximation: messages JSON bytes / 4 (documents streaming limitation)
  if (limits.tpm) {
    after(() => recordTokens(keyHash, estimatedTokens).catch(() => {}));
  }

  const headers = new Headers(result.response.headers);
  headers.set("x-gateway-provider", result.provider);
  headers.set("x-gateway-fallback-count", String(result.fallbacks));
  headers.set("x-gateway-latency-ms", String(Date.now() - started));
  if (routeStrategy) headers.set("x-gateway-route", routeStrategy);
  return new Response(result.response.body, { status: result.response.status, headers });
}
