import {
  createConfig, deleteConfig, getConfig, updateConfig,
} from "@/lib/config-store";
import { clientIp } from "@/lib/client-ip";
import { generateGatewayKey, maskKey, sha256 } from "@/lib/crypto";
import { errJson } from "@/lib/errors";
import { checkIpLimit, retryAfterSeconds } from "@/lib/ratelimit";
import { getUsage, lastDays } from "@/lib/usage";
import { validateConfigInput } from "@/lib/validate";

export const runtime = "nodejs";

async function ipGate(req: Request): Promise<Response | null> {
  const rl = await checkIpLimit(clientIp(req));
  if (rl.success) return null;
  return errJson(429, "rate_limit_exceeded", "Too many requests. Try again shortly.", undefined, {
    "retry-after": retryAfterSeconds(rl.reset),
  });
}

function bearerKey(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** Create a config. Returns the gateway key — shown exactly once, never stored. */
export async function POST(req: Request) {
  const gate = await ipGate(req);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Body must be valid JSON.");
  }
  const { value, error } = validateConfigInput(body);
  if (error) return errJson(400, "invalid_request_error", error);

  const gatewayKey = generateGatewayKey();
  await createConfig(gatewayKey, value!);
  return Response.json({ gatewayKey }, { status: 201 });
}

/** Read masked config + 7-day usage. Auth: Bearer gw key. */
export async function GET(req: Request) {
  const gwKey = bearerKey(req);
  const config = gwKey.startsWith("gw_") ? await getConfig(gwKey) : null;
  if (!config) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  return Response.json({
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([p, k]) => [p, maskKey(k as string)]),
    ),
    fallbackChain: config.fallbackChain,
    rateLimit: config.rateLimit,
    createdAt: config.createdAt,
    usage: await getUsage(sha256(gwKey), lastDays(30)),
  });
}

/** Patch chain / rpm / provider keys (string = set, null = remove). */
export async function PATCH(req: Request) {
  const gate = await ipGate(req);
  if (gate) return gate;

  const gwKey = bearerKey(req);
  const config = gwKey.startsWith("gw_") ? await getConfig(gwKey) : null;
  if (!config) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  let patch: Record<string, any>;
  try {
    patch = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Body must be valid JSON.");
  }

  // Validate the MERGED result so a patch can never leave a broken config.
  const mergedProviders: Record<string, string> = { ...config.providers } as Record<string, string>;
  for (const [p, v] of Object.entries(patch.providers ?? {})) {
    if (v === null) delete mergedProviders[p];
    else mergedProviders[p] = v as string;
  }
  const { error } = validateConfigInput({
    providers: mergedProviders,
    fallbackChain: patch.fallbackChain ?? config.fallbackChain,
    rateLimit: patch.rateLimit ?? config.rateLimit,
  });
  if (error) return errJson(400, "invalid_request_error", error);

  await updateConfig(gwKey, {
    providers: patch.providers,
    fallbackChain: patch.fallbackChain,
    rateLimit: patch.rateLimit,
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const gwKey = bearerKey(req);
  if (!gwKey.startsWith("gw_") || !(await deleteConfig(gwKey))) {
    return errJson(401, "invalid_api_key", "Unknown gateway key.");
  }
  return Response.json({ ok: true });
}
