import { after } from "next/server";
import { redisBreaker } from "@/lib/breaker";
import { cacheKeyFor, getCached, setCached } from "@/lib/cache";
import { clientIp } from "@/lib/client-ip";
import { resolveGatewayAuth } from "@/lib/config-store";
import { errJson, gatewayHeaders, redactKeys } from "@/lib/errors";
import { resolveChain, routeRequest } from "@/lib/gateway";
import { estimateCostUsd } from "@/lib/pricing";
import { checkGatewayIpLimit, checkRateLimit, checkTokenLimit, recordTokens, retryAfterSeconds } from "@/lib/ratelimit";
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

/**
 * Build a non-streaming error Response from a failed upstream, redacting any
 * provider-key fingerprint the upstream echoed into its error message (so the
 * gw-key holder never sees the last-4 of the configured provider key). Reads the
 * body, redacts `error.message` if present, and re-emits with the gateway headers.
 * Only call on the NON-STREAMING error path (it consumes the body).
 */
async function redactedErrorResponse(
  upstream: Response,
  headers: Headers,
): Promise<Response> {
  const text = await upstream.text();
  let outBody = text;
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.error?.message === "string") {
      parsed.error.message = redactKeys(parsed.error.message);
      outBody = JSON.stringify(parsed);
    }
  } catch {
    // Non-JSON error body: redact the raw string as a best-effort sweep.
    outBody = redactKeys(text);
  }
  return new Response(outBody, { status: upstream.status, headers });
}

export async function POST(req: Request) {
  // Per-IP economic-DoS backstop — BEFORE auth so a flood of bogus keys is
  // throttled by IP before any Redis auth lookup runs.
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

    // Cache miss — reserve the estimate (soft TPM with in-flight reservation,
    // FIX 4) so concurrent requests see it, then run the request and reconcile.
    if (limits.tpm) await recordTokens(keyHash, estimatedTokens);
    const result = await routeRequest({ body, chain, keys: config.providers, breaker });

    after(() =>
      recordUsage(parentHash, {
        provider: result.provider === "none" ? undefined : result.provider,
        fallbacks: result.fallbacks,
        error: !result.response.ok,
      }).catch(() => {}),
    );

    // Whitelist response headers: ONLY content-type (from upstream) + the
    // x-gateway-* observability headers. Drops upstream content-length (would
    // mismatch a redacted body → client hang) and any leaky upstream headers
    // (x-error-json, set-cookie, openai-*, request-ids, …).
    const headers = gatewayHeaders(result.response, {
      "x-gateway-provider": result.provider,
      "x-gateway-fallback-count": String(result.fallbacks),
      "x-gateway-latency-ms": String(Date.now() - started),
      ...(routeStrategy && { "x-gateway-route": routeStrategy }),
    });

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
        // Reconcile the reservation with actual usage — record the signed delta
        // (actual − estimate) per keyHash (sub-key budget).
        if (limits.tpm) {
          const total = parsed?.usage?.total_tokens;
          const actual = typeof total === "number" && total > 0 ? total : estimatedTokens;
          const delta = actual - estimatedTokens;
          if (delta !== 0) after(() => recordTokens(keyHash, delta).catch(() => {}));
        }
      } catch {
        // ignore parse errors — cost header is best-effort. Reservation stands
        // (we got a 200 but couldn't read usage); no reconcile.
      }
      return new Response(text, { status: result.response.status, headers });
    }

    // Non-JSON or error response: pass through without caching. A non-ok upstream
    // is a FAILED request → refund the reservation so it bills 0 (FIX 4). A
    // non-JSON OK response keeps the reserved estimate (actual is unreadable).
    if (limits.tpm && !result.response.ok) {
      after(() => recordTokens(keyHash, -estimatedTokens).catch(() => {}));
    }
    // On a non-ok upstream, redact any provider-key fingerprint in the error body
    // before passing it through (this path is non-streaming).
    if (!result.response.ok) {
      return redactedErrorResponse(result.response, headers);
    }
    return new Response(result.response.body, { status: result.response.status, headers });
  }

  // No caching — original pass-through path (streaming safe).
  // Reserve the estimate before dispatch (soft TPM with in-flight reservation,
  // FIX 4). On streaming we can't read the body to reconcile, so the estimate is
  // the final charge on success; on a failed upstream we refund it below.
  if (limits.tpm) await recordTokens(keyHash, estimatedTokens);
  const result = await routeRequest({ body, chain, keys: config.providers, breaker });

  after(() =>
    recordUsage(parentHash, {
      provider: result.provider === "none" ? undefined : result.provider,
      fallbacks: result.fallbacks,
      error: !result.response.ok,
    }).catch(() => {}),
  );

  // Refund the reservation for a FAILED request so it bills 0 (FIX 4). A
  // successful (streaming) response keeps the reserved estimate.
  if (limits.tpm && !result.response.ok) {
    after(() => recordTokens(keyHash, -estimatedTokens).catch(() => {}));
  }

  // Whitelist response headers (see cache-miss path above). For a streaming
  // pass-through this also keeps the upstream text/event-stream content-type
  // while dropping content-length/transfer-encoding so the runtime frames the
  // stream correctly.
  const headers = gatewayHeaders(result.response, {
    "x-gateway-provider": result.provider,
    "x-gateway-fallback-count": String(result.fallbacks),
    "x-gateway-latency-ms": String(Date.now() - started),
    ...(routeStrategy && { "x-gateway-route": routeStrategy }),
  });
  // On a non-streaming, non-ok upstream, redact any provider-key fingerprint in
  // the error body. Streaming bodies are passed through untouched (can't buffer).
  if (!body.stream && !result.response.ok) {
    return redactedErrorResponse(result.response, headers);
  }
  return new Response(result.response.body, { status: result.response.status, headers });
}
