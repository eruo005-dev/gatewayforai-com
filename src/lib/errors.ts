const TYPE_BY_STATUS: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  404: "invalid_request_error",
  429: "rate_limit_error",
  502: "api_error",
};

/**
 * Redact provider-key fingerprints from an upstream error MESSAGE string before
 * we hand it back to the gw-key holder. Provider auth errors often echo their own
 * masked key (e.g. `Incorrect API key provided: sk-proj-****…9999`), which would
 * leak the last-4 of the configured provider key to the gateway caller. We replace
 * recognizable key shapes with a fixed redaction token.
 *
 * Matched shapes (longest-prefix first so e.g. `sk-ant-`, `sk-proj-` and `sk-or-`
 * are all caught by the general `sk-` rule):
 *   - OpenAI / Anthropic / OpenRouter / generic:  sk-...   (sk-proj-, sk-ant-, sk-or-)
 *   - Groq:        gsk_...
 *   - Google:      AIza...
 *   - xAI:         xai-...
 *   - Replicate:   r8_...
 * The trailing char class includes `*`, `…` and `.` so MASKED forms
 * (`sk-proj-****…9999`) are matched too. The `{2,}` minimum keeps normal prose
 * like a bare "sk-" or "r8" from matching — only real key-shaped runs are hit.
 * Only error message strings should be passed here — never successful bodies.
 */
export function redactKeys(s: string): string {
  if (!s) return s;
  return s
    // sk- followed by any run of key-ish chars (also covers sk-ant-/sk-proj-/sk-or-),
    // including masked forms that use *, …, or . as fillers.
    .replace(/sk-[A-Za-z0-9_*.…-]{2,}/g, "sk-***redacted***")
    .replace(/gsk_[A-Za-z0-9_*.…-]{2,}/g, "gsk_***redacted***")
    .replace(/AIza[A-Za-z0-9_*.…-]{2,}/g, "AIza***redacted***")
    .replace(/xai-[A-Za-z0-9_*.…-]{2,}/g, "xai-***redacted***")
    .replace(/r8_[A-Za-z0-9_*.…-]{2,}/g, "r8_***redacted***");
}

/**
 * Build a FRESH set of response headers for any /v1/* pass-through, carrying ONLY
 * a whitelist: the upstream `content-type` (if present) plus the gateway's own
 * observability headers. NOTHING else from the upstream Response is copied.
 *
 * Why a whitelist (not a blocklist): wholesale-copying upstream headers leaks
 * provider-side data to the gw-key holder and breaks the body:
 *   - `x-error-json` / `openai-*` / `x-oai-*` / `x-request-id` / `set-cookie` /
 *     `cf-*` / `x-ratelimit-*` would leak the provider key fingerprint, request
 *     ids, cookies and upstream rate-limit state to the caller.
 *   - a copied `content-length` / `content-encoding` / `transfer-encoding` would
 *     mismatch a redacted/rebuilt (shorter) body → the client hangs until
 *     maxDuration. Dropping them lets the runtime recompute the correct length.
 *
 * `gateway` holds the x-gateway-* headers the route already built (provider,
 * fallback-count, latency-ms, cache, cost-estimate-usd, route) plus retry-after
 * where the route sets it. Pass `upstream = null` when there is no upstream
 * response (e.g. a stream the route synthesizes); then content-type is left to
 * the caller's `gateway` map or the runtime default.
 */
export function gatewayHeaders(
  upstream: Response | null,
  gateway: Record<string, string>,
): Headers {
  const out = new Headers();
  const ct = upstream?.headers.get("content-type");
  if (ct) out.set("content-type", ct);
  for (const [k, v] of Object.entries(gateway)) out.set(k, v);
  return out;
}

export function errJson(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    { error: { message, type: TYPE_BY_STATUS[status] ?? "api_error", code, ...extra } },
    { status, headers },
  );
}
