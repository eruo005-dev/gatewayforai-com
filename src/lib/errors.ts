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
 * Matched shapes (longest-prefix first so e.g. `sk-ant-` and `sk-proj-` are caught
 * by the general `sk-` rule):
 *   - OpenAI / generic:  sk-...           (incl. sk-proj-, sk-ant-, sk-or-, ...)
 *   - Groq:              gsk_...
 *   - Google:            AIza...
 * Only error message strings should be passed here — never successful bodies.
 */
export function redactKeys(s: string): string {
  if (!s) return s;
  return s
    // sk- followed by any run of key-ish chars (also covers sk-ant-/sk-proj-),
    // including masked forms that use *, …, or . as fillers.
    .replace(/sk-[A-Za-z0-9_*.…-]{2,}/g, "sk-***redacted***")
    .replace(/gsk_[A-Za-z0-9_*.…-]{2,}/g, "gsk_***redacted***")
    .replace(/AIza[A-Za-z0-9_*.…-]{2,}/g, "AIza***redacted***");
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
