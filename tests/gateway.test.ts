import { describe, it, expect, vi } from "vitest";
import { resolveChain, routeRequest } from "@/lib/gateway";
import type { ChainEntry } from "@/lib/types";

const CHAIN: ChainEntry[] = [
  { provider: "openai", model: "gpt-4o" },
  { provider: "groq", model: "llama-3.3-70b-versatile" },
  { provider: "gemini", model: "gemini-2.0-flash" },
];
const KEYS = { openai: "sk-1", groq: "gsk-1", gemini: "AIza-1" };

/** fetchFn that returns queued responses in order; rejects when given an Error. */
function queuedFetch(queue: Array<Response | Error>) {
  return vi.fn(async () => {
    const next = queue.shift()!;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
}

describe("resolveChain", () => {
  it("auto → full chain filtered to providers with keys", () => {
    const chain = resolveChain("auto", CHAIN, { openai: "sk-1", gemini: "AIza-1" });
    expect(chain.map((e) => e.provider)).toEqual(["openai", "gemini"]);
  });

  it("explicit provider/model → single entry", () => {
    expect(resolveChain("groq/llama-3.3-70b-versatile", CHAIN, KEYS)).toEqual([
      { provider: "groq", model: "llama-3.3-70b-versatile" },
    ]);
  });

  it("keeps slashes inside model names", () => {
    const chain = resolveChain("together/meta-llama/Llama-3.3-70B-Instruct-Turbo", CHAIN, {
      together: "tk-1",
    });
    expect(chain[0].model).toBe("meta-llama/Llama-3.3-70B-Instruct-Turbo");
  });

  it("throws on unknown provider or missing key", () => {
    expect(() => resolveChain("nope/x", CHAIN, KEYS)).toThrow(/unknown provider/i);
    expect(() => resolveChain("mistral/m", CHAIN, KEYS)).toThrow(/no api key/i);
    expect(() => resolveChain("auto", CHAIN, {})).toThrow(/no api key/i);
  });
});

describe("routeRequest", () => {
  const body = { model: "auto", messages: [{ role: "user", content: "hi" }] };

  it("returns first success with fallbacks=0", async () => {
    const fetchFn = queuedFetch([Response.json({ id: "ok" })]);
    const r = await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn });
    expect(r.provider).toBe("openai");
    expect(r.fallbacks).toBe(0);
    expect(r.response.ok).toBe(true);
  });

  it("falls back on 429 then succeeds on second provider", async () => {
    const fetchFn = queuedFetch([
      Response.json({ e: 1 }, { status: 429 }),
      Response.json({ id: "ok" }),
    ]);
    const r = await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn });
    expect(r.provider).toBe("groq");
    expect(r.fallbacks).toBe(1);
  });

  it("falls back on 500 and on network error", async () => {
    const fetchFn = queuedFetch([
      Response.json({ e: 1 }, { status: 500 }),
      new TypeError("fetch failed"),
      Response.json({ id: "ok" }),
    ]);
    const r = await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn });
    expect(r.provider).toBe("gemini");
    expect(r.fallbacks).toBe(2);
  });

  it("does NOT fall back on 400 — caller's fault, passes through", async () => {
    const fetchFn = queuedFetch([Response.json({ e: 1 }, { status: 400 })]);
    const r = await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn });
    expect(r.response.status).toBe(400);
    expect(r.provider).toBe("openai");
  });

  it("single-entry chain passes any error through unchanged", async () => {
    const fetchFn = queuedFetch([Response.json({ e: 1 }, { status: 429 })]);
    const r = await routeRequest({
      body,
      chain: [{ provider: "openai", model: "gpt-4o" }],
      keys: KEYS,
      fetchFn,
    });
    expect(r.response.status).toBe(429);
  });

  it("timeout triggers fallback", async () => {
    let call = 0;
    const fetchFn = ((_url: unknown, init?: RequestInit) => {
      call++;
      if (call === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }
      return Promise.resolve(Response.json({ id: "ok" }));
    }) as unknown as typeof fetch;
    const r = await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn, timeoutMs: 30 });
    expect(r.provider).toBe("groq");
    expect(r.fallbacks).toBe(1);
  });

  it("all providers fail → 502 with per-attempt detail", async () => {
    const fetchFn = queuedFetch([
      Response.json({ e: 1 }, { status: 500 }),
      Response.json({ e: 2 }, { status: 429 }),
      new TypeError("fetch failed"),
    ]);
    const r = await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn });
    expect(r.response.status).toBe(502);
    expect(r.provider).toBe("none");
    const json = await r.response.json();
    expect(json.error.code).toBe("all_providers_failed");
    expect(json.error.attempts).toEqual([
      { provider: "openai", model: "gpt-4o", status: 500 },
      { provider: "groq", model: "llama-3.3-70b-versatile", status: 429 },
      { provider: "gemini", model: "gemini-2.0-flash", status: 0, error: "TypeError" },
    ]);
  });

  it("single-entry chain + transport error → 502 structured response", async () => {
    const fetchFn = queuedFetch([new TypeError("fetch failed")]);
    const r = await routeRequest({
      body,
      chain: [{ provider: "openai", model: "gpt-4o" }],
      keys: KEYS,
      fetchFn,
    });
    expect(r.response.status).toBe(502);
    expect(r.provider).toBe("none");
    const json = await r.response.json();
    expect(json.error.attempts).toHaveLength(1);
    expect(json.error.attempts[0].error).toBe("TypeError");
  });

  it("attempts at most 4 chain entries", async () => {
    const longChain: ChainEntry[] = [
      { provider: "openai", model: "a" },
      { provider: "groq", model: "b" },
      { provider: "gemini", model: "c" },
      { provider: "mistral", model: "d" },
      { provider: "deepseek", model: "e" },
    ];
    const keys = { openai: "1", groq: "2", gemini: "3", mistral: "4", deepseek: "5" };
    const fetchFn = vi.fn(async () => Response.json({ e: 1 }, { status: 500 }));
    await routeRequest({ body, chain: longChain, keys, fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  // --- Circuit breaker tests ---

  function fakeBreaker(open: string[] = []) {
    const failures: string[] = [];
    const successes: string[] = [];
    return {
      hooks: {
        isOpen: async (p: string) => open.includes(p),
        onFailure: async (p: string) => { failures.push(p); },
        onSuccess: async (p: string) => { successes.push(p); },
      },
      failures,
      successes,
    };
  }

  it("skips providers whose breaker is open", async () => {
    const b = fakeBreaker(["openai"]);
    const fetchFn = queuedFetch([Response.json({ id: "ok" })]);
    const r = await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn, breaker: b.hooks });
    expect(r.provider).toBe("groq");
    expect(r.fallbacks).toBe(1); // openai counted as a skipped attempt
  });

  it("records failures and successes on the breaker", async () => {
    const b = fakeBreaker();
    const fetchFn = queuedFetch([
      Response.json({ e: 1 }, { status: 500 }),
      Response.json({ id: "ok" }),
    ]);
    await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn, breaker: b.hooks });
    expect(b.failures).toEqual(["openai"]);
    expect(b.successes).toEqual(["groq"]);
  });

  it("ignores the breaker for single-entry chains", async () => {
    const b = fakeBreaker(["openai"]);
    const fetchFn = queuedFetch([Response.json({ id: "ok" })]);
    const r = await routeRequest({
      body, chain: [{ provider: "openai", model: "gpt-4o" }], keys: KEYS, fetchFn, breaker: b.hooks,
    });
    expect(r.provider).toBe("openai");
  });

  it("all-open breakers → 502 with BreakerOpen attempts", async () => {
    const b = fakeBreaker(["openai", "groq", "gemini"]);
    const fetchFn = queuedFetch([]);
    const r = await routeRequest({ body, chain: CHAIN, keys: KEYS, fetchFn, breaker: b.hooks });
    expect(r.response.status).toBe(502);
    const json = await r.response.json();
    expect(json.error.attempts.every((a: any) => a.error === "BreakerOpen")).toBe(true);
  });
});
