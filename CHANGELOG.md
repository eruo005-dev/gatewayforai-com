# Changelog

All notable changes to GatewayforAI are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-06-19

### Added

- **8 provider adapters** — OpenAI, Anthropic, Google Gemini, Groq, Mistral, Together,
  DeepSeek, and OpenRouter, each with model registry entries and per-provider error handling.
- **Dual API dialects** — full OpenAI-compatible `/v1/chat/completions` endpoint and an
  Anthropic-native `/v1/messages` endpoint; both route across all 8 providers.
- **Fallback engine** — `"auto"` model walks a configurable provider chain on 429, 5xx,
  and timeout; chain order is configurable per config.
- **First-token streaming failover** — detects a provider that accepts the request but
  produces no output (200 + dead SSE body) and fails over before the first token arrives.
- **Circuit breaker** — automatically skips degraded providers and re-enables them after
  a cooldown period.
- **RPM/TPM rate limiting** — per-key request- and token-per-minute buckets via Upstash
  Redis sliding windows.
- **Sub-keys** — issue up to 20 revocable `gw_sub_…` team keys per config, each with
  independent rate-limit overrides; usage and circuit-breaker state are shared at the
  parent level.
- **Opt-in response cache** — `x-gateway-cache: <ttl_seconds>` header on non-streaming
  `/v1/chat/completions` requests; cache hits return `x-gateway-cache: hit`.
- **Cost estimates** — `x-gateway-cost-estimate-usd` response header on cache-miss,
  non-streaming responses when the model is in the pricing table.
- **Cost/latency routing** — `x-gateway-route: cheapest` or `x-gateway-route: fastest`
  request header re-orders the `"auto"` chain before the first attempt.
- **Embeddings proxy** — `/v1/embeddings` forwarded to any non-Anthropic provider.
- **Tool calling everywhere** — full OpenAI tool-calling protocol (tools, tool_choice,
  tool_calls, role:"tool") translated across all providers including Anthropic, in both
  streaming and non-streaming modes.
- **Anthropic prompt-caching passthrough** — `cache_control` on message content blocks
  passes through intact when routing to Anthropic.
- **BYOK model** — provider keys are AES-256-GCM encrypted at rest with an
  operator-supplied `MASTER_KEY`; gateway keys are stored only as SHA-256 hashes.
- **Zero prompt logging** — prompts and completions are never persisted or logged at any
  point in the request path.
- **Config API** — `POST/GET/PATCH/DELETE /api/config` and `POST /api/config/rotate`
  for full lifecycle management of gateway configs.
- **Sub-key API** — `POST/GET/DELETE /api/config/subkeys` for team key management.
- **Health endpoint** — `GET /api/health` returns `{"ok":true,"redis":true}` (200) or
  `{"ok":false,"redis":false}` (503) for uptime monitoring.
- **Provider key validation** — `POST /api/validate-key` for live key checks.
- **1-click Vercel deploy** — repo ships with a deploy button and CI workflow.
- **371-test suite** (vitest) covering the full `src/lib` core and route-handler
  integration scenarios, using an in-memory fake Redis — no live infrastructure needed.
- **Multiple security-hardening rounds** — red-team exercises identified and closed
  issues in IP-trust, header injection, sub-key privilege escalation, cache-key
  collisions, and circuit-breaker state; all fixes are accompanied by regression tests.

[Unreleased]: https://github.com/eruo005-dev/gatewayforai-com/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/eruo005-dev/gatewayforai-com/releases/tag/v1.0.0
