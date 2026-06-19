import { clientIp } from "@/lib/client-ip";
import { errJson } from "@/lib/errors";
import { PROVIDERS } from "@/lib/providers/registry";
import { checkIpLimit, retryAfterSeconds } from "@/lib/ratelimit";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rl = await checkIpLimit(clientIp(req));
  if (!rl.success) {
    return errJson(429, "rate_limit_exceeded", "Too many validation attempts.", undefined, {
      "retry-after": retryAfterSeconds(rl.reset),
    });
  }

  let body: { provider?: string; key?: string };
  try {
    body = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Body must be valid JSON.");
  }
  const provider = body.provider as ProviderId;
  if (!PROVIDERS[provider] || typeof body.key !== "string" || !body.key.trim()) {
    return errJson(400, "invalid_request_error", "`provider` and `key` are required.");
  }

  try {
    const def = PROVIDERS[provider];
    const res = await fetch(`${def.baseURL}/models`, {
      headers: def.authHeader(body.key.trim()),
      signal: AbortSignal.timeout(8000),
    });
    return Response.json({ valid: res.ok });
  } catch {
    return Response.json({ valid: false });
  }
}
