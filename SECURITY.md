# Security Policy

## Supported versions

GatewayforAI is shipped as a rolling release. Only the latest `main` (and the hosted
instance deployed from it) is supported. There are no long-term support branches; please
update to the current `main` before reporting issues.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, **open a private security advisory on GitHub** for this repository
(Security → Advisories → "Report a vulnerability"). Include:

- a description of the issue and its impact,
- steps to reproduce or a proof of concept,
- the affected endpoint(s) or module(s), and
- any suggested remediation if you have one.

You'll get an acknowledgement on a best-effort basis. This is a volunteer-maintained
project, so we can't promise a fixed response SLA, but we take security reports seriously
and will work with you on a fix and coordinated disclosure.

## Scope

**In scope:** the gateway code in this repository — the route handlers under `src/app`,
the core library in `src/lib` (crypto, config store, gateway/fallback engine, provider
adapters, rate limiting, cache, sub-keys), and the way the gateway stores and handles
secrets.

**Out of scope:** the security of users' own upstream provider API keys. Those keys are
the user's responsibility — rotate and scope them appropriately. Issues in third-party
providers, Upstash, or Vercel themselves should be reported to those vendors. Reports that
require the operator's `MASTER_KEY` or Redis credentials to already be compromised are also
out of scope (that is the operator's trust boundary).

## Our security posture

- **Provider keys are encrypted at rest** with AES-256-GCM using the operator's
  `MASTER_KEY`; they are decrypted only in memory at request time.
- **Gateway keys are never stored in plaintext** — only a SHA-256 hash of each
  `gw_live_…` / `gw_sub_…` key is persisted, so a database leak does not expose usable
  keys.
- **No prompt logging.** Prompts and responses are never persisted or logged.
- **Redis is the only datastore** — there is no separate database to harden or leak.

If you find a way to violate any of these invariants, that is exactly the kind of report
we want.

## Self-hosting note: client-IP trust

Per-IP abuse controls rely on `clientIp()` (`src/lib/client-ip.ts`), which trusts
`x-real-ip` and then the **rightmost** entries of `x-forwarded-for`. This is only
spoof-safe behind a reverse proxy that **strips/overwrites any client-supplied
`x-real-ip`** and appends the true client to `x-forwarded-for`. Vercel does this, so
the hosted instance is safe by default.

If you self-host behind a different proxy, you **must**:

- set `TRUSTED_PROXY_HOPS` to the number of trusted proxy hops in front of the app, and
- ensure your proxy overwrites (not merely forwards) the `x-real-ip` header and the
  client-controlled left side of `x-forwarded-for`.

Otherwise a caller can spoof these headers to dodge every per-IP rate limit and the
per-IP config-creation cap.
