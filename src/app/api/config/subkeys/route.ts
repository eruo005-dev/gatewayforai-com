import {
  createSubKey,
  listSubKeys,
  revokeSubKey,
  resolveGatewayAuth,
} from "@/lib/config-store";
import { clientIp } from "@/lib/client-ip";
import { sha256 } from "@/lib/crypto";
import { errJson } from "@/lib/errors";
import { checkIpLimit, retryAfterSeconds } from "@/lib/ratelimit";

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

/** Validate label and optional rpm/tpm using the same ranges as validate.ts */
function validateSubKeyInput(body: Record<string, any>): string | null {
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 40) {
    return "label must be between 1 and 40 characters.";
  }
  if (body.rpm !== undefined && body.rpm !== null) {
    const rpm = body.rpm;
    if (!Number.isInteger(rpm) || rpm < 1 || rpm > 1000) {
      return "rateLimit.rpm must be an integer between 1 and 1000.";
    }
  }
  if (body.tpm !== undefined && body.tpm !== null) {
    const tpm = body.tpm;
    if (!Number.isInteger(tpm) || tpm < 1000 || tpm > 10_000_000) {
      return "rateLimit.tpm must be an integer between 1000 and 10000000.";
    }
  }
  return null;
}

/**
 * POST /api/config/subkeys — mint a new sub-key.
 * Bearer must be a parent key (gw_live_). Sub-keys (gw_sub_) get 403.
 * Body: { label: string, rpm?: number, tpm?: number }
 * Returns: 201 { gatewayKey } — shown once.
 */
export async function POST(req: Request) {
  const gate = await ipGate(req);
  if (gate) return gate;

  const gwKey = bearerKey(req);
  if (!gwKey.startsWith("gw_")) {
    return errJson(401, "invalid_api_key", "Pass your gateway key as: Authorization: Bearer gw_live_...");
  }
  if (gwKey.startsWith("gw_sub_")) {
    return errJson(403, "forbidden", "sub-keys cannot manage the config");
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Body must be valid JSON.");
  }

  const validationError = validateSubKeyInput(body);
  if (validationError) return errJson(400, "invalid_request_error", validationError);

  const opts: { label: string; rpm?: number; tpm?: number } = {
    label: (body.label as string).trim(),
    ...(body.rpm != null ? { rpm: body.rpm as number } : {}),
    ...(body.tpm != null ? { tpm: body.tpm as number } : {}),
  };

  let gatewayKey: string | null;
  try {
    gatewayKey = await createSubKey(gwKey, opts);
  } catch (e) {
    return errJson(400, "invalid_request_error", (e as Error).message);
  }

  if (!gatewayKey) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  return Response.json({ gatewayKey }, { status: 201 });
}

/**
 * GET /api/config/subkeys — list sub-keys.
 * Bearer must be a parent key. Sub-keys get 403.
 * Returns array of { id (first 8 chars of hash), label, rpm?, tpm?, createdAt }.
 */
export async function GET(req: Request) {
  const gwKey = bearerKey(req);
  if (!gwKey.startsWith("gw_")) {
    return errJson(401, "invalid_api_key", "Unknown gateway key.");
  }
  if (gwKey.startsWith("gw_sub_")) {
    return errJson(403, "forbidden", "sub-keys cannot manage the config");
  }

  const list = await listSubKeys(gwKey);
  if (!list) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  return Response.json(
    list.map(({ keyHash, label, rpm, tpm, createdAt }) => ({
      id: keyHash.slice(0, 8),
      label,
      ...(rpm !== undefined ? { rpm } : {}),
      ...(tpm !== undefined ? { tpm } : {}),
      createdAt,
    })),
  );
}

/**
 * DELETE /api/config/subkeys — revoke a sub-key by its id (first 8 chars of hash).
 * Bearer must be a parent key. Sub-keys get 403.
 * Body: { id: string }
 */
export async function DELETE(req: Request) {
  const gate = await ipGate(req);
  if (gate) return gate;

  const gwKey = bearerKey(req);
  if (!gwKey.startsWith("gw_")) {
    return errJson(401, "invalid_api_key", "Unknown gateway key.");
  }
  if (gwKey.startsWith("gw_sub_")) {
    return errJson(403, "forbidden", "sub-keys cannot manage the config");
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Body must be valid JSON.");
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return errJson(400, "invalid_request_error", "id is required.");

  // Resolve the id prefix to a full hash from the parent's index
  const list = await listSubKeys(gwKey);
  if (!list) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  const matches = list.filter((x) => x.keyHash.startsWith(id));
  if (matches.length === 0) return errJson(404, "not_found", "Sub-key not found.");
  if (matches.length > 1) return errJson(404, "not_found", "Ambiguous id prefix — no sub-key revoked.");

  const fullHash = matches[0].keyHash;
  await revokeSubKey(gwKey, fullHash);
  return Response.json({ ok: true });
}
