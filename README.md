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
- `GET /v1/models` — union of models from configured providers.
- `POST/GET/PATCH/DELETE /api/config`, `POST /api/config/rotate` — config management
  (create returns the gateway key once; only its SHA-256 hash is stored).
- `POST /api/validate-key` — live provider key check.

## Providers

OpenAI · Anthropic · Google Gemini · Groq · Mistral · Together · DeepSeek · OpenRouter
