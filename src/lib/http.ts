import { clientIp } from "./client-ip";
import { errJson, redactKeys } from "./errors";
import { checkIpLimit, retryAfterSeconds } from "./ratelimit";

/**
 * Shared HTTP helpers for the route handlers. These were previously duplicated
 * verbatim across several routes (bearerKey ×5, ipGate ×2, the redact-error-body
 * helper between chat and embeddings). Centralizing them keeps behavior identical
 * while removing the copy-paste drift risk.
 */

/** Extract the gateway key from `Authorization: Bearer <key>` (trimmed). */
export function bearerKey(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Per-IP gate for the config endpoints (anti key-spam / brute force). Returns a
 * 429 Response when the IP limit is tripped, or null to proceed. Fails OPEN inside
 * checkIpLimit on a Redis brownout.
 */
export async function ipGate(req: Request): Promise<Response | null> {
  const rl = await checkIpLimit(clientIp(req));
  if (rl.success) return null;
  return errJson(429, "rate_limit_exceeded", "Too many requests. Try again shortly.", undefined, {
    "retry-after": retryAfterSeconds(rl.reset),
  });
}

/**
 * Build a non-streaming error Response from a failed upstream, redacting any
 * provider-key fingerprint the upstream echoed into its error message (so the
 * gw-key holder never sees the last-4 of the configured provider key). Reads the
 * body, redacts `error.message` if present, and re-emits with the given headers.
 * Only call on the NON-STREAMING error path (it consumes the body).
 */
export async function redactedErrorResponse(
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
