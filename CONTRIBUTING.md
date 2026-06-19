# Contributing to GatewayforAI

Thanks for your interest in improving GatewayforAI. This is a volunteer-maintained,
MIT-licensed project, and contributions of all sizes are welcome — bug fixes, new
provider adapters, docs, and tests especially.

## Getting set up

```bash
git clone https://github.com/eruo005-dev/gatewayforai-com.git
cd gatewayforai-com
npm install
```

Create a `.env.local` for local runs (not needed for the test suite, which sets its own
`MASTER_KEY`):

```bash
# 64 hex chars — generate with: openssl rand -hex 32
MASTER_KEY=...
# From the REST API section of your Redis database at console.upstash.com (free tier).
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Then run the dev server:

```bash
npm run dev          # http://localhost:3000
```

## Running tests

```bash
npm test             # vitest — runs the full suite (371 tests as of v1.0.0)
npm run build        # next build — typecheck + production build
```

Both must be green before you open a PR. The test suite uses an in-memory fake Redis
(`tests/fake-redis.ts`), so you don't need a live Upstash instance to run it.

## Conventions

- **Test-first (TDD).** Write the failing test, then the implementation. Every behavior
  change ships with tests. The core library in `src/lib` is fully unit-tested; route
  handlers under `src/app` have integration tests.
- **Small, focused files.** Each module in `src/lib` does one thing. Prefer adding a new
  file over growing an existing one past its purpose.
- **Conventional-ish commit messages.** Use a short, imperative subject with a type
  prefix where it helps, e.g. `fix: fail over on empty SSE body`,
  `feat: add Cohere provider adapter`, `docs: clarify KV_* env fallback`.
- **No prompt logging, ever.** Prompts and responses must never be persisted or logged.
  Keep this invariant in mind for any change touching the gateway path.
- **TypeScript stays clean.** `npm run build` runs the typecheck — no `any` escapes that
  the suite would otherwise catch.

## Proposing changes

- **Small fixes:** open a PR directly. Include or update tests, and make sure
  `npm test` and `npm run build` pass.
- **Larger changes** (new providers, new endpoints, behavior changes): please open an
  issue first to discuss the approach before investing in the implementation. Use the
  [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).
- **Bugs:** file a [bug report](.github/ISSUE_TEMPLATE/bug_report.md) with steps to
  reproduce.

When you open a PR, the [pull request template](.github/PULL_REQUEST_TEMPLATE.md)
checklist covers what we look for: tests added/updated, suite green, and docs updated if
behavior or the API changed.

## Code of conduct

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md). Be kind and constructive.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
