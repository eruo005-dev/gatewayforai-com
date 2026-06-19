# GatewayforAI

**One endpoint. Eight providers. Failover built in. — a free, open-source, self-hostable LLM gateway.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/eruo005-dev/gatewayforai-com/actions/workflows/ci.yml/badge.svg)](https://github.com/eruo005-dev/gatewayforai-com/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-208%20passing-brightgreen.svg)](#development)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Made with Next.js](https://img.shields.io/badge/made%20with-Next.js-black.svg)](https://nextjs.org)

> 🇹🇷 Türkçe README: [yapaygecit](https://github.com/eruo005-dev/yapaygecit)

GatewayforAI is a single OpenAI- **and** Anthropic-compatible endpoint that sits in
front of eight LLM providers. Point your existing SDK at it, send `"auto"` as the
model, and the gateway walks a fallback chain on rate limits, 5xx errors, and
timeouts — so one provider having a bad day doesn't take your app down with it. You
bring your own provider keys (BYOK), so there's nothing to pay us and nothing for us
to meter.

## Why

- **BYOK — you never pay us.** Your provider keys are encrypted at rest (AES-256-GCM);
  there's no billing relationship, no markup, no usage metering on our side.
- **Resilience for free.** Automatic fallback, first-token streaming failover, a
  circuit breaker for degraded providers, and per-key RPM/TPM rate limits.
- **Drop-in for both ecosystems.** OpenAI-compatible (`/v1/chat/completions`) **and**
  Anthropic-native (`/v1/messages`) — point either SDK at the gateway, no rewrites.
- **Self-host in one click, or use the free hosted instance.** Deploy your own to
  Vercel in a minute, or just point at the public instance below.
- **MIT licensed.** Fork it, embed it, ship it.

## Quickstart (hosted)

The hosted instance is free and public. Swap your OpenAI SDK's `baseURL` and use a
gateway key (`gw_live_…`) in place of your OpenAI key:

```js
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: "gw_live_...",                                                  // your gateway key
  baseURL: "https://gatewayforai.com/v1",
});

const res = await openai.chat.completions.create({
  model: "auto",                          // or "openai/gpt-4o", "anthropic/claude-sonnet-4-6", …
  messages: [{ role: "user", content: "Hello" }],
});
```

Create a config (and get your `gw_live_…` key) from the [`/start`](https://gatewayforai.com/start)
page, or via curl:

```bash
curl -X POST https://gatewayforai.com/api/config \
  -H "content-type: application/json" \
  -d '{"providers":{"openai":"sk-...","anthropic":"sk-ant-..."}}'
# → returns your gw_live_... key ONCE. Store it; only its SHA-256 hash is kept.
```

## Deploy your own (1-click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Feruo005-dev%2Fgatewayforai-com&env=MASTER_KEY,UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN&envDescription=MASTER_KEY%20is%2064%20hex%20chars%20(openssl%20rand%20-hex%2032)%3B%20Upstash%20creds%20from%20console.upstash.com&project-name=gatewayforai&repository-name=gatewayforai)

### Manual self-host

```bash
git clone https://github.com/eruo005-dev/gatewayforai-com.git
cd gatewayforai-com
npm install
```

Create `.env.local`:

```bash
# 64 hex chars — generate with: openssl rand -hex 32
MASTER_KEY=...
# From the REST API section of your Redis database at console.upstash.com (free tier).
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Then:

```bash
npm run dev          # http://localhost:3000
```

Deploy to Vercel with the button above or `vercel --prod`. Both the
`UPSTASH_REDIS_REST_*` names and the `KV_REST_API_*` names (injected by the Vercel
marketplace Upstash integration) are supported — set whichever pair you have.

## Features

- **8 providers** — OpenAI, Anthropic, Google Gemini, Groq, Mistral, Together,
  DeepSeek, OpenRouter.
- **Dual API dialects** — OpenAI `/v1/chat/completions` and Anthropic-native
  `/v1/messages`, both routing across all providers.
- **Fallback + first-token failover** — `"auto"` walks the chain on 429/5xx/timeout,
  and fails over even when a provider streams an empty body.
- **Circuit breaker** — degraded providers are skipped until they recover.
- **RPM/TPM rate limits** — per-key request- and token-per-minute buckets.
- **Sub-keys** — issue revocable `gw_sub_…` team keys with their own limits.
- **Opt-in response cache** — set a TTL header to cache identical non-streaming calls.
- **Cost estimates** — `x-gateway-cost-estimate-usd` on priced, non-streaming responses.
- **Cost/latency routing** — re-order the `"auto"` chain by `cheapest` or `fastest`.
- **Embeddings** — proxy `/v1/embeddings` to any non-Anthropic provider.
- **Tool calling everywhere** — OpenAI-style tools translated across all providers,
  including Anthropic and streaming.
- **Zero prompt logging** — prompts and responses are never stored.

See the [API reference](#api-reference) for every endpoint and header.

## API reference

- `POST /v1/chat/completions` — OpenAI-compatible, `Authorization: Bearer gw_live_...`,
  model `"provider/model"` or `"auto"` (walks the fallback chain on 429/5xx/timeout).
  Response headers: `x-gateway-provider`, `x-gateway-fallback-count`, `x-gateway-latency-ms`.
  - **Cache (opt-in):** set request header `x-gateway-cache: <ttl_seconds>` (1–86400) on
    non-streaming requests. Cache hit returns `x-gateway-cache: hit`; miss returns
    `x-gateway-cache: miss` and stores the response for subsequent identical calls.
  - **Cost estimate:** `x-gateway-cost-estimate-usd` header is set on cache-miss (non-streaming)
    responses when the model is in the pricing table. Streaming responses do not carry usage data
    and therefore do not include a cost estimate.
  - **Cost/latency routing:** set request header `x-gateway-route: cheapest` or
    `x-gateway-route: fastest` when `model` is `"auto"` to re-order the fallback chain before
    the first attempt. `cheapest` sorts by total per-token cost (unknown-price models go last);
    `fastest` sorts by static provider latency rank (groq → gemini → openai → …). The resolved
    strategy is echoed back in the `x-gateway-route` response header.
  - **Anthropic prompt-caching:** `cache_control` passes through intact on user and system message
    content blocks when routing to Anthropic.
  - **Tool/function calling:** OpenAI-style `tools`, `tool_choice`, assistant `tool_calls`, and
    `role:"tool"` results work across **all** providers including Anthropic — the gateway
    translates the full tool-calling protocol in both directions, including streaming
    (`tool_calls` deltas in `chat.completion.chunk` frames).
  - **First-token streaming failover:** for `"auto"`/multi-provider chains, fallback triggers
    before the first token — a provider that accepts the request but never produces output
    (200 + `text/event-stream` then a dead body) fails over automatically. Once output starts,
    the stream is committed and passes through; a connection that dies mid-stream is not retried.
- `POST /v1/messages` — **Anthropic-native endpoint.** Point the Anthropic SDK at the gateway
  and route across all 8 providers in the Anthropic Messages format. Auth via `x-api-key`
  (checked first) **or** `Authorization: Bearer` — both take your `gw_live_…` key. Model
  addressing is the gateway's own: `"provider/model"` (e.g. `"openai/gpt-4o"`) or `"auto"`.
  `tools`, `tool_choice`, and streaming (`stream: true`, translated back to Anthropic SSE
  events) are supported. Same `x-gateway-*` response headers and `x-gateway-route` request
  header as the chat route. All errors use the Anthropic error shape
  (`{"type":"error","error":{…}}`). **No response cache on this route yet** — the
  `x-gateway-cache` header is not wired here in v1.

  ```js
  import Anthropic from "@anthropic-ai/sdk";
  const anthropic = new Anthropic({
    apiKey: "gw_live_...",            // your gateway key (sent as x-api-key)
    baseURL: "https://gatewayforai.com",
  });
  await anthropic.messages.create({
    model: "auto",                    // or "anthropic/claude-sonnet-4-6", "openai/gpt-4o", …
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }],
  });
  ```
- `GET /v1/models` — union of models from configured providers.
- `POST /v1/embeddings` — proxy embeddings to any non-Anthropic provider. Requires explicit
  `provider/model` (e.g. `openai/text-embedding-3-small`); no `"auto"`. Response passes through
  with `x-gateway-provider` header.
- `POST/GET/PATCH/DELETE /api/config`, `POST /api/config/rotate` — config management
  (create returns the gateway key once; only its SHA-256 hash is stored).
- `POST /api/validate-key` — live provider key check.
- `GET /api/health` — public health probe; returns `{"status":"ok"}` with 200 when the service is up. Use for uptime monitoring.
- `POST/GET/DELETE /api/config/subkeys` — team sub-key management (Bearer parent key only;
  `gw_sub_` keys return 403 on management routes). Sub-keys (`gw_sub_…`) route through the
  parent's providers and fallback chain but carry their own optional rpm/tpm overrides and their
  own rate-limit buckets — usage counters, circuit-breaker state, and the response cache are
  shared at the parent level, so sub-key traffic counts against the same provider health and cache
  as direct use of the parent key. Sub-keys can be individually revoked (DELETE with the 8-char
  `id` prefix) without affecting the parent or other sub-keys. Maximum 20 sub-keys per config.

## Architecture

Next.js 15 App Router route handlers under `src/app` (`/v1/*` for the gateway dialects,
`/api/*` for config and sub-key management) delegate to the core library in `src/lib`:
`crypto` (AES-256-GCM key encryption), `config-store` (Redis-backed configs and sub-keys),
`gateway` (the fallback engine), `providers` (per-provider adapters and the model registry),
plus `routing`, `cache`, `breaker`, `ratelimit`, `usage`, and the `anthropic` translator.
The only datastore is **Upstash Redis** — provider keys are encrypted with `MASTER_KEY`, the
gateway key is stored only as a SHA-256 hash, and prompts/responses are never persisted.
`src/lib` is fully unit-tested (187 tests total) and the route handlers have integration tests
on top.

## Development

```bash
npm install
npm test          # vitest — 187 tests
npm run build     # next build (typecheck + production build)
```

The project is built test-first (TDD): new behavior comes with tests, and the suite stays
green on every change.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions,
and the PR process.

## Security

Found a vulnerability? Please see [SECURITY.md](SECURITY.md) for how to report it privately.

## License

[MIT](LICENSE) © 2026 GatewayforAI contributors. The hosted instance stays free and public.

## Providers

OpenAI · Anthropic · Google Gemini · Groq · Mistral · Together · DeepSeek · OpenRouter
