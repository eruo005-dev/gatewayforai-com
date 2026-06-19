import { rotateKey } from "@/lib/config-store";
import { errJson } from "@/lib/errors";
import { bearerKey, ipGate } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const gate = await ipGate(req);
  if (gate) return gate;

  const gwKey = bearerKey(req);
  const newKey = gwKey.startsWith("gw_") ? await rotateKey(gwKey) : null;
  if (!newKey) return errJson(401, "invalid_api_key", "Unknown gateway key.");
  return Response.json({ gatewayKey: newKey });
}
