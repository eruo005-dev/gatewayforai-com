import { after } from "next/server";
import { fromAnthropicRequest, toAnthropicResponse, toAnthropicSSE } from "@/lib/anthropic-inbound";
import { redisBreaker } from "@/lib/breaker";
import { clientIp } from "@/lib/client-ip";
import { resolveGatewayAuth } from "@/lib/config-store";
import { resolveChain, routeRequest } from "@/lib/gateway";
import { checkGatewayIpLimit, checkRateLimit, checkTokenLimit, recordTokens, retryAfterSeconds } from "@/lib/ratelimit";
import { sortChain } from "@/lib/routing";
import type { RouteStrategy } from "@/lib/routing";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Anthropic-shaped error response. ALL errors from this route use this shape. */
function anthErr(status: number, message: string, headers?: Record<string, string>): Response {
  return Response.json(
    { type: "error", error: { type: errType(status), message } },
    { status, headers },
  );
}

function errType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 429) return "rate_limit_error";
  if (status === 400 || status === 404) return "invalid_request_error";
  return "api_error";
}

/** Gateway key from x-api-key (checked first) OR Authorization: Bearer. Both accept gw_ keys. */
function gatewayKey(req: Request): string {
  const x = (req.headers.get("x-api-key") ?? "").trim();
  if (x) return x;
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export async function POST(req: Request) {
  // Per-IP economic-DoS backstop — BEFORE auth so a flood of bogus keys is
  // throttled by IP before any Redis auth lookup runs. Anthropic error shape.
  const ipLimit = await checkGatewayIpLimit(clientIp(req));
  if (!ipLimit.success) {
    return anthErr(429, "Too many requests from this IP.", {
      "retry-after": retryAfterSeconds(ipLimit.reset),
    });
  }

  const gwKey = gatewayKey(req);
  if (!gwKey.startsWith("gw_")) {
    return anthErr(401, "Pass your gateway key via x-api-key or Authorization: Bearer gw_live_...");
  }
  const auth = await resolveGatewayAuth(gwKey);
  if (!auth) return anthErr(401, "Unknown gateway key.");

  const { config, keyHash, limits, parentHash } = auth;

  const rl = await checkRateLimit(keyHash, limits.rpm);
  if (!rl.success) {
    return anthErr(429, `Rate limit of ${limits.rpm} requests/min exceeded.`, {
      "retry-after": retryAfterSeconds(rl.reset),
    });
  }

  if (limits.tpm) {
    const tl = await checkTokenLimit(keyHash, limits.tpm);
    if (!tl.success) {
      return anthErr(429, `Token limit of ${limits.tpm} tokens/min exceeded.`, {
        "retry-after": retryAfterSeconds(tl.reset),
      });
    }
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return anthErr(400, "Request body must be valid JSON.");
  }
  if (
    typeof body?.model !== "string" ||
    !Array.isArray(body?.messages) ||
    typeof body?.max_tokens !== "number"
  ) {
    return anthErr(400, "`model` (string), `messages` (array) and `max_tokens` (number) are required.");
  }

  let chain;
  try {
    chain = resolveChain(body.model, config.fallbackChain, config.providers);
  } catch (e) {
    return anthErr(400, (e as Error).message);
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

  // Translate the inbound Anthropic body to an OpenAI chat-completions body for
  // the gateway. fromAnthropicRequest CAN throw on a malformed message entry
  // (e.g. a non-object message — see tests/anthropic-inbound.test.ts), so wrap
  // it: NO translator exception may escape to Next.js and produce a non-Anthropic
  // default 500. estimatedTokens uses JSON.stringify which can also throw on a
  // circular body, so guard it here too (it runs after validation).
  let openaiBody: Record<string, any>;
  let estimatedTokens: number;
  try {
    openaiBody = fromAnthropicRequest(body);
    // Conservative token estimate (input bytes / 4) — used for TPM accounting on
    // streaming + non-JSON paths where the response body can't be read.
    estimatedTokens = Math.ceil(JSON.stringify(body.messages).length / 4);
  } catch (e) {
    return anthErr(500, "Request translation failed: " + (e as Error).message);
  }

  // Breaker scoped to parentHash: shared provider health per config.
  const breaker = redisBreaker(parentHash);

  // Soft TPM with in-flight reservation (FIX 4): pre-charge the ESTIMATED tokens
  // synchronously BEFORE dispatch so concurrent requests see the reservation in
  // checkTokenLimit. We later reconcile against the actual usage:
  //   - non-streaming success → record (actual − estimate) signed delta
  //   - failed request        → refund (−estimate), so a failure bills 0
  //   - streaming success      → keep the estimate (actual is unreadable)
  // recordTokens accepts negative deltas (INCRBY of a negative is fine).
  if (limits.tpm) {
    await recordTokens(keyHash, estimatedTokens);
  }

  // No response-cache support on this route in v1 (x-gateway-cache is not wired).
  const result = await routeRequest({ body: openaiBody, chain, keys: config.providers, breaker });

  after(() =>
    recordUsage(parentHash, {
      provider: result.provider === "none" ? undefined : result.provider,
      fallbacks: result.fallbacks,
      error: !result.response.ok,
    }).catch(() => {}),
  );

  const gwHeaders: Record<string, string> = {
    "x-gateway-provider": result.provider,
    "x-gateway-fallback-count": String(result.fallbacks),
    "x-gateway-latency-ms": String(Date.now() - started),
    ...(routeStrategy && { "x-gateway-route": routeStrategy }),
  };

  // Streaming: translate the OpenAI chunk SSE stream back to Anthropic event SSE.
  if (body.stream) {
    if (!result.response.ok || !result.response.body) {
      // Upstream failed before streaming — refund the reservation so a failed
      // request bills 0 (FIX 4), then surface an Anthropic-shaped error.
      if (limits.tpm) after(() => recordTokens(keyHash, -estimatedTokens).catch(() => {}));
      const { status, message } = await upstreamError(result.response);
      return anthErr(status, message, gwHeaders);
    }
    // Upstream is OK and streaming — keep the reserved estimate (we can't read
    // the streamed body to reconcile actual tokens). No extra recording needed;
    // the reservation already charged estimatedTokens.
    // Guard the stream translation so a translator exception is surfaced as an
    // Anthropic-shaped error rather than a Next.js default 500.
    let anthropicStream: ReadableStream<Uint8Array>;
    try {
      anthropicStream = toAnthropicSSE(result.response.body, body.model);
    } catch (e) {
      return anthErr(502, "Response translation failed: " + (e as Error).message, gwHeaders);
    }
    return new Response(anthropicStream, {
      status: 200,
      headers: { ...gwHeaders, "content-type": "text/event-stream" },
    });
  }

  // Non-streaming.
  if (
    result.response.ok &&
    (result.response.headers.get("content-type") ?? "").includes("application/json")
  ) {
    const text = await result.response.text();
    let parsed: Record<string, any>;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Unparseable success body → keep the reserved estimate (we got a 200 but
      // can't read actual usage; the estimate is our best charge). No reconcile.
      return anthErr(502, "Upstream returned an unparseable response.", gwHeaders);
    }
    if (limits.tpm) {
      // Reconcile the reservation: record the signed delta (actual − estimate).
      // If actual is unknown, the delta is 0 (estimate already reserved).
      const total = parsed?.usage?.total_tokens;
      const actual = typeof total === "number" && total > 0 ? total : estimatedTokens;
      const delta = actual - estimatedTokens;
      if (delta !== 0) after(() => recordTokens(keyHash, delta).catch(() => {}));
    }
    // Guard the response translation. toAnthropicResponse is defensive and is
    // not expected to throw (see tests/anthropic-inbound.test.ts), so this is
    // belt-and-suspenders to guarantee NO path escapes to a Next.js 500.
    let anthResponse: Record<string, any>;
    try {
      anthResponse = toAnthropicResponse(parsed, body.model);
    } catch (e) {
      return anthErr(502, "Response translation failed: " + (e as Error).message, gwHeaders);
    }
    return Response.json(anthResponse, { headers: gwHeaders });
  }

  // Upstream error — refund the reservation so a failed request bills 0 (FIX 4),
  // then translate to an Anthropic-shaped error with the same status.
  if (limits.tpm) after(() => recordTokens(keyHash, -estimatedTokens).catch(() => {}));
  const { status, message } = await upstreamError(result.response);
  return anthErr(status, message, gwHeaders);
}

/** Read an OpenAI-shaped error response and extract status + message. */
async function upstreamError(res: Response): Promise<{ status: number; message: string }> {
  let message = "upstream error";
  try {
    const text = await res.text();
    const parsed = JSON.parse(text);
    if (typeof parsed?.error?.message === "string") message = parsed.error.message;
  } catch {
    // keep fallback message
  }
  return { status: res.status || 502, message };
}
