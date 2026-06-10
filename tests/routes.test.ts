import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeRedis } from "./fake-redis";
import { setRedisForTests, createConfig, createSubKey } from "@/lib/config-store";

/**
 * Route-handler integration tests.
 *
 * App Router handlers are plain `async (req: Request) => Response` functions, so
 * we import and call them directly with a `new Request(...)` — no server needed.
 *
 * Mocking strategy:
 *  - next/server `after` is stubbed in tests/setup.ts (runs cb synchronously).
 *  - @/lib/ratelimit is mocked HERE so every limiter is controllable per-test:
 *    by default all gates PASS; individual tests flip a flag to force a 429.
 *    This lets us deterministically test BOTH the pass path and the rate-limit
 *    path of each route. (The Upstash sliding-window internals — Lua/eval — stay
 *    integration-only; FakeRedis can't run them. We pin that the route CONSULTS
 *    the limiter, which is the mutation we care about.)
 */

// ─── Controllable ratelimit mock ────────────────────────────────────────────
const rlState = {
  rpm: { success: true, reset: Date.now() + 60_000 },
  ip: { success: true, reset: Date.now() + 60_000 },
  token: { success: true, reset: Date.now() + 60_000 },
};

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(async () => rlState.rpm),
  checkIpLimit: vi.fn(async () => rlState.ip),
  checkTokenLimit: vi.fn(async () => rlState.token),
  recordTokens: vi.fn(async () => {}),
  retryAfterSeconds: (reset: number) =>
    String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
}));

// Import route handlers AFTER the mock is declared (vi.mock is hoisted, so order
// is cosmetic, but keep it explicit).
import { POST as subkeysPOST, GET as subkeysGET, DELETE as subkeysDELETE } from "@/app/api/config/subkeys/route";
import { GET as configGET } from "@/app/api/config/route";
import { POST as chatPOST } from "@/app/v1/chat/completions/route";
import { POST as messagesPOST } from "@/app/v1/messages/route";
import { POST as embeddingsPOST } from "@/app/v1/embeddings/route";

const PARENT_KEY = "gw_live_routetest";
const INPUT = {
  providers: { openai: "sk-openai-fake-key-1234567890" }, // >= 16 chars so maskKey reveals
  fallbackChain: [{ provider: "openai" as const, model: "gpt-4o" }],
  rateLimit: { rpm: 60, tpm: 50_000 },
};

let redis: FakeRedis;
let subKey: string;

