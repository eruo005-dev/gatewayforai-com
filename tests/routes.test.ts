import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeRedis } from "./fake-redis";
import { setRedisForTests, createConfig, createSubKey, resolveGatewayAuth } from "@/lib/config-store";
import { sha256 } from "@/lib/crypto";

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
  gwIp: { success: true, reset: Date.now() + 60_000 },
  token: { success: true, reset: Date.now() + 60_000 },
};

vi.mock("@/lib/ratelimit", () => ({
  checkRateLimit: vi.fn(async () => rlState.rpm),
  checkIpLimit: vi.fn(async () => rlState.ip),
  checkGatewayIpLimit: vi.fn(async () => rlState.gwIp),
  checkTokenLimit: vi.fn(async () => rlState.token),
  recordTokens: vi.fn(async () => {}),
  retryAfterSeconds: (reset: number) =>
    String(Math.max(1, Math.ceil((reset - Date.now()) / 1000))),
}));

// Import route handlers AFTER the mock is declared (vi.mock is hoisted, so order
// is cosmetic, but keep it explicit).
import { POST as subkeysPOST, GET as subkeysGET, DELETE as subkeysDELETE } from "@/app/api/config/subkeys/route";
import { GET as configGET, POST as configPOST } from "@/app/api/config/route";
import { POST as chatPOST } from "@/app/v1/chat/completions/route";
import { POST as messagesPOST } from "@/app/v1/messages/route";
import { POST as embeddingsPOST } from "@/app/v1/embeddings/route";
import { GET as modelsGET } from "@/app/v1/models/route";
import { GET as healthGET } from "@/app/api/health/route";

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
  rlState.gwIp = { success: true, reset: Date.now() + 60_000 };
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

  it("DELETE with a 1-char id → 400 (must be the full 8-char id) (FIX 4)", async () => {
    // A short prefix could revoke an unintended sub-key via startsWith — reject it.
    const res = await subkeysDELETE(
      req("http://t/api/config/subkeys", {
        method: "DELETE",
        bearer: PARENT_KEY,
        body: JSON.stringify({ id: sha256(subKey).slice(0, 1) }),
      }),
    );
    expect(res.status).toBe(400);
    // The sub-key must still resolve (it was NOT revoked).
    expect(await resolveGatewayAuth(subKey)).not.toBeNull();
  });

  it("DELETE with the correct 8-char id revokes the sub-key (FIX 4)", async () => {
    const id = sha256(subKey).slice(0, 8);
    const res = await subkeysDELETE(
      req("http://t/api/config/subkeys", {
        method: "DELETE",
        bearer: PARENT_KEY,
        body: JSON.stringify({ id }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await resolveGatewayAuth(subKey)).toBeNull();
  });

  it("DELETE unknown id → 404; valid id → revoked (auth null after) (MEDIUM 15)", async () => {
    // Unknown id: no match in the parent index → 404.
    const miss = await subkeysDELETE(
      req("http://t/api/config/subkeys", {
        method: "DELETE",
        bearer: PARENT_KEY,
        body: JSON.stringify({ id: "ffffffff" }),
      }),
    );
    expect(miss.status).toBe(404);

    // Valid id: revoke the sub-key minted in beforeEach. Its id is the first 8
    // hex chars of sha256(subKey). After revoke, resolveGatewayAuth(subKey)
    // must return null (record deleted + removed from parent index).
    const id = sha256(subKey).slice(0, 8);
    expect(await resolveGatewayAuth(subKey)).not.toBeNull();
    const hit = await subkeysDELETE(
      req("http://t/api/config/subkeys", {
        method: "DELETE",
        bearer: PARENT_KEY,
        body: JSON.stringify({ id }),
      }),
    );
    expect(hit.status).toBe(200);
    expect(await resolveGatewayAuth(subKey)).toBeNull();
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

  it("success response sets provider/fallback-count/latency headers (CRITICAL 1)", async () => {
    // Pins ALL three gateway headers on the 200 path. Kills a mutation that
    // deletes the headers.set("x-gateway-fallback-count"/"x-gateway-latency-ms")
    // lines (the bare provider assertion above wouldn't catch those).
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
    expect(res.headers.get("x-gateway-fallback-count")).toBe("0");
    expect(Number(res.headers.get("x-gateway-latency-ms"))).toBeGreaterThanOrEqual(0);
  });

  it("returns 429 with /token/i + retry-after when the TPM limiter fails (CRITICAL 2)", async () => {
    // PARENT_KEY's config has tpm: 50_000 (see INPUT), so the route consults
    // checkTokenLimit. Force it to deny → must 429 with a token-shaped error.
    // Kills a mutation that removes the `if (limits.tpm) checkTokenLimit` gate
    // (the request would then reach the stubbed-fetch 200 instead).
    rlState.token = { success: false, reset: Date.now() + 30_000 };
    // Fetch must NOT be reached; if the gate is removed it would be — stub a 200
    // so a broken gate fails LOUDLY here (we assert 429, not 200).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ id: "x", model: "gpt-4o", choices: [], usage: {} }), {
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
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    const body = await res.json();
    expect(body.error.code).toMatch(/token/i);
  });

  it("cache hit: second identical request returns x-gateway-cache: hit, fetch once (MEDIUM 14)", async () => {
    const openaiJson = {
      id: "chatcmpl-cache",
      model: "gpt-4o",
      choices: [{ message: { role: "assistant", content: "cached" }, finish_reason: "stop" }],
      usage: { total_tokens: 7 },
    };
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(openaiJson), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const make = () =>
      chatPOST(
        req("http://t/v1/chat/completions", {
          method: "POST",
          bearer: PARENT_KEY,
          headers: { "x-gateway-cache": "60" },
          body: JSON.stringify({ model: "openai/gpt-4o", messages: [{ role: "user", content: "cache me" }] }),
        }),
      );
    const first = await make();
    expect(first.status).toBe(200);
    expect(first.headers.get("x-gateway-cache")).toBe("miss");
    const firstBody = await first.text();

    const second = await make();
    expect(second.status).toBe(200);
    expect(second.headers.get("x-gateway-cache")).toBe("hit");
    expect(await second.text()).toBe(firstBody);
    // Upstream hit exactly once — the second request was served from cache.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 429 (before auth) when the per-IP gateway limiter fails (FIX 1)", async () => {
    // The per-IP gate runs BEFORE auth. With NO bearer at all, a tripped IP
    // limit must still 429 — proving the IP check short-circuits ahead of the
    // auth lookup. Deleting the gate would let this reach the 401 auth path.
    rlState.gwIp = { success: false, reset: Date.now() + 30_000 };
    const res = await chatPOST(
      req("http://t/v1/chat/completions", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
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

  // ─── Header whitelist: no upstream-header / key-fingerprint leak (RED-TEAM) ──
  it("error path: drops leaky upstream headers + stale content-length, redacts key, keeps x-gateway-*", async () => {
    // Upstream returns a 401 whose headers carry a key fingerprint (x-error-json),
    // a cookie, an openai version header, and a content-length that does NOT match
    // our (redacted) body. The gateway response must carry NONE of those and a
    // redacted body — and still emit the x-gateway-* observability headers.
    const upstreamBody = JSON.stringify({
      error: { message: "Incorrect API key provided: sk-proj-************9999", type: "invalid_request_error" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(upstreamBody, {
          status: 401,
          headers: {
            "content-type": "application/json",
            "content-length": "999",
            "set-cookie": "sess=x",
            "x-error-json": "eyJrIjoic2stcHJvai05OTk5In0=",
            "x-openai-version": "1",
            "x-request-id": "req-abc",
          },
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
    expect(res.status).toBe(401);
    // Leaky upstream headers dropped:
    expect(res.headers.get("x-error-json")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-openai-version")).toBeNull();
    expect(res.headers.get("x-request-id")).toBeNull();
    // Stale upstream content-length (999) must not survive — runtime recomputes.
    expect(res.headers.get("content-length")).not.toBe("999");
    // Gateway observability headers preserved:
    expect(res.headers.get("x-gateway-provider")).toBe("openai");
    expect(res.headers.get("x-gateway-fallback-count")).toBeTruthy();
    // Body fingerprint redacted:
    const text = await res.text();
    expect(text).not.toContain("9999");
    expect(text).not.toContain("sk-proj-");
    expect(text).toContain("sk-***redacted***");
  });

  it("STREAMING error path: redacts key fingerprint (a non-ok upstream is buffered, not a live stream)", async () => {
    // REGRESSION (HIGH): a streaming request (stream:true) whose upstream errors
    // BEFORE the first token must still have its provider-key fingerprint redacted.
    // A non-ok upstream is always a buffered JSON error body (callProvider returns
    // the raw upstream Response on !res.ok before any stream translation), so the
    // route must read+redact it rather than passing it through verbatim. Previously
    // the `!body.stream` guard skipped redaction and leaked `sk-proj-…9999`.
    const upstreamBody = JSON.stringify({
      error: { message: "Incorrect API key provided: sk-proj-************9999", type: "invalid_request_error" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(upstreamBody, {
          status: 401,
          headers: { "content-type": "application/json", "x-error-json": "leak" },
        }),
      ),
    );
    const res = await chatPOST(
      req("http://t/v1/chat/completions", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({
          model: "openai/gpt-4o",
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("x-error-json")).toBeNull();
    const text = await res.text();
    expect(text).not.toContain("9999");
    expect(text).not.toContain("sk-proj-");
    expect(text).toContain("sk-***redacted***");
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

  it("per-IP limit trip → 429 in Anthropic shape, before auth (FIX 1)", async () => {
    rlState.gwIp = { success: false, reset: Date.now() + 30_000 };
    const res = await messagesPOST(
      req("http://t/v1/messages", { method: "POST", body: "{}" }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expectAnthropicError(await res.json());
  });

  // Stub fetch → a 200 OpenAI chat-completion that the route translates to an
  // Anthropic Messages response.
  function stubOpenAi200() {
    const openaiJson = {
      id: "chatcmpl-msg",
      model: "gpt-4o",
      choices: [{ message: { role: "assistant", content: "hello there" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
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
  }

  it("happy path: 200 Anthropic message body + gateway headers (CRITICAL 4)", async () => {
    // Kills translation/path regressions: a broken fromAnthropicRequest →
    // toAnthropicResponse pipeline or a dropped gateway-header block would fail
    // one of these assertions.
    stubOpenAi200();
    const res = await messagesPOST(
      req("http://t/v1/messages", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({
          model: "openai/gpt-4o",
          max_tokens: 64,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-provider")).toBe("openai");
    expect(res.headers.get("x-gateway-fallback-count")).toBe("0");
    expect(Number(res.headers.get("x-gateway-latency-ms"))).toBeGreaterThanOrEqual(0);
    const body = await res.json();
    expect(body.type).toBe("message");
    expect(body.content[0].type).toBe("text");
    expect(typeof body.usage.input_tokens).toBe("number");
  });

  it("authenticates via x-api-key header (no Authorization) (CRITICAL 5)", async () => {
    // Send the key ONLY via x-api-key. Kills a mutation that swaps the
    // x-api-key / Authorization precedence (or drops x-api-key support) — the
    // route would then 401 instead of 200.
    stubOpenAi200();
    const res = await messagesPOST(
      new Request("http://t/v1/messages", {
        method: "POST",
        headers: { "x-api-key": PARENT_KEY, "content-type": "application/json" },
        body: JSON.stringify({
          model: "openai/gpt-4o",
          max_tokens: 32,
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-provider")).toBe("openai");
  });

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

  it("malformed messages:[null] never crashes the route, returns Anthropic error shape (HARDENING)", async () => {
    // fromAnthropicRequest is now TOTAL: mapMessage(null) is skipped rather than
    // throwing (reads of .content on null are guarded). The route must therefore
    // never escape to a non-Anthropic Next.js 500. It proceeds with a best-effort
    // translation; with no upstream reachable in this harness it surfaces a
    // well-formed Anthropic { type:"error", ... } envelope (not a framework crash).
    const res = await messagesPOST(
      req("http://t/v1/messages", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "auto", max_tokens: 10, messages: [null] }),
      }),
    );
    // Any non-2xx is acceptable; what matters is it's a structured Anthropic error,
    // never a thrown exception / framework 500 with a non-Anthropic body.
    expect(res.status).toBeGreaterThanOrEqual(400);
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

  it("happy path: 200 + x-gateway-provider for a valid embeddings request (MEDIUM 13)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ object: "list", data: [{ embedding: [0.1, 0.2] }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const res = await embeddingsPOST(
      req("http://t/v1/embeddings", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "openai/text-embedding-3-small", input: "hi" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-provider")).toBe("openai");
  });

  // ─── HIGH-2: embeddings was fully unredacted + copied upstream headers ───────
  it("success path: drops leaky upstream headers (no x-error-json/set-cookie/content-length leak)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ object: "list", data: [{ embedding: [0.1, 0.2] }] }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "999",
            "set-cookie": "sess=x",
            "x-openai-version": "1",
            "x-request-id": "req-emb",
          },
        }),
      ),
    );
    const res = await embeddingsPOST(
      req("http://t/v1/embeddings", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "openai/text-embedding-3-small", input: "hi" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-gateway-provider")).toBe("openai");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-openai-version")).toBeNull();
    expect(res.headers.get("x-request-id")).toBeNull();
    expect(res.headers.get("content-length")).not.toBe("999");
  });

  it("error path: redacts key fingerprint + drops x-error-json/content-length, keeps x-gateway-provider", async () => {
    const upstreamBody = JSON.stringify({
      error: { message: "Incorrect API key provided: sk-proj-************9999", type: "invalid_request_error" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(upstreamBody, {
          status: 401,
          headers: {
            "content-type": "application/json",
            "content-length": "999",
            "set-cookie": "sess=x",
            "x-error-json": "eyJrIjoic2stcHJvai05OTk5In0=",
            "x-openai-version": "1",
          },
        }),
      ),
    );
    const res = await embeddingsPOST(
      req("http://t/v1/embeddings", {
        method: "POST",
        bearer: PARENT_KEY,
        body: JSON.stringify({ model: "openai/text-embedding-3-small", input: "hi" }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("x-error-json")).toBeNull();
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-openai-version")).toBeNull();
    expect(res.headers.get("content-length")).not.toBe("999");
    expect(res.headers.get("x-gateway-provider")).toBe("openai");
    const text = await res.text();
    expect(text).not.toContain("9999");
    expect(text).not.toContain("sk-proj-");
    expect(text).toContain("sk-***redacted***");
  });
});

// ─── /v1/models: authed listing (HIGH 7) ────────────────────────────────────
describe("GET /v1/models", () => {
  it("authed success: lists provider/model entries as OpenAI 'list' shape", async () => {
    // Stub the per-provider /models fetch. Asserts the route prefixes the model
    // id with provider/ and wraps the result in the OpenAI list envelope.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: [{ id: "gpt-4o" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const res = await modelsGET(req("http://t/v1/models", { bearer: PARENT_KEY }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.object).toBe("list");
    const entry = body.data.find((m: any) => m.id === "openai/gpt-4o");
    expect(entry).toBeDefined();
    expect(entry.object).toBe("model");
  });

  it("rejects a bad gw key with 401", async () => {
    const res = await modelsGET(req("http://t/v1/models", { bearer: "gw_live_unknown" }));
    expect(res.status).toBe(401);
  });

  it("per-IP limit trip → 429 before auth", async () => {
    rlState.gwIp = { success: false, reset: Date.now() + 30_000 };
    const res = await modelsGET(req("http://t/v1/models", { bearer: "garbage" }));
    expect(res.status).toBe(429);
  });
});

// ─── POST /api/config: create config (HIGH 9) ───────────────────────────────
describe("POST /api/config — create", () => {
  const VALID_BODY = {
    providers: { openai: "sk-openai-fake-key-1234567890" },
    fallbackChain: [{ provider: "openai", model: "gpt-4o" }],
    rateLimit: { rpm: 60 },
  };

  it("create returns 201 with a gw_live_ gateway key", async () => {
    const res = await configPOST(
      req("http://t/api/config", { method: "POST", body: JSON.stringify(VALID_BODY) }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.gatewayKey).toMatch(/^gw_live_/);
  });

  it("invalid body (no providers) → 400", async () => {
    const res = await configPOST(
      req("http://t/api/config", {
        method: "POST",
        body: JSON.stringify({ fallbackChain: [{ provider: "openai", model: "gpt-4o" }], rateLimit: { rpm: 60 } }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("ipGate forced fail → 429", async () => {
    rlState.ip = { success: false, reset: Date.now() + 30_000 };
    const res = await configPOST(
      req("http://t/api/config", { method: "POST", body: JSON.stringify(VALID_BODY) }),
    );
    expect(res.status).toBe(429);
  });

  it("per-IP daily creation cap → 429 after the limit is exceeded (FIX 1)", async () => {
    // The 20/min IP limiter is mocked to PASS, so this isolates the daily cap
    // (bumpConfigCreateCount, backed by FakeRedis). Default cap is 50; the 51st
    // create from the same IP must 429. All requests share clientIp()="unknown"
    // here (no x-real-ip / x-forwarded-for), so they hit one IP counter.
    const make = () =>
      configPOST(req("http://t/api/config", { method: "POST", body: JSON.stringify(VALID_BODY) }));
    for (let i = 0; i < 50; i++) {
      expect((await make()).status).toBe(201);
    }
    const capped = await make();
    expect(capped.status).toBe(429);
    const body = await capped.json();
    expect(body.error.code).toBe("rate_limit_exceeded");
  });
});

// ─── GET /api/health: ok + 503 (HIGH 8) ─────────────────────────────────────
describe("GET /api/health", () => {
  it("normal → 200 { ok:true, redis:true } and NO version/commit SHA (FIX 3)", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.redis).toBe(true);
    // The public probe must not fingerprint the deployed commit.
    expect(body).not.toHaveProperty("version");
  });

  it("redis set/get throws → 503 { ok:false }", async () => {
    redis.set = (async () => {
      throw new Error("redis down");
    }) as never;
    const res = await healthGET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });
});
