# GatewayforAI.com — Design Spec

**Date:** 2026-06-10
**Status:** Approved by user
**Scope:** v1 — working BYOK LLM gateway + landing page, single Next.js app on Vercel

## Summary

GatewayforAI.com is an LLM gateway: one OpenAI-compatible API endpoint that proxies
requests to 8 upstream providers with per-key rate limiting and automatic fallback
routing. Users bring their own provider keys (BYOK). There is no signup — the
gateway key (`gw_live_...`) is the account. The landing page is a dark
terminal-luxe showcase ("piece of art" requirement).

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| v1 scope | Working gateway + landing site (not waitlist, not OSS-first) |
| Payment for tokens | BYOK — users' own provider keys, encrypted at rest |
| Auth model | No signup; gateway key is the account |
| Providers at launch | OpenAI, Anthropic, Google Gemini, Groq, Mistral, Together, DeepSeek, OpenRouter |
| Stack | Next.js (App Router) on Vercel + Upstash Redis (Approach A) |
| Visual style | Dark terminal-luxe: near-black, signal-green accent, monospace details |

## 1. Architecture

One Next.js 14+ App Router repo deployed to Vercel. Three logical layers:

- **Landing + setup UI** — static/SSR pages (`/`, `/start`, `/manage`, `/privacy`).
- **Config API** — `POST/GET/PATCH/DELETE /api/config`: create and manage gateway configs.
- **Gateway core** — `POST /v1/chat/completions` and `GET /v1/models`: the streaming proxy.

**Upstash Redis** is the only datastore: encrypted configs, rate-limit counters,
usage stats. A single `MASTER_KEY` environment variable on Vercel
encrypts/decrypts provider keys (AES-256-GCM). No other infrastructure.

Rationale: matches the user's existing GitHub → Vercel ship pipeline used for 34
prior sites; $0/month at low traffic; proxy logic can be lifted into a
long-running server later if serverless limits bite.

## 2. API surface

```ts
// User's code — only two lines change:
const client = new OpenAI({
  baseURL: "https://gatewayforai.com/v1",
  apiKey: "gw_live_...",
});
await client.chat.completions.create({
  model: "openai/gpt-4o", // or "auto" → use the config's fallback chain
  messages: [...],
});
```

- **Model addressing:** `provider/model` (e.g. `anthropic/claude-sonnet-4-6`,
  `groq/llama-3.3-70b`). The literal model name `"auto"` walks the config's
  fallback chain.
- **Compatibility:** fully OpenAI-compatible request/response shape, including SSE
  streaming. Anthropic and Gemini requests/responses are translated to/from
  OpenAI format inside the gateway. OpenAI, Groq, Mistral, Together, DeepSeek,
  and OpenRouter are natively OpenAI-compatible (base-URL + auth-header swap
  plus model-name pass-through).
- **Observability headers** on every response: `x-gateway-provider` (which
  provider answered), `x-gateway-fallback-count`, `x-gateway-latency-ms`.
- `GET /v1/models` returns the union of models addressable through the caller's
  configured providers, in OpenAI list format.

## 3. Data model & security

One Redis hash per config, keyed by `SHA-256(gw_key)`. The raw `gw_` key is shown
**once** at creation and never stored.

```
config:{keyHash} → {
  providers: { openai: <AES-256-GCM ciphertext>, anthropic: <...>, ... },
  fallbackChain: ["openai/gpt-4o", "groq/llama-3.3-70b", "gemini/gemini-2.0-flash"],
  rateLimit: { rpm: 60 },
  createdAt: <ISO timestamp>
}
usage:{keyHash}:{YYYY-MM-DD} → { requests, errors, fallbacks, perProvider counts }   // 30-day TTL
```

Security rules:

- Provider keys encrypted with AES-256-GCM, unique IV per value, master key only
  in Vercel env vars. Never logged, never returned by any endpoint.
