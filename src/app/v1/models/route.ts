import { getConfig } from "@/lib/config-store";
import { errJson } from "@/lib/errors";
import { PROVIDERS } from "@/lib/providers/registry";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const gwKey = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const config = gwKey.startsWith("gw_") ? await getConfig(gwKey) : null;
  if (!config) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  const entries = Object.entries(config.providers) as [ProviderId, string][];
  const lists = await Promise.all(
    entries.map(async ([provider, apiKey]) => {
      const def = PROVIDERS[provider];
      try {
        const res = await fetch(`${def.baseURL}/models`, {
          headers: def.authHeader(apiKey),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return [];
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        return (json.data ?? []).map((m) => ({
          id: `${provider}/${m.id}`,
          object: "model" as const,
          owned_by: provider,
        }));
      } catch {
        return []; // a dead provider must not break the listing
      }
    }),
  );

  return Response.json({ object: "list", data: lists.flat() });
}
