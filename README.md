# GatewayforAI.com

OpenAI-compatible LLM gateway with automatic fallback routing and rate limiting.
BYOK — bring your own provider keys. No signup; the `gw_live_` key is the account.

## Stack

Next.js 15 · Upstash Redis · Vercel. Provider keys encrypted with AES-256-GCM
(`MASTER_KEY` env var). Prompts/responses are never stored.

## Env vars

See `.env.example`: `MASTER_KEY` (64 hex chars), `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_*` equivalents injected by the
Vercel marketplace Upstash integration).

## Develop

```bash
npm install && npm run dev   # tests: npm test
```

## API

- `POST /v1/chat/completions` — OpenAI-compatible, `Authorization: Bearer gw_live_...`,
  model `"provider/model"` or `"auto"` (walks the fallback chain on 429/5xx/timeout).
  Response headers: `x-gateway-provider`, `x-gateway-fallback-count`, `x-gateway-latency-ms`.
  - **Cache (opt-in):** set request header `x-gateway-cache: <ttl_seconds>` (1–86400) on
    non-streaming requests. Cache hit returns `x-gateway-cache: hit`; miss returns
    `x-gateway-cache: miss` and stores the response for subsequent identical calls.
  - **Cost estimate:** `x-gateway-cost-estimate-usd` header is set on cache-miss (non-streaming)
    responses when the model is in the pricing table. Streaming responses do not carry usage data
    and therefore do not include a cost estimate.
- `GET /v1/models` — union of models from configured providers.
- `POST /v1/embeddings` — proxy embeddings to any non-Anthropic provider. Requires explicit
  `provider/model` (e.g. `openai/text-embedding-3-small`); no `"auto"`. Response passes through
  with `x-gateway-provider` header.
- `POST/GET/PATCH/DELETE /api/config`, `POST /api/config/rotate` — config management
  (create returns the gateway key once; only its SHA-256 hash is stored).
- `POST /api/validate-key` — live provider key check.

## Providers

OpenAI · Anthropic · Google Gemini · Groq · Mistral · Together · DeepSeek · OpenRouter
