import { clientIp } from "@/lib/client-ip";
import { rotateKey } from "@/lib/config-store";
import { errJson } from "@/lib/errors";
import { checkIpLimit, retryAfterSeconds } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rl = await checkIpLimit(clientIp(req));
  if (!rl.success) {
    return errJson(429, "rate_limit_exceeded", "Too many requests.", undefined, {
      "retry-after": retryAfterSeconds(rl.reset),
    });
  }

  const gwKey = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const newKey = gwKey.startsWith("gw_") ? await rotateKey(gwKey) : null;
  if (!newKey) return errJson(401, "invalid_api_key", "Unknown gateway key.");
  return Response.json({ gatewayKey: newKey });
}
