import { redis } from "@/lib/config-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    await redis().set("health:ping", Date.now());
    await redis().get("health:ping");
    // Intentionally NO `version`/commit SHA in the response: a public health probe
    // shouldn't fingerprint the exact deployed commit. Uptime monitors only need
    // {ok, redis}.
    return Response.json({ ok: true, redis: true });
  } catch {
    return Response.json({ ok: false, redis: false }, { status: 503 });
  }
}