- `GET /api/config` returns masked key tails only (e.g. `sk-...x4Tz`).
- Request and response bodies are **never stored** — pass-through only. The
  privacy page states this prominently (selling point).
- Config endpoints are rate-limited by IP to prevent key-creation spam and
  brute-forcing of `gw_` keys.

## 4. Fallback + rate-limit logic

Per gateway request:

1. Resolve gateway key → load and decrypt config (unknown key → `401`).
2. Rate-limit check: `@upstash/ratelimit` sliding window, per-key RPM from
   config. Over limit → `429` with `Retry-After` header.
3. Resolve target: explicit `provider/model`, or walk the fallback chain when
   model is `"auto"`.
4. Call provider with a **25-second first-token timeout**. On `429`, `5xx`,
   timeout, or connection error → advance to the next chain entry (each chain
   entry carries its own model name). On `400`/`401` from the provider (caller's
   fault: bad request or bad provider key) → fail fast, no fallback.
5. Stream the winning response through untouched. Fire-and-forget usage
   increments (must not add latency to the response path).

Limits: maximum 3 fallback hops. All hops exhausted → `502` with a JSON body
listing each provider attempted and what it returned.

## 5. Setup flow (no signup)

`/start` — single page, three steps in one column:

1. Paste any subset of the 8 provider keys. Each key is validated live with a
   cheap test call; inline ✓/✗ feedback.
2. Drag to order the fallback chain; pick an RPM limit (default 60).
3. "Create gateway" → `gw_live_...` revealed once with a copy button and
   ready-to-paste snippets (JavaScript, Python, curl).

`/manage` — paste a `gw_` key to: view masked config, usage stats (today / 7
days), edit fallback chain, RPM, and provider keys, rotate the gateway key, or
delete the config.

## 6. Landing page ("piece of art")

Dark terminal-luxe aesthetic:

- Canvas near-black `#0a0a0b`; single electric accent signal-green `#00ff88`;
  Inter for UI text, JetBrains Mono for code/details.
- **Hero:** headline (working copy: "One endpoint. Eight providers. Zero
  downtime." — final copy at build time) above the centerpiece: an **animated
  SVG route diagram** — request pulses flow from a `gw_` node through the
  gateway into 8 provider nodes; one provider flickers red and dies; the pulse
  visibly reroutes to the next node; traffic never stops. Looping, subtle,
  implemented in pure SVG + CSS.
- **Live terminal block:** typewriter-animated curl request → streamed response
  with the `x-gateway-provider` header highlighted.
- **Sections:** features grid (fallback, rate limiting, BYOK privacy, streaming,
  8 providers, no signup) · provider logo row · 3-step "how it works" · FAQ ·
  footer.
- **Performance budget:** no heavy JS animation libraries — CSS and SVG only.
  Lighthouse 95+.

## 7. Error handling

- Unified OpenAI-style JSON error shape for every failure:
  `{ "error": { "message", "type", "code" } }`.
  - Unknown/invalid `gw_` key → `401`.
  - Rate limit exceeded → `429` + `Retry-After`.
  - All fallback hops exhausted → `502` with per-provider attempt details.
  - Malformed request body → `400`.
- When no fallback applies, provider errors pass through with their original
  status code so OpenAI SDKs behave predictably.

## 8. Testing

- **Unit:** crypto round-trip (encrypt/decrypt), gateway-key hashing,
  fallback-chain resolution, Anthropic and Gemini format translators (highest-
  risk code).
- **Integration:** mocked provider servers verifying that fallback triggers on
  429/500/timeout but not on 400; streaming pass-through correctness; rate
  limiter behavior at and over the limit.
- **Smoke (post-deploy):** one real request per configured provider against the
  live URL using throwaway keys.

## Out of scope for v1 (explicit)

- Accounts, email auth, dashboards with login.
- Reselling tokens / credits / Stripe billing.
- Endpoints other than chat completions (no embeddings, images, audio).
- Caching, semantic routing, cost-based routing, prompt logging/analytics.
- Self-hosted/OSS distribution.
