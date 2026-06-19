import { redis } from "@/lib/config-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Always write WITH a TTL: this probe key has no reader after the get below,
    // so an expiry-less set would leak a key forever (breaks the "always set with
    // an expiry" invariant). 60s is ample for the immediate read-back.
    await redis().set("health:ping", Date.now(), { ex: 60 });
    await redis().get("health:ping");
    // Intentionally NO `version`/commit SHA in the response: a public health probe
    // shouldn't fingerprint the exact deployed commit. Uptime monitors only need
    // {ok, redis}.
    return Response.json({ ok: true, redis: true });
  } catch {
    return Response.json({ ok: false, redis: false }, { status: 503 });
  }
}
