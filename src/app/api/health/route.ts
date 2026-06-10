import { redis } from "@/lib/config-store";

export const runtime = "nodejs";

export async function GET() {
  try {
    await redis().set("health:ping", Date.now());
    await redis().get("health:ping");
    return Response.json({
      ok: true,
      redis: true,
      version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    });
  } catch {
    return Response.json({ ok: false, redis: false }, { status: 503 });
  }
}
