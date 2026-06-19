import { clientIp } from "@/lib/client-ip";
import { resolveGatewayAuth } from "@/lib/config-store";
import { errJson } from "@/lib/errors";
import { bearerKey } from "@/lib/http";
import { PROVIDERS } from "@/lib/providers/registry";
import { checkGatewayIpLimit, checkRateLimit, retryAfterSeconds } from "@/lib/ratelimit";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  // Per-IP economic-DoS backstop — BEFORE auth (see chat/completions route).
  const ipLimit = await checkGatewayIpLimit(clientIp(req));
  if (!ipLimit.success) {
    return errJson(429, "rate_limit_exceeded", "Too many requests from this IP.", undefined, {
      "retry-after": retryAfterSeconds(ipLimit.reset),
    });
  }

  const gwKey = bearerKey(req);
  const auth = gwKey.startsWith("gw_") ? await resolveGatewayAuth(gwKey) : null;
  if (!auth) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  // Per-KEY RPM limit (same as the other gateway routes). Without it one key could
  // fan out N upstream /models fetches unthrottled past the coarse per-IP gate.
  const rl = await checkRateLimit(auth.keyHash, auth.limits.rpm);
  if (!rl.success) {
    return errJson(
      429,
      "rate_limit_exceeded",
      `Rate limit of ${auth.limits.rpm} requests/min exceeded.`,
      undefined,
      { "retry-after": retryAfterSeconds(rl.reset) },
    );
  }

  const config = auth.config;

  // INTENTIONAL: this route fans out `fetch` calls directly and does NOT go
  // through the breaker/fallback engine (routeRequest). Listing models has no
  // fallback semantics — it aggregates EVERY configured provider's catalog, so a
  // dead provider simply contributes an empty list (caught below) rather than
  // failing over to another. A circuit breaker would add no value here. This is a
  // deliberate design choice, not an oversight.
  const entries = Object.entries(config.providers) as [ProviderId, string][];
  const lists = await Promise.all(
    entries.map(async ([provider, apiKey]) => {
      const def = PROVIDERS[provider];
      try {
        const res = await fetch(`${def.baseURL}/models`, {
          headers: def.authHeader(apiKey),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return [];
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        return (json.data ?? []).map((m) => ({
          id: `${provider}/${m.id}`,
          object: "model" as const,
          owned_by: provider,
        }));
      } catch {
        return []; // a dead provider must not break the listing
      }
    }),
  );

  return Response.json({ object: "list", data: lists.flat() });
}