beforeEach(async () => {
  // Reset rate-limit gates to "pass" before each test.
  rlState.rpm = { success: true, reset: Date.now() + 60_000 };
  rlState.ip = { success: true, reset: Date.now() + 60_000 };
  rlState.token = { success: true, reset: Date.now() + 60_000 };

  redis = new FakeRedis();
  setRedisForTests(redis as never);
  await createConfig(PARENT_KEY, INPUT);
  subKey = (await createSubKey(PARENT_KEY, { label: "worker" }))!;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function req(url: string, init?: RequestInit & { bearer?: string }): Request {
  const headers = new Headers(init?.headers);
  if (init?.bearer) headers.set("authorization", `Bearer ${init.bearer}`);
  return new Request(url, { ...init, headers });
}

// ─── Sub-key privilege boundary (MUTATION 1: 403 management-block) ───────────
describe("POST /api/config/subkeys — sub-key privilege boundary", () => {
  it("rejects a gw_sub_ bearer with 403 (mutation 1)", async () => {
    // A real minted sub-key tries to mint another sub-key → must be 403.
    // FAILS if the `gwKey.startsWith("gw_sub_")` 403 block is deleted (it would
    // then fall through to createSubKey, which returns null → 401, or 201).
    const res = await subkeysPOST(
      req("http://t/api/config/subkeys", {
        method: "POST",
        bearer: subKey,
        body: JSON.stringify({ label: "nested" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("GET rejects a gw_sub_ bearer with 403", async () => {
    const res = await subkeysGET(req("http://t/api/config/subkeys", { bearer: subKey }));
    expect(res.status).toBe(403);
  });

  it("DELETE rejects a gw_sub_ bearer with 403", async () => {
    const res = await subkeysDELETE(
      req("http://t/api/config/subkeys", {
        method: "DELETE",
        bearer: subKey,
        body: JSON.stringify({ id: "deadbeef" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("accepts the PARENT key and returns 201 with a gw_sub_ key", async () => {
    const res = await subkeysPOST(
      req("http://t/api/config/subkeys", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ label: "ci" }),
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.gatewayKey).toMatch(/^gw_sub_/);
  });

  it("rejects a non-gw bearer with 401", async () => {
    const res = await subkeysPOST(
      req("http://t/api/config/subkeys", {
        method: "POST",
        bearer: "sk-not-a-gateway-key",
        body: JSON.stringify({ label: "x" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/config — sub-key cannot read config", () => {
  it("returns 401 for a gw_sub_ key (config read is parent-only)", async () => {
    // getConfig(subKey) misses (sub-keys aren't config records) → 401.
    const res = await configGET(req("http://t/api/config", { bearer: subKey }));
    expect(res.status).toBe(401);
  });

  it("returns 200 for the parent key with masked providers", async () => {
    const res = await configGET(req("http://t/api/config", { bearer: PARENT_KEY }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers.openai).toContain("…"); // masked
  });
});

// ─── Chat route: auth + validation + headers + rate-limit (MUTATION 2) ───────
describe("POST /v1/chat/completions", () => {
  it("rejects missing bearer with 401", async () => {
    const res = await chatPOST(
      req("http://t/v1/chat/completions", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an unknown gw key with 401", async () => {
    const res = await chatPOST(
      req("http://t/v1/chat/completions", {
        method: "POST",
        bearer: "gw_live_unknown",
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a body missing model/messages with 400", async () => {
    const res = await chatPOST(
      req("http://t/v1/chat/completions", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ messages: [] }), // no model
      }),
    );
    expect(res.status).toBe(400);
  });

  it("happy path: returns 200 and sets x-gateway-provider (fetch stubbed)", async () => {
    // Stub global fetch so routeRequest's upstream call returns a 200 OpenAI JSON.
    const openaiJson = {
      id: "chatcmpl-1",
      model: "gpt-4o",
      choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { total_tokens: 5 },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(openaiJson), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const res = await chatPOST(
      req("http://t/v1/chat/completions", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-provider")).toBe("openai");
  });

  it("returns 429 with retry-after when the RPM limiter fails (mutation 2)", async () => {
    // Force the limiter to deny. The route MUST consult checkRateLimit and
    // short-circuit to 429 — deleting/breaking that call would let the request
    // reach validation/200 instead. Pins that the limiter is actually wired.
    rlState.rpm = { success: false, reset: Date.now() + 30_000 };
    const res = await chatPOST(
      req("http://t/v1/chat/completions", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });
});

// ─── /v1/messages: Anthropic error-shape on every path ───────────────────────
describe("POST /v1/messages — Anthropic error shape", () => {
  function expectAnthropicError(body: any) {
    // Anthropic shape: { type: "error", error: { type, message } }.
    // NOT OpenAI shape (which would be { error: { ..., code } } with no top
    // type:"error"). Assert the Anthropic discriminator and the absence of the
    // OpenAI-style top-level structure.
    expect(body.type).toBe("error");
    expect(body.error).toBeDefined();
    expect(typeof body.error.type).toBe("string");
    expect(typeof body.error.message).toBe("string");
  }

  it("invalid bearer → 401 in Anthropic shape (not OpenAI)", async () => {
    const res = await messagesPOST(
      req("http://t/v1/messages", { method: "POST", bearer: "not-a-key", body: "{}" }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expectAnthropicError(body);
  });

  it("missing max_tokens → 400 Anthropic shape", async () => {
    const res = await messagesPOST(
      req("http://t/v1/messages", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "auto", messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(res.status).toBe(400);
    expectAnthropicError(await res.json());
  });

  it("malformed JSON body → Anthropic-shaped error (not a Next 500)", async () => {
    const res = await messagesPOST(
      req("http://t/v1/messages", {
        method: "POST",
        bearer: PARENT_KEY,
        body: "{ not json",
      }),
    );
    expect(res.status).toBe(400);
    expectAnthropicError(await res.json());
  });

  it("translator throw (messages:[null]) → 500 in Anthropic shape (BUG 1 fix)", async () => {
    // fromAnthropicRequest's mapMessage(null) throws (reads .content on null).
    // Without the try/catch around the translator this would escape to a
    // non-Anthropic Next.js 500. The route's guard must produce status 500 with
    // the Anthropic { type:"error", ... } envelope.
    const res = await messagesPOST(
      req("http://t/v1/messages", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "auto", max_tokens: 10, messages: [null] }),
      }),
    );
    expect(res.status).toBe(500);
    expectAnthropicError(await res.json());
  });
});

// ─── /v1/embeddings validation ───────────────────────────────────────────────
describe("POST /v1/embeddings — validation", () => {
  it("rejects an anthropic-provider model with 400 (no embeddings API)", async () => {
    const res = await embeddingsPOST(
      req("http://t/v1/embeddings", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "anthropic/whatever", input: "hi" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects bare 'auto' with 400 (must be provider/model)", async () => {
    const res = await embeddingsPOST(
      req("http://t/v1/embeddings", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "auto", input: "hi" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing input with 400", async () => {
    const res = await embeddingsPOST(
      req("http://t/v1/embeddings", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "openai/text-embedding-3-small" }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
