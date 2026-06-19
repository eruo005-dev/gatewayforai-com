/**
 * Trusted client-IP extraction.
 *
 * The leftmost entry of `x-forwarded-for` is fully client-controlled: anyone can
 * send `X-Forwarded-For: 1.2.3.4` and spoof it. Trusting the leftmost hop for
 * rate-limiting or abuse controls lets an attacker rotate a header value to dodge
 * every per-IP limit. We therefore extract the client IP from the RIGHT side of
 * the chain, where each entry is appended by an actual proxy we trust.
 *
 * Strategy (in order):
 *   1. `x-real-ip` — on Vercel this is set by the platform to the true client IP
 *      and cannot be spoofed by the caller, so prefer it when present.
 *   2. `x-forwarded-for` — a comma-separated chain `client, proxy1, proxy2, ...`
 *      where the RIGHTMOST entry is the hop closest to us. With N trusted proxy
 *      hops in front of the app, the real client is the Nth-from-the-right entry.
 *      Controlled by env `TRUSTED_PROXY_HOPS` (default "1": one trusted proxy in
 *      front, so the real client is the rightmost XFF entry). Extra spoofed
 *      entries the client prepends on the LEFT never shift this result.
 *   3. Fall back to "unknown".
 *
 * Env:
 *   TRUSTED_PROXY_HOPS — number of trusted reverse-proxy hops between the real
 *     client and this app (default 1). Set this to match your deployment:
 *     - Vercel: x-real-ip is used, so this rarely matters; 1 is a safe default.
 *     - Self-host behind one nginx/Cloudflare hop: 1 (rightmost XFF = client).
 *     - Two trusted hops (e.g. CDN -> LB -> app): 2.
 */
function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  const n = raw ? parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function clientIp(req: Request): string {
  // 1. Vercel's trusted header wins — it's set by the platform, not the caller.
  const real = (req.headers.get("x-real-ip") ?? "").trim();
  if (real) return real;

  // 2. Walk the XFF chain from the right by the number of trusted hops.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length > 0) {
      const hops = trustedProxyHops();
      // With `hops` trusted proxies in front, the real client sits `hops` entries
      // from the right end. Clamp to the leftmost available entry if the chain is
      // shorter than expected (fewer real hops than configured).
      const idx = Math.max(0, parts.length - hops);
      return parts[idx];
    }
  }

  // 3. Nothing usable.
  return "unknown";
}
