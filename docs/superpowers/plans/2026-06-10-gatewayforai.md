# GatewayforAI.com Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy GatewayforAI.com — a BYOK LLM gateway exposing one OpenAI-compatible endpoint that proxies to 8 providers with per-key rate limiting and automatic fallback routing, plus a dark terminal-luxe landing page.

**Architecture:** Single Next.js 15 (App Router, TypeScript) repo on Vercel. Upstash Redis is the only datastore (encrypted configs, rate-limit counters, usage stats). Provider keys encrypted with AES-256-GCM under a `MASTER_KEY` env var. No signup — the `gw_live_...` key is the account.

**Tech Stack:** Next.js 15, React 19, TypeScript, `@upstash/redis`, `@upstash/ratelimit`, Vitest. No UI library — hand-written CSS.

**Spec:** `docs/superpowers/specs/2026-06-10-gatewayforai-design.md`

**Approved spec deviations (note these, they are deliberate):**
1. Gemini is called via Google's official OpenAI-compatible endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`) instead of a custom translator — less code, identical behavior. Only Anthropic gets a custom translator.
2. Fallback-chain ordering on `/start` uses up/down arrow buttons instead of drag-and-drop (more reliable, no JS lib).
3. Anthropic translation covers text chat only — OpenAI `tools`/function-calling is not translated in v1 (passes through to OpenAI-style providers untouched).

**Working directory for ALL tasks:** `C:\Users\eruo0\Desktop\general workflow\products\gatewayforai.com` (already a git repo with the spec committed).

---

## File Structure

```
package.json, tsconfig.json, next.config.mjs, vitest.config.ts, .gitignore, .env.example
src/
  lib/
    types.ts            — shared types (ProviderId, ChainEntry, GatewayConfig)
    crypto.ts           — AES-256-GCM encrypt/decrypt, sha256, gw-key generation, masking
    config-store.ts     — Redis CRUD for configs (encrypts/decrypts provider keys)
    usage.ts            — daily usage counters (30-day TTL)
    ratelimit.ts        — per-key RPM limiter + per-IP limiter for config endpoints
    errors.ts           — OpenAI-style JSON error responses
    validate.ts         — input validation for config create/patch
    gateway.ts          — resolveChain + routeRequest (the fallback engine)
    providers/
      registry.ts       — 8 provider definitions (baseURL, auth, style, defaultModel)
      anthropic.ts      — OpenAI<->Anthropic translation (body, response, SSE stream)
      call.ts           — callProvider: one upstream HTTP call with timeout
  app/
    layout.tsx, globals.css
    page.tsx            — landing page (the art)
    start/page.tsx      — no-signup setup flow
    manage/page.tsx     — view/edit/rotate/delete via gw key
    privacy/page.tsx
    api/config/route.ts         — POST/GET/PATCH/DELETE
    api/config/rotate/route.ts  — POST: rotate gateway key
    api/validate-key/route.ts   — POST: live provider-key check
    v1/chat/completions/route.ts — the gateway
    v1/models/route.ts
  components/
    RouteDiagram.tsx    — animated SVG hero (request pulses, dying provider, reroute)
    Terminal.tsx        — typewriter terminal block
tests/
  setup.ts, fake-redis.ts
  crypto.test.ts, config-store.test.ts, usage.test.ts, validate.test.ts,
  anthropic.test.ts, call.test.ts, gateway.test.ts
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/app/layout.tsx`, `src/app/globals.css` (minimal stub — full styles in Task 12), `src/app/page.tsx` (stub)

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "gatewayforai",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "@upstash/ratelimit": "^2.0.5",
    "@upstash/redis": "^1.34.3",
    "next": "^15.3.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `next.config.mjs`, `.gitignore`, `.env.example`, `vitest.config.ts`**

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

`.gitignore`:
```
node_modules/
.next/
.env*.local
.env
.vercel
*.tsbuildinfo
next-env.d.ts
```

`.env.example`:
```
# 64 hex chars — generate with: openssl rand -hex 32
MASTER_KEY=
# From console.upstash.com — REST API section of your Redis database
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", setupFiles: ["tests/setup.ts"] },
});
```

- [ ] **Step 4: Write stub app shell**

`src/app/globals.css` (stub — replaced in Task 12):
```css
:root { --bg: #0a0a0b; --text: #e8e8ea; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; }
```

`src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "GatewayforAI — One endpoint. Eight providers. Zero downtime.",
  description:
    "OpenAI-compatible LLM gateway with automatic fallback routing and rate limiting. Bring your own keys. No signup.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` (stub — replaced in Task 12):
```tsx
export default function Home() {
  return <main style={{ padding: 40 }}>GatewayforAI — coming together.</main>;
}
```

- [ ] **Step 5: Install and verify build**

Run: `npm install` then `npm run build`
Expected: build completes with no type errors (warnings OK).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js app with vitest"
```

---

### Task 2: Types + crypto

**Files:**
- Create: `src/lib/types.ts`, `src/lib/crypto.ts`, `tests/setup.ts`, `tests/crypto.test.ts`

- [ ] **Step 1: Write `src/lib/types.ts` and `tests/setup.ts`**

`src/lib/types.ts`:
```ts
export type ProviderId =
  | "openai" | "anthropic" | "gemini" | "groq"
  | "mistral" | "together" | "deepseek" | "openrouter";

export interface ChainEntry {
  provider: ProviderId;
  model: string;
}

/** In-memory form — provider key values are PLAINTEXT (decrypted). */
export interface GatewayConfig {
  providers: Partial<Record<ProviderId, string>>;
  fallbackChain: ChainEntry[];
  rateLimit: { rpm: number };
  createdAt: string;
}

export interface ConfigPatch {
  /** string = set/replace key (plaintext in), null = remove provider */
  providers?: Partial<Record<ProviderId, string | null>>;
  fallbackChain?: ChainEntry[];
  rateLimit?: { rpm: number };
}
```

`tests/setup.ts`:
```ts
// 64 hex chars, valid AES-256 key for tests
process.env.MASTER_KEY = "ab".repeat(32);
```

- [ ] **Step 2: Write the failing tests** — `tests/crypto.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { encrypt, decrypt, sha256, generateGatewayKey, maskKey } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips a secret", () => {
    const ct = encrypt("sk-test-12345");
    expect(ct).not.toContain("sk-test");
    expect(decrypt(ct)).toBe("sk-test-12345");
  });

  it("uses a unique IV per encryption (same input → different ciphertext)", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  it("rejects tampered ciphertext", () => {
    const ct = encrypt("secret");
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decrypt(buf.toString("base64"))).toThrow();
  });

  it("sha256 is hex and deterministic", () => {
    expect(sha256("gw_live_abc")).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256("x")).toBe(sha256("x"));
  });

  it("generates gw_live_ keys with ≥24 bytes of entropy", () => {
    const k = generateGatewayKey();
    expect(k).toMatch(/^gw_live_[A-Za-z0-9_-]{32,}$/);
    expect(generateGatewayKey()).not.toBe(k);
  });

  it("masks keys to first-5 + last-4", () => {
    expect(maskKey("sk-proj-abcdefgh1234x4Tz")).toBe("sk-pr…x4Tz");
    expect(maskKey("short")).toBe("••••");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/crypto.test.ts`
Expected: FAIL — cannot resolve `@/lib/crypto`.

- [ ] **Step 4: Write `src/lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALG = "aes-256-gcm";

function masterKey(): Buffer {
  const hex = process.env.MASTER_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("MASTER_KEY env var must be 64 hex characters");
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM. Output layout: base64( IV(12) | authTag(16) | ciphertext ). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}

export function decrypt(blob: string): string {
  const buf = Buffer.from(blob, "base64");
  const decipher = createDecipheriv(ALG, masterKey(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function generateGatewayKey(): string {
  return "gw_live_" + randomBytes(24).toString("base64url");
}

export function maskKey(k: string): string {
  return k.length <= 10 ? "••••" : `${k.slice(0, 5)}…${k.slice(-4)}`;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/crypto.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/types.ts src/lib/crypto.ts tests/setup.ts tests/crypto.test.ts
git commit -m "feat: types + AES-256-GCM crypto for provider keys"
```

---

### Task 3: Config store (Redis CRUD)

**Files:**
- Create: `src/lib/config-store.ts`, `tests/fake-redis.ts`, `tests/config-store.test.ts`

Storage layout: one JSON string per config at `config:{sha256(gwKey)}`. Provider key values inside it are AES-GCM ciphertext. The raw gateway key is never stored.

- [ ] **Step 1: Write `tests/fake-redis.ts`** (shared by Tasks 3–4)

```ts
/** Minimal in-memory stand-in for @upstash/redis used by unit tests. */
export class FakeRedis {
  store = new Map<string, unknown>();
  hashes = new Map<string, Map<string, number>>();

  async get(k: string) { return this.store.get(k) ?? null; }
  async set(k: string, v: unknown) { this.store.set(k, v); return "OK"; }
  async del(k: string) { return this.store.delete(k) ? 1 : 0; }

  async hincrby(k: string, field: string, by: number) {
    const h = this.hashes.get(k) ?? new Map();
    h.set(field, (h.get(field) ?? 0) + by);
    this.hashes.set(k, h);
    return h.get(field)!;
  }
  async hgetall(k: string) {
    const h = this.hashes.get(k);
    return h && h.size ? Object.fromEntries(h) : null;
  }
  async expire(_k: string, _s: number) { return 1; }
}
```

- [ ] **Step 2: Write the failing tests** — `tests/config-store.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { FakeRedis } from "./fake-redis";
import {
  setRedisForTests, createConfig, getConfig, updateConfig, deleteConfig, rotateKey,
} from "@/lib/config-store";

const INPUT = {
  providers: { openai: "sk-openai-123", groq: "gsk-groq-456" },
  fallbackChain: [
    { provider: "openai" as const, model: "gpt-4o" },
    { provider: "groq" as const, model: "llama-3.3-70b-versatile" },
  ],
  rateLimit: { rpm: 60 },
};

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTests(redis as never);
});

describe("config-store", () => {
  it("creates and reads back a config with decrypted keys", async () => {
    await createConfig("gw_live_test1", INPUT);
    const cfg = await getConfig("gw_live_test1");
    expect(cfg?.providers.openai).toBe("sk-openai-123");
    expect(cfg?.fallbackChain).toHaveLength(2);
    expect(cfg?.rateLimit.rpm).toBe(60);
    expect(cfg?.createdAt).toBeTruthy();
  });

  it("never stores plaintext provider keys or the raw gateway key", async () => {
    await createConfig("gw_live_test1", INPUT);
    const dump = JSON.stringify([...redis.store.entries()]);
    expect(dump).not.toContain("sk-openai-123");
    expect(dump).not.toContain("gw_live_test1");
  });

  it("returns null for unknown keys", async () => {
    expect(await getConfig("gw_live_nope")).toBeNull();
  });

  it("patches: replaces a key, removes via null, updates chain + rpm", async () => {
    await createConfig("gw_live_test1", INPUT);
    const ok = await updateConfig("gw_live_test1", {
      providers: { openai: "sk-new", groq: null },
      fallbackChain: [{ provider: "openai", model: "gpt-4o-mini" }],
      rateLimit: { rpm: 120 },
    });
    expect(ok).toBe(true);
    const cfg = await getConfig("gw_live_test1");
    expect(cfg?.providers.openai).toBe("sk-new");
    expect(cfg?.providers.groq).toBeUndefined();
    expect(cfg?.fallbackChain[0].model).toBe("gpt-4o-mini");
    expect(cfg?.rateLimit.rpm).toBe(120);
  });

  it("updateConfig returns false for unknown key", async () => {
    expect(await updateConfig("gw_live_nope", { rateLimit: { rpm: 5 } })).toBe(false);
  });

  it("deletes a config", async () => {
    await createConfig("gw_live_test1", INPUT);
    expect(await deleteConfig("gw_live_test1")).toBe(true);
    expect(await getConfig("gw_live_test1")).toBeNull();
  });

  it("rotates: old key dead, new key works, data intact", async () => {
    await createConfig("gw_live_test1", INPUT);
    const newKey = await rotateKey("gw_live_test1");
    expect(newKey).toMatch(/^gw_live_/);
    expect(await getConfig("gw_live_test1")).toBeNull();
    expect((await getConfig(newKey!))?.providers.openai).toBe("sk-openai-123");
  });

  it("rotateKey returns null for unknown key", async () => {
    expect(await rotateKey("gw_live_nope")).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/config-store.test.ts`
Expected: FAIL — cannot resolve `@/lib/config-store`.

- [ ] **Step 4: Write `src/lib/config-store.ts`**

```ts
import { Redis } from "@upstash/redis";
import { decrypt, encrypt, generateGatewayKey, sha256 } from "./crypto";
import type { ChainEntry, ConfigPatch, GatewayConfig, ProviderId } from "./types";

let _redis: Redis | null = null;

export function redis(): Redis {
  return (_redis ??= Redis.fromEnv());
}

export function setRedisForTests(r: Redis) {
  _redis = r;
}

const configKey = (hash: string) => `config:${hash}`;

interface StoredConfig {
  providers: Partial<Record<ProviderId, string>>; // ciphertext values
  fallbackChain: ChainEntry[];
  rateLimit: { rpm: number };
  createdAt: string;
}

async function loadStored(gatewayKey: string): Promise<StoredConfig | null> {
  const raw = await redis().get<string | StoredConfig>(configKey(sha256(gatewayKey)));
  if (!raw) return null;
  // Upstash auto-deserializes JSON values; handle both shapes.
  return typeof raw === "string" ? (JSON.parse(raw) as StoredConfig) : raw;
}

async function saveStored(gatewayKey: string, stored: StoredConfig): Promise<void> {
  await redis().set(configKey(sha256(gatewayKey)), JSON.stringify(stored));
}

export async function createConfig(
  gatewayKey: string,
  input: Omit<GatewayConfig, "createdAt">,
): Promise<void> {
  await saveStored(gatewayKey, {
    providers: Object.fromEntries(
      Object.entries(input.providers).map(([p, k]) => [p, encrypt(k as string)]),
    ),
    fallbackChain: input.fallbackChain,
    rateLimit: input.rateLimit,
    createdAt: new Date().toISOString(),
  });
}

export async function getConfig(gatewayKey: string): Promise<GatewayConfig | null> {
  const stored = await loadStored(gatewayKey);
  if (!stored) return null;
  return {
    ...stored,
    providers: Object.fromEntries(
      Object.entries(stored.providers).map(([p, ct]) => [p, decrypt(ct as string)]),
    ),
  };
}

export async function updateConfig(gatewayKey: string, patch: ConfigPatch): Promise<boolean> {
  const stored = await loadStored(gatewayKey);
  if (!stored) return false;
  if (patch.providers) {
    for (const [p, v] of Object.entries(patch.providers)) {
      if (v === null) delete stored.providers[p as ProviderId];
      else if (typeof v === "string") stored.providers[p as ProviderId] = encrypt(v);
    }
  }
  if (patch.fallbackChain) stored.fallbackChain = patch.fallbackChain;
  if (patch.rateLimit) stored.rateLimit = patch.rateLimit;
  await saveStored(gatewayKey, stored);
  return true;
}

export async function deleteConfig(gatewayKey: string): Promise<boolean> {
  return (await redis().del(configKey(sha256(gatewayKey)))) > 0;
}

/** Moves the stored record to a fresh gateway key. Returns the new key, or null if unknown. */
export async function rotateKey(oldKey: string): Promise<string | null> {
  const stored = await loadStored(oldKey);
  if (!stored) return null;
  const newKey = generateGatewayKey();
  await saveStored(newKey, stored);
  await redis().del(configKey(sha256(oldKey)));
  return newKey;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/config-store.test.ts`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/config-store.ts tests/fake-redis.ts tests/config-store.test.ts
git commit -m "feat: encrypted config store with rotate/patch/delete"
```

---

### Task 4: Usage tracking

**Files:**
- Create: `src/lib/usage.ts`, `tests/usage.test.ts`

Daily hash per key: `usage:{keyHash}:{YYYY-MM-DD}`, fields `requests`, `errors`, `fallbacks`, `provider:{id}`. 30-day TTL. Sequential awaits (no pipeline) — runs off the response path via `after()`, simplicity beats latency here.

- [ ] **Step 1: Write the failing tests** — `tests/usage.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { FakeRedis } from "./fake-redis";
import { setRedisForTests } from "@/lib/config-store";
import { recordUsage, getUsage } from "@/lib/usage";

let redis: FakeRedis;
beforeEach(() => {
  redis = new FakeRedis();
  setRedisForTests(redis as never);
});

describe("usage", () => {
  it("increments requests, provider, fallbacks and errors", async () => {
    await recordUsage("hash1", { provider: "openai" }, "2026-06-10");
    await recordUsage("hash1", { provider: "groq", fallbacks: 1 }, "2026-06-10");
    await recordUsage("hash1", { error: true }, "2026-06-10");
    const days = await getUsage("hash1", ["2026-06-10"]);
    expect(days[0]).toMatchObject({
      date: "2026-06-10",
      requests: 3,
      errors: 1,
      fallbacks: 1,
      "provider:openai": 1,
      "provider:groq": 1,
    });
  });

  it("returns zeroed rows for days with no traffic", async () => {
    const days = await getUsage("hash1", ["2026-06-09", "2026-06-10"]);
    expect(days).toHaveLength(2);
    expect(days[0].requests).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/usage.test.ts`
Expected: FAIL — cannot resolve `@/lib/usage`.

- [ ] **Step 3: Write `src/lib/usage.ts`**

```ts
import { redis } from "./config-store";

const DAY_SECONDS = 60 * 60 * 24;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns the last `n` dates (YYYY-MM-DD), oldest first, ending today. */
export function lastDays(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(now - i * DAY_SECONDS * 1000).toISOString().slice(0, 10));
  }
  return out;
}

export interface UsageFields {
  provider?: string;
  error?: boolean;
  fallbacks?: number;
}

export async function recordUsage(
  keyHash: string,
  fields: UsageFields,
  day: string = today(),
): Promise<void> {
  const k = `usage:${keyHash}:${day}`;
  const r = redis();
  await r.hincrby(k, "requests", 1);
  if (fields.error) await r.hincrby(k, "errors", 1);
  if (fields.fallbacks) await r.hincrby(k, "fallbacks", fields.fallbacks);
  if (fields.provider) await r.hincrby(k, `provider:${fields.provider}`, 1);
  await r.expire(k, 30 * DAY_SECONDS);
}

export type UsageDay = { date: string; requests: number; errors: number; fallbacks: number } & Record<string, number | string>;

export async function getUsage(keyHash: string, days: string[]): Promise<UsageDay[]> {
  const r = redis();
  return Promise.all(
    days.map(async (date) => {
      const h = (await r.hgetall<Record<string, number>>(`usage:${keyHash}:${date}`)) ?? {};
      return { requests: 0, errors: 0, fallbacks: 0, ...h, date };
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/usage.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/usage.ts tests/usage.test.ts
git commit -m "feat: daily usage counters with 30-day TTL"
```

---

### Task 5: Rate limiting + error helpers

**Files:**
- Create: `src/lib/ratelimit.ts`, `src/lib/errors.ts`, `tests/errors.test.ts`

`ratelimit.ts` is a thin wrapper over `@upstash/ratelimit` — we do NOT unit-test the library (its Redis Lua scripts cannot run against FakeRedis); it is exercised by the post-deploy smoke test in Task 15.

- [ ] **Step 1: Write the failing test** — `tests/errors.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { errJson } from "@/lib/errors";

describe("errJson", () => {
  it("emits OpenAI-style error JSON with mapped type", async () => {
    const res = errJson(429, "rate_limit_exceeded", "Slow down.", undefined, {
      "retry-after": "12",
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("12");
    const body = await res.json();
    expect(body).toEqual({
      error: { message: "Slow down.", type: "rate_limit_error", code: "rate_limit_exceeded" },
    });
  });

  it("includes extra fields inside error when given", async () => {
    const res = errJson(502, "all_providers_failed", "Everything burned.", {
      attempts: [{ provider: "openai", status: 500 }],
    });
    const body = await res.json();
    expect(body.error.attempts).toHaveLength(1);
    expect(body.error.type).toBe("api_error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors`.

- [ ] **Step 3: Write `src/lib/errors.ts`**

```ts
const TYPE_BY_STATUS: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  404: "invalid_request_error",
  429: "rate_limit_error",
  502: "api_error",
};

export function errJson(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
): Response {
  return Response.json(
    { error: { message, type: TYPE_BY_STATUS[status] ?? "api_error", code, ...extra } },
    { status, headers },
  );
}
```

- [ ] **Step 4: Write `src/lib/ratelimit.ts`**

```ts
import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./config-store";

export interface LimitResult {
  success: boolean;
  reset: number; // epoch ms when the window resets
}

/** Per-gateway-key RPM limit (sliding window). */
export async function checkRateLimit(keyHash: string, rpm: number): Promise<LimitResult> {
  const rl = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(rpm, "60 s"),
    prefix: "rl",
  });
  const { success, reset } = await rl.limit(keyHash);
  return { success, reset };
}

/** Per-IP limit for config endpoints (anti key-spam / brute force). */
export async function checkIpLimit(ip: string): Promise<LimitResult> {
  const rl = new Ratelimit({
    redis: redis(),
    limiter: Ratelimit.slidingWindow(20, "60 s"),
    prefix: "rlip",
  });
  const { success, reset } = await rl.limit(ip);
  return { success, reset };
}

export function retryAfterSeconds(reset: number): string {
  return String(Math.max(1, Math.ceil((reset - Date.now()) / 1000)));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/errors.test.ts`
Expected: 2 passed. Also run `npx tsc --noEmit` — ratelimit.ts must typecheck.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ratelimit.ts src/lib/errors.ts tests/errors.test.ts
git commit -m "feat: rate limiters and OpenAI-style error helper"
```

---

### Task 6: Provider registry

**Files:**
- Create: `src/lib/providers/registry.ts`, `tests/registry.test.ts`

All 8 providers. Six are natively OpenAI-compatible. Gemini uses Google's official OpenAI-compatibility base URL. Anthropic is `style: "anthropic"` and gets translated (Task 7).

- [ ] **Step 1: Write the failing test** — `tests/registry.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { PROVIDERS } from "@/lib/providers/registry";

describe("registry", () => {
  it("defines all 8 providers", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([
      "anthropic", "deepseek", "gemini", "groq",
      "mistral", "openai", "openrouter", "together",
    ]);
  });

  it("anthropic uses x-api-key + version header; others use Bearer", () => {
    const a = PROVIDERS.anthropic.authHeader("sk-ant-1");
    expect(a["x-api-key"]).toBe("sk-ant-1");
    expect(a["anthropic-version"]).toBeTruthy();
    expect(PROVIDERS.openai.authHeader("sk-1")).toEqual({ Authorization: "Bearer sk-1" });
  });

  it("every provider has a baseURL, style and defaultModel", () => {
    for (const def of Object.values(PROVIDERS)) {
      expect(def.baseURL).toMatch(/^https:\/\//);
      expect(["openai", "anthropic"]).toContain(def.style);
      expect(def.defaultModel.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry.test.ts`
Expected: FAIL — cannot resolve `@/lib/providers/registry`.

- [ ] **Step 3: Write `src/lib/providers/registry.ts`**

```ts
import type { ProviderId } from "../types";

export interface ProviderDef {
  label: string;
  baseURL: string;
  style: "openai" | "anthropic";
  defaultModel: string;
  authHeader: (key: string) => Record<string, string>;
}

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openai: {
    label: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    style: "openai",
    defaultModel: "gpt-4o",
    authHeader: bearer,
  },
  anthropic: {
    label: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    style: "anthropic",
    defaultModel: "claude-sonnet-4-6",
    authHeader: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  gemini: {
    label: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    style: "openai",
    defaultModel: "gemini-2.0-flash",
    authHeader: bearer,
  },
  groq: {
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    style: "openai",
    defaultModel: "llama-3.3-70b-versatile",
    authHeader: bearer,
  },
  mistral: {
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    style: "openai",
    defaultModel: "mistral-large-latest",
    authHeader: bearer,
  },
  together: {
    label: "Together",
    baseURL: "https://api.together.xyz/v1",
    style: "openai",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    authHeader: bearer,
  },
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com/v1",
    style: "openai",
    defaultModel: "deepseek-chat",
    authHeader: bearer,
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    style: "openai",
    defaultModel: "openrouter/auto",
    authHeader: bearer,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/registry.ts tests/registry.test.ts
git commit -m "feat: 8-provider registry"
```

---

### Task 7: Anthropic translator

**Files:**
- Create: `src/lib/providers/anthropic.ts`, `tests/anthropic.test.ts`

Translates OpenAI chat-completions format to/from Anthropic Messages API, including SSE streaming. Text-only in v1 (no tool calls).

- [ ] **Step 1: Write the failing tests** — `tests/anthropic.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  toAnthropicBody, fromAnthropicResponse, translateAnthropicSSE,
} from "@/lib/providers/anthropic";

describe("toAnthropicBody", () => {
  it("extracts system messages, maps roles, defaults max_tokens", () => {
    const out = toAnthropicBody({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "user", content: [{ type: "text", text: "Part A" }, { type: "text", text: " B" }] },
      ],
      temperature: 0.5,
      stop: "END",
    });
    expect(out.system).toBe("Be terse.");
    expect(out.messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "Part A B" },
    ]);
    expect(out.max_tokens).toBe(4096);
    expect(out.temperature).toBe(0.5);
    expect(out.stop_sequences).toEqual(["END"]);
    expect(out.stream).toBeUndefined();
  });

  it("respects explicit max_tokens and stream flag", () => {
    const out = toAnthropicBody({
      model: "m", messages: [{ role: "user", content: "x" }], max_tokens: 99, stream: true,
    });
    expect(out.max_tokens).toBe(99);
    expect(out.stream).toBe(true);
  });
});

describe("fromAnthropicResponse", () => {
  it("maps content blocks, stop_reason and usage", () => {
    const out = fromAnthropicResponse(
      {
        id: "msg_01",
        content: [{ type: "text", text: "Hel" }, { type: "text", text: "lo" }],
        stop_reason: "max_tokens",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      "anthropic/claude-sonnet-4-6",
    );
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message).toEqual({ role: "assistant", content: "Hello" });
    expect(out.choices[0].finish_reason).toBe("length");
    expect(out.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  });
});

describe("translateAnthropicSSE", () => {
  function anthropicStream(events: object[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(c) {
        for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        c.close();
      },
    });
  }

  async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
    const text = await new Response(stream).text();
    return text.split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));
  }

  it("converts anthropic events to OpenAI chunks ending in [DONE]", async () => {
    const out = translateAnthropicSSE(
      anthropicStream([
        { type: "message_start", message: { id: "msg_01" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } },
        { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]),
      "anthropic/claude-sonnet-4-6",
    );
    const frames = await collect(out);
    expect(frames.at(-1)).toBe("[DONE]");
    const chunks = frames.slice(0, -1).map((f) => JSON.parse(f));
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(chunks[1].choices[0].delta.content).toBe("Hel");
    expect(chunks[2].choices[0].delta.content).toBe("lo");
    expect(chunks[3].choices[0].finish_reason).toBe("stop");
    expect(chunks.every((c) => c.object === "chat.completion.chunk")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/anthropic.test.ts`
Expected: FAIL — cannot resolve `@/lib/providers/anthropic`.

- [ ] **Step 3: Write `src/lib/providers/anthropic.ts`**

```ts
/** OpenAI chat-completions <-> Anthropic Messages translation. Text-only (v1). */

function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p as { text?: string }).text ?? "").join("");
  return "";
}

function mapStop(reason: string | null | undefined): string {
  if (reason === "max_tokens") return "length";
  return "stop"; // end_turn, stop_sequence, anything else
}

export function toAnthropicBody(body: Record<string, any>): Record<string, any> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: unknown }>;
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => contentText(m.content))
    .join("\n");
  return {
    model: body.model,
    ...(system && { system }),
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: contentText(m.content),
      })),
    max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 4096,
    ...(body.temperature !== undefined && { temperature: body.temperature }),
    ...(body.top_p !== undefined && { top_p: body.top_p }),
    ...(body.stop && { stop_sequences: Array.isArray(body.stop) ? body.stop : [body.stop] }),
    ...(body.stream && { stream: true }),
  };
}

export function fromAnthropicResponse(a: Record<string, any>, model: string): Record<string, any> {
  const input = a.usage?.input_tokens ?? 0;
  const output = a.usage?.output_tokens ?? 0;
  return {
    id: a.id ?? "chatcmpl-gw",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: ((a.content ?? []) as Array<{ text?: string }>).map((b) => b.text ?? "").join(""),
        },
        finish_reason: mapStop(a.stop_reason),
      },
    ],
    usage: { prompt_tokens: input, completion_tokens: output, total_tokens: input + output },
  };
}

/** Re-emits an Anthropic SSE stream as OpenAI chat.completion.chunk SSE frames. */
export function translateAnthropicSSE(
  upstream: ReadableStream<Uint8Array>,
  model: string,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let buffer = "";
  const id = "chatcmpl-gw" + Math.random().toString(36).slice(2, 10);
  const created = Math.floor(Date.now() / 1000);

  const frame = (delta: object, finish: string | null = null) =>
    enc.encode(
      `data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`,
    );

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(part, controller) {
        buffer += dec.decode(part, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let evt: Record<string, any>;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === "message_start") {
            controller.enqueue(frame({ role: "assistant", content: "" }));
          } else if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
            controller.enqueue(frame({ content: evt.delta.text }));
          } else if (evt.type === "message_delta" && evt.delta?.stop_reason) {
            controller.enqueue(frame({}, mapStop(evt.delta.stop_reason)));
          } else if (evt.type === "message_stop") {
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
          }
        }
      },
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/anthropic.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/anthropic.ts tests/anthropic.test.ts
git commit -m "feat: OpenAI<->Anthropic translator incl. SSE streaming"
```

---

### Task 8: callProvider (single upstream call with timeout)

**Files:**
- Create: `src/lib/providers/call.ts`, `tests/call.test.ts`

One HTTP call to one provider. 25s default timeout covers time-to-headers (first token for streams). `fetchFn` is injectable for tests.

- [ ] **Step 1: Write the failing tests** — `tests/call.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { callProvider } from "@/lib/providers/call";

describe("callProvider — openai style", () => {
  it("POSTs to {baseURL}/chat/completions with bearer auth and swapped model", async () => {
    const fetchFn = vi.fn(async () => Response.json({ ok: true }));
    await callProvider({
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      body: { model: "groq/llama-3.3-70b-versatile", messages: [{ role: "user", content: "hi" }] },
      apiKey: "gsk-1",
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gsk-1");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("llama-3.3-70b-versatile"); // provider prefix stripped
  });

  it("aborts after timeoutMs", async () => {
    const fetchFn = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    await expect(
      callProvider({
        provider: "openai",
        model: "gpt-4o",
        body: { messages: [] },
        apiKey: "sk-1",
        timeoutMs: 30,
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow();
  });
});

describe("callProvider — anthropic style", () => {
  it("translates body, calls /messages, translates non-stream response back", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const sent = JSON.parse(init.body as string);
      expect(sent.system).toBe("Be terse.");
      expect(sent.max_tokens).toBe(4096);
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-1");
      return Response.json({
        id: "msg_01",
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2 },
      });
    });
    const res = await callProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      body: {
        messages: [
          { role: "system", content: "Be terse." },
          { role: "user", content: "hi" },
        ],
      },
      apiKey: "sk-ant-1",
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const json = await res.json();
    expect(json.object).toBe("chat.completion");
    expect(json.choices[0].message.content).toBe("Hello");
  });

  it("passes anthropic error responses through untranslated", async () => {
    const fetchFn = vi.fn(async () => Response.json({ error: "overloaded" }, { status: 529 }));
    const res = await callProvider({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      body: { messages: [{ role: "user", content: "hi" }] },
      apiKey: "sk-ant-1",
      timeoutMs: 1000,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res.status).toBe(529);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/call.test.ts`
Expected: FAIL — cannot resolve `@/lib/providers/call`.

- [ ] **Step 3: Write `src/lib/providers/call.ts`**

```ts
import type { ProviderId } from "../types";
import { PROVIDERS } from "./registry";
import { fromAnthropicResponse, toAnthropicBody, translateAnthropicSSE } from "./anthropic";

export interface CallOpts {
  provider: ProviderId;
  model: string; // bare model name, provider prefix already stripped
  body: Record<string, any>;
  apiKey: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

/**
 * Makes one upstream call. Timeout covers time-to-headers (≈ first token for
 * streams); the timer is cleared once headers arrive so long streams are safe.
 */
export async function callProvider(opts: CallOpts): Promise<Response> {
  const { provider, model, body, apiKey, timeoutMs, fetchFn = fetch } = opts;
  const def = PROVIDERS[provider];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (def.style === "anthropic") {
      const res = await fetchFn(`${def.baseURL}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...def.authHeader(apiKey) },
        body: JSON.stringify(toAnthropicBody({ ...body, model })),
        signal: controller.signal,
      });
      if (!res.ok) return res;
      if (body.stream) {
        return new Response(translateAnthropicSSE(res.body!, `${provider}/${model}`), {
          status: 200,
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }
      return Response.json(fromAnthropicResponse(await res.json(), `${provider}/${model}`));
    }

    return await fetchFn(`${def.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...def.authHeader(apiKey) },
      body: JSON.stringify({ ...body, model }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/call.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/call.ts tests/call.test.ts
git commit -m "feat: callProvider with timeout and anthropic translation"
```

---

### Task 9: Gateway fallback engine

**Files:**
- Create: `src/lib/gateway.ts`, `tests/gateway.test.ts`

The core product logic: resolve the chain from the requested model, walk it on retryable failures, fail fast on caller errors, summarize total failure.

Rules (from spec §4):
- `model: "auto"` → config's fallback chain, filtered to providers that have keys.
- `model: "provider/model"` → single attempt, errors pass through unchanged.
- Retryable: HTTP 429, any 5xx, timeout/connection error. Not retryable: 400, 401.
- Max 4 attempts total (primary + 3 fallback hops).
- All attempts exhausted → 502 listing every attempt.

- [ ] **Step 1: Write the failing tests** — `tests/gateway.test.ts`

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/gateway.test.ts`
Expected: FAIL — cannot resolve `@/lib/gateway`.

- [ ] **Step 3: Write `src/lib/gateway.ts`**

```ts
import { errJson } from "./errors";
import { callProvider } from "./providers/call";
import { PROVIDERS } from "./providers/registry";
import type { ChainEntry, ProviderId } from "./types";

const MAX_ATTEMPTS = 4; // primary + 3 fallback hops (spec §4)
const DEFAULT_TIMEOUT_MS = 25_000;

export interface RouteOpts {
  body: Record<string, any>;
  chain: ChainEntry[];
  keys: Partial<Record<ProviderId, string>>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface GatewayResult {
  response: Response;
  provider: string; // "none" when every attempt failed
  fallbacks: number;
}

interface Attempt {
  provider: ProviderId;
  model: string;
  status: number; // 0 = no HTTP response (timeout / network error)
  error?: string;
}

/**
 * "auto" → configured chain filtered to providers with keys.
 * "provider/model" → single explicit entry (errors pass through, no fallback).
 */
export function resolveChain(
  model: string,
  chain: ChainEntry[],
  keys: Partial<Record<ProviderId, string>>,
): ChainEntry[] {
  if (model === "auto") {
    const usable = chain.filter((e) => keys[e.provider]);
    if (!usable.length) throw new Error("No API key configured for any provider in the fallback chain.");
    return usable;
  }
  const slash = model.indexOf("/");
  const provider = (slash === -1 ? model : model.slice(0, slash)) as ProviderId;
  const bare = slash === -1 ? "" : model.slice(slash + 1);
  if (!PROVIDERS[provider] || !bare) {
    throw new Error(
      `Unknown provider in model "${model}". Use "provider/model" (e.g. "openai/gpt-4o") or "auto".`,
    );
  }
  if (!keys[provider]) throw new Error(`No API key configured for provider "${provider}".`);
  return [{ provider, model: bare }];
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function routeRequest(opts: RouteOpts): Promise<GatewayResult> {
  const { body, chain, keys, fetchFn = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const attempts: Attempt[] = [];
  const max = Math.min(chain.length, MAX_ATTEMPTS);

  for (let i = 0; i < max; i++) {
    const entry = chain[i];
    try {
      const response = await callProvider({
        provider: entry.provider,
        model: entry.model,
        body,
        apiKey: keys[entry.provider]!,
        timeoutMs,
        fetchFn,
      });
      const passThrough =
        response.ok || !isRetryable(response.status) || chain.length === 1;
      if (passThrough) return { response, provider: entry.provider, fallbacks: i };
      attempts.push({ provider: entry.provider, model: entry.model, status: response.status });
    } catch (e) {
      attempts.push({
        provider: entry.provider,
        model: entry.model,
        status: 0,
        error: (e as Error).constructor.name,
      });
    }
  }

  return {
    response: errJson(502, "all_providers_failed", "All fallback providers failed.", { attempts }),
    provider: "none",
    fallbacks: attempts.length,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/gateway.test.ts`
Expected: 12 passed. Then run the full suite: `npm test` — everything green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gateway.ts tests/gateway.test.ts
git commit -m "feat: fallback routing engine (resolveChain + routeRequest)"
```

---

### Task 10: Gateway HTTP route — `/v1/chat/completions`

**Files:**
- Create: `src/app/v1/chat/completions/route.ts`

Thin HTTP shell over the tested engine — auth, rate limit, validation, observability headers, fire-and-forget usage. No unit test (all logic lives in tested libs); verified by `npm run build` typecheck now and the Task 15 smoke test live.

- [ ] **Step 1: Write `src/app/v1/chat/completions/route.ts`**

```ts
import { after } from "next/server";
import { getConfig } from "@/lib/config-store";
import { sha256 } from "@/lib/crypto";
import { errJson } from "@/lib/errors";
import { resolveChain, routeRequest } from "@/lib/gateway";
import { checkRateLimit, retryAfterSeconds } from "@/lib/ratelimit";
import { recordUsage } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

function bearerKey(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

export async function POST(req: Request) {
  const gwKey = bearerKey(req);
  if (!gwKey.startsWith("gw_")) {
    return errJson(401, "invalid_api_key", "Pass your gateway key as: Authorization: Bearer gw_live_...");
  }
  const config = await getConfig(gwKey);
  if (!config) return errJson(401, "invalid_api_key", "Unknown gateway key.");
  const keyHash = sha256(gwKey);

  const rl = await checkRateLimit(keyHash, config.rateLimit.rpm);
  if (!rl.success) {
    return errJson(
      429,
      "rate_limit_exceeded",
      `Rate limit of ${config.rateLimit.rpm} requests/min exceeded.`,
      undefined,
      { "retry-after": retryAfterSeconds(rl.reset) },
    );
  }

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Request body must be valid JSON.");
  }
  if (typeof body?.model !== "string" || !Array.isArray(body?.messages)) {
    return errJson(400, "invalid_request_error", "`model` (string) and `messages` (array) are required.");
  }

  let chain;
  try {
    chain = resolveChain(body.model, config.fallbackChain, config.providers);
  } catch (e) {
    return errJson(400, "invalid_request_error", (e as Error).message);
  }

  const started = Date.now();
  const result = await routeRequest({ body, chain, keys: config.providers });

  after(() =>
    recordUsage(keyHash, {
      provider: result.provider === "none" ? undefined : result.provider,
      fallbacks: result.fallbacks,
      error: !result.response.ok,
    }).catch(() => {}),
  );

  const headers = new Headers(result.response.headers);
  headers.set("x-gateway-provider", result.provider);
  headers.set("x-gateway-fallback-count", String(result.fallbacks));
  headers.set("x-gateway-latency-ms", String(Date.now() - started));
  return new Response(result.response.body, { status: result.response.status, headers });
}
```

- [ ] **Step 2: Verify build + full test suite**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/app/v1/chat/completions/route.ts
git commit -m "feat: /v1/chat/completions gateway route"
```

---

### Task 11: `/v1/models` + `/api/validate-key`

**Files:**
- Create: `src/app/v1/models/route.ts`, `src/app/api/validate-key/route.ts`

Both are thin proxies over provider `/models` endpoints (works uniformly for all 8 — Anthropic's `/v1/models` accepts its auth headers, Gemini's OpenAI-compat base has `/models`). No unit tests; verified by build + smoke test.

- [ ] **Step 1: Write `src/app/v1/models/route.ts`**

```ts
import { getConfig } from "@/lib/config-store";
import { errJson } from "@/lib/errors";
import { PROVIDERS } from "@/lib/providers/registry";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const gwKey = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const config = gwKey.startsWith("gw_") ? await getConfig(gwKey) : null;
  if (!config) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  const entries = Object.entries(config.providers) as [ProviderId, string][];
  const lists = await Promise.all(
    entries.map(async ([provider, apiKey]) => {
      const def = PROVIDERS[provider];
      try {
        const res = await fetch(`${def.baseURL}/models`, {
          headers: def.authHeader(apiKey),
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) return [];
        const json = (await res.json()) as { data?: Array<{ id: string }> };
        return (json.data ?? []).map((m) => ({
          id: `${provider}/${m.id}`,
          object: "model" as const,
          owned_by: provider,
        }));
      } catch {
        return []; // a dead provider must not break the listing
      }
    }),
  );

  return Response.json({ object: "list", data: lists.flat() });
}
```

- [ ] **Step 2: Write `src/app/api/validate-key/route.ts`**

```ts
import { errJson } from "@/lib/errors";
import { PROVIDERS } from "@/lib/providers/registry";
import { checkIpLimit, retryAfterSeconds } from "@/lib/ratelimit";
import type { ProviderId } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rl = await checkIpLimit(ip);
  if (!rl.success) {
    return errJson(429, "rate_limit_exceeded", "Too many validation attempts.", undefined, {
      "retry-after": retryAfterSeconds(rl.reset),
    });
  }

  let body: { provider?: string; key?: string };
  try {
    body = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Body must be valid JSON.");
  }
  const provider = body.provider as ProviderId;
  if (!PROVIDERS[provider] || typeof body.key !== "string" || !body.key.trim()) {
    return errJson(400, "invalid_request_error", "`provider` and `key` are required.");
  }

  try {
    const def = PROVIDERS[provider];
    const res = await fetch(`${def.baseURL}/models`, {
      headers: def.authHeader(body.key.trim()),
      signal: AbortSignal.timeout(8000),
    });
    return Response.json({ valid: res.ok });
  } catch {
    return Response.json({ valid: false });
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/v1/models/route.ts src/app/api/validate-key/route.ts
git commit -m "feat: /v1/models listing and live provider-key validation"
```

---

### Task 12: Config API — create / read / patch / delete / rotate

**Files:**
- Create: `src/lib/validate.ts`, `tests/validate.test.ts`, `src/app/api/config/route.ts`, `src/app/api/config/rotate/route.ts`

- [ ] **Step 1: Write the failing tests** — `tests/validate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { validateConfigInput } from "@/lib/validate";

const GOOD = {
  providers: { openai: "sk-1", groq: "gsk-1" },
  fallbackChain: [
    { provider: "openai", model: "gpt-4o" },
    { provider: "groq", model: "llama-3.3-70b-versatile" },
  ],
  rateLimit: { rpm: 60 },
};

describe("validateConfigInput", () => {
  it("accepts a valid input", () => {
    const r = validateConfigInput(GOOD);
    expect(r.error).toBeUndefined();
    expect(r.value?.rateLimit.rpm).toBe(60);
  });

  it("defaults rpm to 60 when rateLimit omitted", () => {
    const { rateLimit, ...rest } = GOOD;
    expect(validateConfigInput(rest).value?.rateLimit.rpm).toBe(60);
  });

  it("rejects: no providers, unknown provider, empty key", () => {
    expect(validateConfigInput({ ...GOOD, providers: {} }).error).toMatch(/at least one/i);
    expect(validateConfigInput({ ...GOOD, providers: { nope: "k" } }).error).toMatch(/unknown provider/i);
    expect(validateConfigInput({ ...GOOD, providers: { openai: " " } }).error).toMatch(/empty/i);
  });

  it("rejects: empty chain, chain entry without a key, bad model", () => {
    expect(validateConfigInput({ ...GOOD, fallbackChain: [] }).error).toMatch(/chain/i);
    expect(
      validateConfigInput({
        ...GOOD,
        fallbackChain: [{ provider: "mistral", model: "m" }],
      }).error,
    ).toMatch(/no key/i);
    expect(
      validateConfigInput({
        ...GOOD,
        fallbackChain: [{ provider: "openai", model: "" }],
      }).error,
    ).toMatch(/model/i);
  });

  it("rejects rpm outside 1..1000", () => {
    expect(validateConfigInput({ ...GOOD, rateLimit: { rpm: 0 } }).error).toMatch(/rpm/i);
    expect(validateConfigInput({ ...GOOD, rateLimit: { rpm: 2000 } }).error).toMatch(/rpm/i);
    expect(validateConfigInput({ ...GOOD, rateLimit: { rpm: 1.5 } }).error).toMatch(/rpm/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/validate.test.ts`
Expected: FAIL — cannot resolve `@/lib/validate`.

- [ ] **Step 3: Write `src/lib/validate.ts`**

```ts
import { PROVIDERS } from "./providers/registry";
import type { ChainEntry, GatewayConfig, ProviderId } from "./types";

export interface ValidationResult {
  value?: Omit<GatewayConfig, "createdAt">;
  error?: string;
}

export function validateConfigInput(input: unknown): ValidationResult {
  const o = (input ?? {}) as Record<string, any>;

  const providers: Partial<Record<ProviderId, string>> = {};
  const rawProviders = o.providers ?? {};
  for (const [p, k] of Object.entries(rawProviders)) {
    if (!(p in PROVIDERS)) return { error: `Unknown provider "${p}".` };
    if (typeof k !== "string" || !k.trim()) return { error: `Empty API key for "${p}".` };
    providers[p as ProviderId] = k.trim();
  }
  if (!Object.keys(providers).length) return { error: "Add at least one provider API key." };

  const rawChain = o.fallbackChain;
  if (!Array.isArray(rawChain) || !rawChain.length) {
    return { error: "Fallback chain must contain at least one entry." };
  }
  if (rawChain.length > 8) return { error: "Fallback chain supports at most 8 entries." };
  const fallbackChain: ChainEntry[] = [];
  for (const e of rawChain) {
    const provider = e?.provider as ProviderId;
    if (!(provider in PROVIDERS)) return { error: `Unknown provider "${e?.provider}" in chain.` };
    if (!providers[provider]) return { error: `Chain entry "${provider}" has no key configured.` };
    if (typeof e?.model !== "string" || !e.model.trim()) {
      return { error: `Chain entry "${provider}" needs a model name.` };
    }
    fallbackChain.push({ provider, model: e.model.trim() });
  }

  const rpm = o.rateLimit?.rpm ?? 60;
  if (!Number.isInteger(rpm) || rpm < 1 || rpm > 1000) {
    return { error: "rateLimit.rpm must be an integer between 1 and 1000." };
  }

  return { value: { providers, fallbackChain, rateLimit: { rpm } } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/validate.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Write `src/app/api/config/route.ts`**

```ts
import {
  createConfig, deleteConfig, getConfig, updateConfig,
} from "@/lib/config-store";
import { generateGatewayKey, maskKey, sha256 } from "@/lib/crypto";
import { errJson } from "@/lib/errors";
import { checkIpLimit, retryAfterSeconds } from "@/lib/ratelimit";
import { getUsage, lastDays } from "@/lib/usage";
import { validateConfigInput } from "@/lib/validate";

export const runtime = "nodejs";

async function ipGate(req: Request): Promise<Response | null> {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rl = await checkIpLimit(ip);
  if (rl.success) return null;
  return errJson(429, "rate_limit_exceeded", "Too many requests. Try again shortly.", undefined, {
    "retry-after": retryAfterSeconds(rl.reset),
  });
}

function bearerKey(req: Request): string {
  return (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/** Create a config. Returns the gateway key — shown exactly once, never stored. */
export async function POST(req: Request) {
  const gate = await ipGate(req);
  if (gate) return gate;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Body must be valid JSON.");
  }
  const { value, error } = validateConfigInput(body);
  if (error) return errJson(400, "invalid_request_error", error);

  const gatewayKey = generateGatewayKey();
  await createConfig(gatewayKey, value!);
  return Response.json({ gatewayKey }, { status: 201 });
}

/** Read masked config + 7-day usage. Auth: Bearer gw key. */
export async function GET(req: Request) {
  const gwKey = bearerKey(req);
  const config = gwKey.startsWith("gw_") ? await getConfig(gwKey) : null;
  if (!config) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  return Response.json({
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([p, k]) => [p, maskKey(k as string)]),
    ),
    fallbackChain: config.fallbackChain,
    rateLimit: config.rateLimit,
    createdAt: config.createdAt,
    usage: await getUsage(sha256(gwKey), lastDays(7)),
  });
}

/** Patch chain / rpm / provider keys (string = set, null = remove). */
export async function PATCH(req: Request) {
  const gate = await ipGate(req);
  if (gate) return gate;

  const gwKey = bearerKey(req);
  const config = gwKey.startsWith("gw_") ? await getConfig(gwKey) : null;
  if (!config) return errJson(401, "invalid_api_key", "Unknown gateway key.");

  let patch: Record<string, any>;
  try {
    patch = await req.json();
  } catch {
    return errJson(400, "invalid_request_error", "Body must be valid JSON.");
  }

  // Validate the MERGED result so a patch can never leave a broken config.
  const mergedProviders: Record<string, string> = { ...config.providers } as Record<string, string>;
  for (const [p, v] of Object.entries(patch.providers ?? {})) {
    if (v === null) delete mergedProviders[p];
    else mergedProviders[p] = v as string;
  }
  const { error } = validateConfigInput({
    providers: mergedProviders,
    fallbackChain: patch.fallbackChain ?? config.fallbackChain,
    rateLimit: patch.rateLimit ?? config.rateLimit,
  });
  if (error) return errJson(400, "invalid_request_error", error);

  await updateConfig(gwKey, {
    providers: patch.providers,
    fallbackChain: patch.fallbackChain,
    rateLimit: patch.rateLimit,
  });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const gwKey = bearerKey(req);
  if (!gwKey.startsWith("gw_") || !(await deleteConfig(gwKey))) {
    return errJson(401, "invalid_api_key", "Unknown gateway key.");
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 6: Write `src/app/api/config/rotate/route.ts`**

```ts
import { rotateKey } from "@/lib/config-store";
import { errJson } from "@/lib/errors";
import { checkIpLimit, retryAfterSeconds } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const rl = await checkIpLimit(ip);
  if (!rl.success) {
    return errJson(429, "rate_limit_exceeded", "Too many requests.", undefined, {
      "retry-after": retryAfterSeconds(rl.reset),
    });
  }

  const gwKey = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const newKey = gwKey.startsWith("gw_") ? await rotateKey(gwKey) : null;
  if (!newKey) return errJson(401, "invalid_api_key", "Unknown gateway key.");
  return Response.json({ gatewayKey: newKey });
}
```

- [ ] **Step 7: Verify build + full suite**

Run: `npm run build && npm test`
Expected: build succeeds, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/validate.ts tests/validate.test.ts src/app/api/config
git commit -m "feat: config API with validation, masking, rotate"
```

---

### Task 13: Landing page — the piece of art

**Files:**
- Replace: `src/app/globals.css`, `src/app/page.tsx`
- Create: `src/components/RouteDiagram.tsx`, `src/components/Terminal.tsx`

Dark terminal-luxe. No animation libraries — SVG SMIL + CSS only. After this task, `npm run dev` and eyeball `http://localhost:3000`: hero pulses flowing, provider 3 dying red and traffic rerouting, terminal typing.

- [ ] **Step 1: Replace `src/app/globals.css`**

```css
:root {
  --bg: #0a0a0b;
  --bg-2: #101013;
  --bg-3: #16161a;
  --line: #222228;
  --text: #ececef;
  --muted: #8e8e97;
  --accent: #00ff88;
  --accent-dim: rgba(0, 255, 136, 0.1);
  --red: #ff4d5e;
  --sans: var(--font-sans), system-ui, sans-serif;
  --mono: var(--font-mono), ui-monospace, monospace;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  -webkit-font-smoothing: antialiased;
  line-height: 1.6;
}
a { color: inherit; text-decoration: none; }
code, pre, .mono { font-family: var(--mono); }

.container { max-width: 1100px; margin: 0 auto; padding: 0 24px; }

/* nav */
.nav {
  display: flex; justify-content: space-between; align-items: center;
  padding: 20px 0; border-bottom: 1px solid var(--line);
}
.nav .logo { font-family: var(--mono); font-weight: 700; font-size: 18px; }
.nav .logo span { color: var(--accent); }
.nav .links { display: flex; gap: 28px; font-size: 14px; color: var(--muted); }
.nav .links a:hover { color: var(--text); }

/* hero */
.hero { padding: 88px 0 40px; text-align: center; }
.hero h1 {
  font-size: clamp(36px, 6vw, 64px); line-height: 1.08;
  letter-spacing: -0.03em; margin: 0 0 20px; font-weight: 700;
}
.hero h1 em { font-style: normal; color: var(--accent); }
.hero p.sub {
  color: var(--muted); font-size: clamp(16px, 2vw, 19px);
  max-width: 640px; margin: 0 auto 36px;
}
.cta-row { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
.btn {
  display: inline-block; padding: 13px 26px; border-radius: 8px;
  font-size: 15px; font-weight: 600; border: 1px solid var(--line);
  transition: all 0.15s ease; cursor: pointer; background: none; color: var(--text);
  font-family: var(--sans);
}
.btn:hover { border-color: var(--muted); transform: translateY(-1px); }
.btn.primary {
  background: var(--accent); color: #04130b; border-color: var(--accent);
}
.btn.primary:hover { box-shadow: 0 0 32px rgba(0, 255, 136, 0.35); }

/* shared section bits */
.section { padding: 72px 0; border-top: 1px solid var(--line); }
.section h2 {
  font-size: clamp(26px, 4vw, 38px); letter-spacing: -0.02em;
  margin: 0 0 10px; text-align: center;
}
.section p.lead { color: var(--muted); text-align: center; margin: 0 auto 48px; max-width: 560px; }
.kicker {
  font-family: var(--mono); font-size: 12px; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--accent); text-align: center;
  display: block; margin-bottom: 14px;
}

/* feature grid */
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
.card {
  background: var(--bg-2); border: 1px solid var(--line);
  border-radius: 12px; padding: 26px;
}
.card:hover { border-color: #2e2e36; }
.card h3 { margin: 0 0 8px; font-size: 17px; }
.card p { margin: 0; color: var(--muted); font-size: 14.5px; }
.card .ico { font-family: var(--mono); color: var(--accent); font-size: 13px; display: block; margin-bottom: 14px; }

/* providers row */
.providers { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.providers span {
  font-family: var(--mono); font-size: 13.5px; color: var(--muted);
  border: 1px solid var(--line); border-radius: 999px; padding: 8px 18px;
}
.providers span:hover { color: var(--accent); border-color: var(--accent); }

/* steps */
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; counter-reset: step; }
@media (max-width: 800px) { .steps { grid-template-columns: 1fr; } }
.step { background: var(--bg-2); border: 1px solid var(--line); border-radius: 12px; padding: 26px; }
.step::before {
  counter-increment: step; content: "0" counter(step);
  font-family: var(--mono); color: var(--accent); display: block; margin-bottom: 12px;
}

/* terminal */
.terminal {
  background: var(--bg-2); border: 1px solid var(--line); border-radius: 12px;
  max-width: 720px; margin: 0 auto; overflow: hidden;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.5);
  text-align: left;
}
.terminal .bar {
  display: flex; gap: 7px; padding: 13px 16px; border-bottom: 1px solid var(--line);
}
.terminal .bar i { width: 11px; height: 11px; border-radius: 50%; background: var(--bg-3); }
.terminal pre {
  margin: 0; padding: 20px; font-size: 13px; line-height: 1.7;
  white-space: pre-wrap; word-break: break-word; min-height: 270px;
}
.terminal .c-cmd { color: var(--text); }
.terminal .c-dim { color: var(--muted); }
.terminal .c-acc { color: var(--accent); }
.cursor {
  display: inline-block; width: 8px; height: 15px; background: var(--accent);
  vertical-align: -2px; animation: blink 1s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }

/* FAQ */
.faq { max-width: 720px; margin: 0 auto; }
.faq details { border-bottom: 1px solid var(--line); padding: 18px 0; }
.faq summary { cursor: pointer; font-weight: 600; font-size: 16px; list-style: none; }
.faq summary::after { content: "+"; float: right; color: var(--accent); }
.faq details[open] summary::after { content: "–"; }
.faq p { color: var(--muted); margin: 12px 0 0; font-size: 14.5px; }

/* forms (used by /start and /manage) */
.panel {
  background: var(--bg-2); border: 1px solid var(--line);
  border-radius: 12px; padding: 28px; margin-bottom: 20px;
}
.panel h3 { margin: 0 0 6px; font-size: 17px; }
.panel p.hint { color: var(--muted); font-size: 13.5px; margin: 0 0 18px; }
.field { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.field label { width: 120px; font-family: var(--mono); font-size: 13px; color: var(--muted); }
.field input, .field select {
  flex: 1; background: var(--bg); border: 1px solid var(--line); border-radius: 8px;
  color: var(--text); padding: 10px 12px; font-family: var(--mono); font-size: 13px;
  outline: none;
}
.field input:focus { border-color: var(--accent); }
.badge { font-family: var(--mono); font-size: 12px; width: 26px; text-align: center; }
.badge.ok { color: var(--accent); }
.badge.bad { color: var(--red); }
.chain-row {
  display: flex; align-items: center; gap: 10px; background: var(--bg);
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin-bottom: 8px;
  font-family: var(--mono); font-size: 13px;
}
.chain-row .order { color: var(--accent); width: 22px; }
.chain-row input { flex: 1; background: none; border: none; color: var(--text); font-family: var(--mono); font-size: 13px; outline: none; }
.chain-row .arrows button {
  background: none; border: 1px solid var(--line); color: var(--muted); border-radius: 6px;
  cursor: pointer; padding: 2px 8px; margin-left: 4px; font-size: 12px;
}
.chain-row .arrows button:hover { color: var(--accent); border-color: var(--accent); }
.keybox {
  background: var(--bg); border: 1px solid var(--accent); border-radius: 10px;
  padding: 18px; font-family: var(--mono); font-size: 14px; color: var(--accent);
  word-break: break-all; margin: 14px 0;
}
.error-text { color: var(--red); font-size: 13.5px; font-family: var(--mono); }

/* footer */
footer {
  border-top: 1px solid var(--line); padding: 36px 0; margin-top: 72px;
  color: var(--muted); font-size: 13.5px; display: block;
}
footer .container { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
```

- [ ] **Step 2: Write `src/components/RouteDiagram.tsx`** (server component — pure SVG, SMIL animations)

The narrative: pulses leave the `gw_` node, pass the gateway, and fan out to 8 providers. Provider #3 (OpenAI row stays healthy; the third node) periodically flashes red ("down") and the pulse that would hit it visibly takes the next path instead.

```tsx
const PROVIDERS = [
  "OpenAI", "Anthropic", "Gemini", "Groq", "Mistral", "Together", "DeepSeek", "OpenRouter",
];

// Vertical positions for the 8 provider nodes
const ys = [36, 84, 132, 180, 228, 276, 324, 372];
// Path from gateway (360,204) to provider node x=590
const path = (y: number) => `M 372 204 C 470 204, 480 ${y}, 588 ${y}`;
const DOWN = 2; // index of the provider that "dies" (Gemini row)

export default function RouteDiagram() {
  return (
    <svg
      viewBox="0 0 720 408"
      role="img"
      aria-label="Requests flow through the gateway to 8 providers; when one fails, traffic reroutes automatically"
      style={{ width: "100%", maxWidth: 760, display: "block", margin: "48px auto 0" }}
    >
      <defs>
        <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* client → gateway line */}
      <path d="M 132 204 L 288 204" stroke="#222228" strokeWidth="1.5" fill="none" />
      {/* gateway → provider curves */}
      {ys.map((y, i) => (
        <path key={i} d={path(y)} stroke="#222228" strokeWidth="1.5" fill="none" />
      ))}

      {/* client node */}
      <rect x="40" y="186" width="92" height="36" rx="8" fill="#101013" stroke="#222228" />
      <text x="86" y="208" textAnchor="middle" fill="#8e8e97" fontSize="12" fontFamily="var(--mono)">
        gw_live_…
      </text>

      {/* gateway node */}
      <rect x="288" y="178" width="84" height="52" rx="10" fill="#101013" stroke="#00ff88" filter="url(#glow)" />
      <text x="330" y="201" textAnchor="middle" fill="#00ff88" fontSize="11" fontFamily="var(--mono)">
        GATEWAY
      </text>
      <text x="330" y="216" textAnchor="middle" fill="#8e8e97" fontSize="9" fontFamily="var(--mono)">
        route · limit · retry
      </text>

      {/* provider nodes */}
      {PROVIDERS.map((name, i) => (
        <g key={name}>
          <rect x="588" y={ys[i] - 14} width="106" height="28" rx="7" fill="#101013"
            stroke={i === DOWN ? "#ff4d5e" : "#222228"}>
            {i === DOWN && (
              <animate attributeName="stroke" values="#222228;#222228;#ff4d5e;#ff4d5e;#222228"
                keyTimes="0;0.45;0.5;0.85;1" dur="8s" repeatCount="indefinite" />
            )}
          </rect>
          <text x="641" y={ys[i] + 4} textAnchor="middle" fill="#8e8e97" fontSize="11" fontFamily="var(--mono)">
            {name}
            {i === DOWN && (
              <animate attributeName="fill" values="#8e8e97;#8e8e97;#ff4d5e;#ff4d5e;#8e8e97"
                keyTimes="0;0.45;0.5;0.85;1" dur="8s" repeatCount="indefinite" />
            )}
          </text>
        </g>
      ))}

      {/* steady pulses to healthy providers */}
      {[0, 1, 4, 6].map((target, i) => (
        <circle key={target} r="3.5" fill="#00ff88" filter="url(#glow)">
          <animateMotion dur="2.6s" begin={`${i * 0.65}s`} repeatCount="indefinite"
            path={path(ys[target])} />
          <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1"
            dur="2.6s" begin={`${i * 0.65}s`} repeatCount="indefinite" />
        </circle>
      ))}

      {/* client → gateway feed pulses */}
      <circle r="3.5" fill="#00ff88" filter="url(#glow)">
        <animateMotion dur="1.3s" repeatCount="indefinite" path="M 132 204 L 288 204" />
      </circle>

      {/* the reroute story: pulse heads to the DOWN provider in the first half of
          the 8s cycle, then visibly takes the next path during the outage window */}
      <circle r="3.5" fill="#00ff88" filter="url(#glow)">
        <animateMotion dur="2s" begin="0s;reroute-a.end+6s" id="reroute-ok" path={path(ys[DOWN])} />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="2s"
          begin="0s;reroute-a.end+6s" />
      </circle>
      <circle r="3.5" fill="#00ff88" filter="url(#glow)">
        <animateMotion dur="2s" begin="reroute-ok.end+2s" id="reroute-a" path={path(ys[DOWN + 1])} />
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.9;1" dur="2s"
          begin="reroute-ok.end+2s" />
      </circle>
    </svg>
  );
}
```

- [ ] **Step 3: Write `src/components/Terminal.tsx`** (client component — typewriter)

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

const SCRIPT = [
  { cls: "c-dim", text: "$ " },
  { cls: "c-cmd", text: "curl https://gatewayforai.com/v1/chat/completions \\\n" },
  { cls: "c-cmd", text: '    -H "Authorization: Bearer gw_live_x9K2…" \\\n' },
  { cls: "c-cmd", text: '    -d \'{"model": "auto", "messages": [{"role": "user", "content": "hi"}]}\'\n\n' },
  { cls: "c-dim", text: "< HTTP/2 200\n" },
  { cls: "c-acc", text: "< x-gateway-provider: groq\n" },
  { cls: "c-acc", text: "< x-gateway-fallback-count: 1\n" },
  { cls: "c-dim", text: "< x-gateway-latency-ms: 312\n\n" },
  { cls: "c-cmd", text: '{"choices": [{"message": {"content": "Hello! …"}}]}' },
];

export default function Terminal() {
  const [count, setCount] = useState(0);
  const total = useRef(SCRIPT.reduce((n, s) => n + s.text.length, 0));

  useEffect(() => {
    if (count >= total.current) return;
    const t = setTimeout(() => setCount((c) => c + 1), 18);
    return () => clearTimeout(t);
  }, [count]);

  let remaining = count;
  const visible = SCRIPT.map((seg) => {
    const take = Math.max(0, Math.min(seg.text.length, remaining));
    remaining -= take;
    return { ...seg, text: seg.text.slice(0, take) };
  });

  return (
    <div className="terminal">
      <div className="bar"><i /><i /><i /></div>
      <pre>
        {visible.map((seg, i) => (
          <span key={i} className={seg.cls}>{seg.text}</span>
        ))}
        <span className="cursor" />
      </pre>
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/app/page.tsx`**

```tsx
import Link from "next/link";
import RouteDiagram from "@/components/RouteDiagram";
import Terminal from "@/components/Terminal";

const FEATURES = [
  ["[~>]", "Automatic fallback", "A provider returns 429 or 500? The request reroutes to the next provider in your chain mid-flight. Your users never see the outage."],
  ["[##]", "Rate limiting", "Per-key sliding-window limits you control. Protect your budget from runaway loops and abusive clients."],
  ["[8x]", "Eight providers", "OpenAI, Anthropic, Gemini, Groq, Mistral, Together, DeepSeek, OpenRouter — one endpoint, one key."],
  ["[->]", "Drop-in compatible", "OpenAI SDK compatible. Change the baseURL and the key. That is the whole migration."],
  ["[:|]", "Zero retention", "Your prompts and responses pass through and are gone. We store encrypted keys and counters — never content."],
  ["[no]", "No signup", "No account, no email, no sales call. Paste keys, get a gateway key, ship."],
] as const;

const FAQ = [
  ["Is my OpenAI/Anthropic key safe?", "Keys are encrypted with AES-256-GCM before they touch storage and are only decrypted in-memory to call the provider you chose. They are never logged, never shown again, and you can rotate or delete your config at any time."],
  ["Do you store my prompts?", "No. Requests and responses stream through the gateway and are not persisted. We keep aggregate counters (request counts per day) so you can see usage — never content."],
  ["What happens when a provider goes down?", "If your model is \"auto\", the gateway retries the next provider in your fallback chain on 429s, 5xx errors and timeouts — up to 3 hops. You get a x-gateway-fallback-count header telling you it happened."],
  ["Does streaming work?", "Yes. SSE streaming passes straight through, including for Anthropic models (translated to OpenAI chunk format on the fly)."],
  ["What does it cost?", "The gateway is free. You pay your providers directly with your own keys — we never touch your billing."],
  ["I lost my gateway key.", "Keys cannot be recovered (we only store a hash). Create a new config at /start — it takes 30 seconds."],
] as const;

export default function Home() {
  return (
    <>
      <div className="container">
        <nav className="nav">
          <Link href="/" className="logo">gateway<span>for</span>ai</Link>
          <div className="links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
            <Link href="/manage">Manage</Link>
            <Link href="/start" style={{ color: "var(--accent)" }}>Get started →</Link>
          </div>
        </nav>

        <section className="hero">
          <h1>One endpoint.<br />Eight providers.<br /><em>Zero downtime.</em></h1>
          <p className="sub">
            An OpenAI-compatible LLM gateway with automatic fallback routing and
            rate limiting. Bring your own keys. No signup, no markup, no stored prompts.
          </p>
          <div className="cta-row">
            <Link href="/start" className="btn primary">Create your gateway — 30s</Link>
            <a href="#how" className="btn">See how it works</a>
          </div>
          <RouteDiagram />
        </section>
      </div>

      <section className="section" id="demo">
        <div className="container">
          <span className="kicker">live behavior</span>
          <h2>Watch a failover happen</h2>
          <p className="lead">OpenAI rate-limited this request. Nobody noticed.</p>
          <Terminal />
        </div>
      </section>

      <section className="section" id="features">
        <div className="container">
          <span className="kicker">features</span>
          <h2>Infrastructure your LLM calls deserve</h2>
          <p className="lead">Everything between your app and the model APIs, handled.</p>
          <div className="grid">
            {FEATURES.map(([ico, title, body]) => (
              <div className="card" key={title}>
                <span className="ico">{ico}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <span className="kicker">providers</span>
          <h2>Route across all of them</h2>
          <p className="lead">Mix any providers you have keys for. Order them however you like.</p>
          <div className="providers">
            {["OpenAI", "Anthropic", "Google Gemini", "Groq", "Mistral", "Together", "DeepSeek", "OpenRouter"].map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="container">
          <span className="kicker">how it works</span>
          <h2>Shipping in three steps</h2>
          <p className="lead">No account. The gateway key is the account.</p>
          <div className="steps">
            <div className="step">
              <h3>Paste your provider keys</h3>
              <p style={{ color: "var(--muted)", fontSize: 14.5 }}>
                Any subset of the 8 providers. Each key is validated live, encrypted
                with AES-256-GCM, and never shown again.
              </p>
            </div>
            <div className="step">
              <h3>Order your fallback chain</h3>
              <p style={{ color: "var(--muted)", fontSize: 14.5 }}>
                Decide who answers first and who catches the failure. Set your
                rate limit. Get one gw_live_ key.
              </p>
            </div>
            <div className="step">
              <h3>Change two lines of code</h3>
              <p style={{ color: "var(--muted)", fontSize: 14.5 }}>
                Point baseURL at gatewayforai.com/v1, use your gateway key, set
                model to &quot;auto&quot;. Done.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="container">
          <span className="kicker">faq</span>
          <h2>Fair questions</h2>
          <p className="lead">The things you should ask anyone proxying your API keys.</p>
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer>
        <div className="container">
          <span className="mono">gateway<span style={{ color: "var(--accent)" }}>for</span>ai © 2026</span>
          <span>
            <Link href="/privacy">Privacy</Link> · <Link href="/start">Get started</Link> · <Link href="/manage">Manage</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
```

- [ ] **Step 5: Verify visually**

Run: `npm run dev`, open `http://localhost:3000`.
Expected: dark page, animated pulses in the hero diagram, the third provider node flashing red on an 8s cycle, terminal typing itself out, all sections styled. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/app/page.tsx src/components
git commit -m "feat: terminal-luxe landing page with animated route diagram"
```

---

### Task 14: `/start`, `/manage`, `/privacy` pages

**Files:**
- Create: `src/app/start/page.tsx`, `src/app/manage/page.tsx`, `src/app/privacy/page.tsx`

Both interactive pages are single client components reusing the form styles from globals.css. Keep them dependency-free.

- [ ] **Step 1: Write `src/app/start/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

const PROVIDERS = [
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-6" },
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-2.0-flash" },
  { id: "groq", label: "Groq", defaultModel: "llama-3.3-70b-versatile" },
  { id: "mistral", label: "Mistral", defaultModel: "mistral-large-latest" },
  { id: "together", label: "Together", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat" },
  { id: "openrouter", label: "OpenRouter", defaultModel: "openrouter/auto" },
] as const;

type Validity = "unknown" | "checking" | "ok" | "bad";

export default function Start() {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [valid, setValid] = useState<Record<string, Validity>>({});
  const [chain, setChain] = useState<Array<{ provider: string; model: string }>>([]);
  const [rpm, setRpm] = useState(60);
  const [gatewayKey, setGatewayKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function setKey(provider: string, value: string) {
    setKeys((k) => ({ ...k, [provider]: value }));
    setValid((v) => ({ ...v, [provider]: "unknown" }));
    setChain((c) => {
      const has = c.some((e) => e.provider === provider);
      if (value.trim() && !has) {
        const def = PROVIDERS.find((p) => p.id === provider)!;
        return [...c, { provider, model: def.defaultModel }];
      }
      if (!value.trim() && has) return c.filter((e) => e.provider !== provider);
      return c;
    });
  }

  async function validate(provider: string) {
    const key = keys[provider]?.trim();
    if (!key) return;
    setValid((v) => ({ ...v, [provider]: "checking" }));
    try {
      const res = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, key }),
      });
      const { valid: ok } = await res.json();
      setValid((v) => ({ ...v, [provider]: ok ? "ok" : "bad" }));
    } catch {
      setValid((v) => ({ ...v, [provider]: "bad" }));
    }
  }

  function move(i: number, dir: -1 | 1) {
    setChain((c) => {
      const next = [...c];
      const j = i + dir;
      if (j < 0 || j >= next.length) return c;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function create() {
    setBusy(true);
    setError("");
    try {
      const providers = Object.fromEntries(
        Object.entries(keys).filter(([, v]) => v.trim()).map(([p, v]) => [p, v.trim()]),
      );
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providers, fallbackChain: chain, rateLimit: { rpm } }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Something went wrong.");
      setGatewayKey(json.gatewayKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const snippet = (key: string) => ({
    js: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://gatewayforai.com/v1",
  apiKey: "${key}",
});

const res = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Hello" }],
});`,
    py: `from openai import OpenAI

client = OpenAI(base_url="https://gatewayforai.com/v1", api_key="${key}")
res = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "Hello"}],
)`,
    curl: `curl https://gatewayforai.com/v1/chat/completions \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello"}]}'`,
  });

  if (gatewayKey) {
    const s = snippet(gatewayKey);
    return (
      <div className="container" style={{ maxWidth: 780, padding: "48px 24px" }}>
        <h1>Your gateway is live.</h1>
        <div className="panel">
          <h3>Gateway key — shown once, never again</h3>
          <p className="hint">We store only a hash. Copy it now.</p>
          <div className="keybox">{gatewayKey}</div>
          <button className="btn primary" onClick={() => navigator.clipboard.writeText(gatewayKey)}>
            Copy key
          </button>
        </div>
        {([["JavaScript", s.js], ["Python", s.py], ["curl", s.curl]] as const).map(([label, code]) => (
          <div className="panel" key={label}>
            <h3>{label}</h3>
            <pre style={{ fontSize: 12.5, overflowX: "auto", color: "var(--muted)" }}>{code}</pre>
          </div>
        ))}
        <p style={{ color: "var(--muted)" }}>
          Manage this config any time at <Link href="/manage" style={{ color: "var(--accent)" }}>/manage</Link> using your key.
        </p>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 780, padding: "48px 24px" }}>
      <Link href="/" className="mono" style={{ color: "var(--muted)" }}>← gatewayforai</Link>
      <h1 style={{ marginTop: 16 }}>Create your gateway</h1>
      <p style={{ color: "var(--muted)", marginBottom: 32 }}>
        Three steps, ~30 seconds. Keys are encrypted with AES-256-GCM and never shown again.
      </p>

      <div className="panel">
        <h3>1 · Provider keys</h3>
        <p className="hint">Paste any subset. Keys validate live against the provider.</p>
        {PROVIDERS.map((p) => (
          <div className="field" key={p.id}>
            <label>{p.label}</label>
            <input
              type="password"
              placeholder={`${p.label} API key (optional)`}
              value={keys[p.id] ?? ""}
              onChange={(e) => setKey(p.id, e.target.value)}
              onBlur={() => validate(p.id)}
            />
            <span className={`badge ${valid[p.id] === "ok" ? "ok" : valid[p.id] === "bad" ? "bad" : ""}`}>
              {valid[p.id] === "ok" ? "✓" : valid[p.id] === "bad" ? "✗" : valid[p.id] === "checking" ? "…" : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>2 · Fallback chain</h3>
        <p className="hint">
          Order decides who answers first when model is &quot;auto&quot;. Edit model names freely.
        </p>
        {chain.length === 0 && <p className="hint">Add a provider key above to build your chain.</p>}
        {chain.map((e, i) => (
          <div className="chain-row" key={e.provider}>
            <span className="order">{i + 1}</span>
            <span>{e.provider}/</span>
            <input
              value={e.model}
              onChange={(ev) =>
                setChain((c) => c.map((x, j) => (j === i ? { ...x, model: ev.target.value } : x)))
              }
            />
            <span className="arrows">
              <button onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            </span>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>3 · Rate limit</h3>
        <p className="hint">Requests per minute allowed through your gateway key.</p>
        <div className="field">
          <label>RPM</label>
          <select value={rpm} onChange={(e) => setRpm(Number(e.target.value))}>
            {[10, 30, 60, 120, 300, 600, 1000].map((n) => (
              <option key={n} value={n}>{n} requests / min</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      <button className="btn primary" disabled={busy || chain.length === 0} onClick={create}>
        {busy ? "Creating…" : "Create gateway →"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write `src/app/manage/page.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

interface ConfigView {
  providers: Record<string, string>;
  fallbackChain: Array<{ provider: string; model: string }>;
  rateLimit: { rpm: number };
  createdAt: string;
  usage: Array<Record<string, number | string>>;
}

export default function Manage() {
  const [key, setKey] = useState("");
  const [cfg, setCfg] = useState<ConfigView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(method: string, path = "/api/config", body?: unknown) {
    const res = await fetch(path, {
      method,
      headers: {
        Authorization: `Bearer ${key.trim()}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message ?? "Request failed.");
    return json;
  }

  async function load() {
    setBusy(true); setError(""); setNotice("");
    try { setCfg(await call("GET")); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError(""); setNotice("");
    try {
      await call("PATCH", "/api/config", {
        fallbackChain: cfg!.fallbackChain,
        rateLimit: cfg!.rateLimit,
      });
      setNotice("Saved.");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function rotate() {
    if (!confirm("Rotate key? The current key stops working immediately.")) return;
    setBusy(true); setError("");
    try {
      const { gatewayKey } = await call("POST", "/api/config/rotate");
      setKey(gatewayKey);
      setNotice(`New key (copy it now — shown once): ${gatewayKey}`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function destroy() {
    if (!confirm("Delete this gateway config permanently?")) return;
    setBusy(true); setError("");
    try { await call("DELETE"); setCfg(null); setKey(""); setNotice("Config deleted."); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function move(i: number, dir: -1 | 1) {
    setCfg((c) => {
      if (!c) return c;
      const chain = [...c.fallbackChain];
      const j = i + dir;
      if (j < 0 || j >= chain.length) return c;
      [chain[i], chain[j]] = [chain[j], chain[i]];
      return { ...c, fallbackChain: chain };
    });
  }

  return (
    <div className="container" style={{ maxWidth: 780, padding: "48px 24px" }}>
      <Link href="/" className="mono" style={{ color: "var(--muted)" }}>← gatewayforai</Link>
      <h1 style={{ marginTop: 16 }}>Manage your gateway</h1>

      <div className="panel">
        <div className="field">
          <label>gw key</label>
          <input
            type="password"
            placeholder="gw_live_…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button className="btn" onClick={load} disabled={busy || !key.trim()}>Load</button>
        </div>
      </div>

      {notice && <p style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontSize: 13 }}>{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      {cfg && (
        <>
          <div className="panel">
            <h3>Providers</h3>
            <p className="hint">Keys are masked. To change a key, delete and re-create the config (or PATCH via API).</p>
            {Object.entries(cfg.providers).map(([p, masked]) => (
              <div className="field" key={p}>
                <label>{p}</label>
                <input value={masked} disabled />
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>Fallback chain</h3>
            {cfg.fallbackChain.map((e, i) => (
              <div className="chain-row" key={`${e.provider}-${i}`}>
                <span className="order">{i + 1}</span>
                <span>{e.provider}/</span>
                <input
                  value={e.model}
                  onChange={(ev) =>
                    setCfg((c) => c && {
                      ...c,
                      fallbackChain: c.fallbackChain.map((x, j) =>
                        j === i ? { ...x, model: ev.target.value } : x),
                    })
                  }
                />
                <span className="arrows">
                  <button onClick={() => move(i, -1)}>↑</button>
                  <button onClick={() => move(i, 1)}>↓</button>
                </span>
              </div>
            ))}
            <div className="field" style={{ marginTop: 14 }}>
              <label>RPM</label>
              <select
                value={cfg.rateLimit.rpm}
                onChange={(e) => setCfg((c) => c && { ...c, rateLimit: { rpm: Number(e.target.value) } })}
              >
                {[10, 30, 60, 120, 300, 600, 1000].map((n) => (
                  <option key={n} value={n}>{n} requests / min</option>
                ))}
              </select>
            </div>
            <button className="btn primary" onClick={save} disabled={busy}>Save changes</button>
          </div>

          <div className="panel">
            <h3>Usage — last 7 days</h3>
            <pre style={{ fontSize: 12.5, color: "var(--muted)", overflowX: "auto" }}>
              {"date         requests  fallbacks  errors\n" +
                cfg.usage
                  .map((d) =>
                    `${d.date}   ${String(d.requests).padStart(8)}  ${String(d.fallbacks).padStart(9)}  ${String(d.errors).padStart(6)}`)
                  .join("\n")}
            </pre>
          </div>

          <div className="panel">
            <h3>Danger zone</h3>
            <p className="hint">Rotation invalidates the old key instantly. Deletion is permanent.</p>
            <button className="btn" onClick={rotate} disabled={busy} style={{ marginRight: 10 }}>
              Rotate key
            </button>
            <button className="btn" onClick={destroy} disabled={busy} style={{ color: "var(--red)", borderColor: "var(--red)" }}>
              Delete config
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `src/app/privacy/page.tsx`**

```tsx
import Link from "next/link";

export const metadata = { title: "Privacy — GatewayforAI" };

export default function Privacy() {
  return (
    <div className="container" style={{ maxWidth: 720, padding: "48px 24px" }}>
      <Link href="/" className="mono" style={{ color: "var(--muted)" }}>← gatewayforai</Link>
      <h1 style={{ marginTop: 16 }}>Privacy</h1>
      <p style={{ color: "var(--muted)" }}>The short version: we are a pipe, not a database.</p>

      <h2 style={{ fontSize: 20 }}>What we never store</h2>
      <p style={{ color: "var(--muted)" }}>
        Your prompts, your model responses, your users&apos; data. Requests stream through the
        gateway to the provider you chose and are gone. There is no logging of request or
        response bodies, anywhere, ever.
      </p>

      <h2 style={{ fontSize: 20 }}>What we store</h2>
      <p style={{ color: "var(--muted)" }}>
        (1) Your provider API keys, encrypted with AES-256-GCM — decrypted only in memory to
        call providers on your behalf, never logged, never displayed after creation.
        (2) A SHA-256 hash of your gateway key — we cannot recover the key itself.
        (3) Daily aggregate counters (request / error / fallback counts per provider),
        kept 30 days, used only to show you your usage.
      </p>

      <h2 style={{ fontSize: 20 }}>Deletion</h2>
      <p style={{ color: "var(--muted)" }}>
        Delete your config at <Link href="/manage" style={{ color: "var(--accent)" }}>/manage</Link> any
        time — keys and counters are removed immediately and irrecoverably.
      </p>

      <h2 style={{ fontSize: 20 }}>Third parties</h2>
      <p style={{ color: "var(--muted)" }}>
        Hosting: Vercel. Storage: Upstash (Redis). Your traffic additionally reaches the LLM
        providers you configured, under their terms.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Verify build + click-through**

Run: `npm run build`, then `npm run dev`. Walk `/start` (inputs render, chain rows appear when a key is typed), `/manage` (load with a bogus key → clean error), `/privacy`.
Expected: no build errors, no console errors, flows behave.

- [ ] **Step 5: Commit**

```bash
git add src/app/start src/app/manage src/app/privacy
git commit -m "feat: setup, manage and privacy pages"
```

---

### Task 15: Deploy to production

**Files:**
- Create: `README.md`
- Modify: `../../shipped/_shipped.tsv` (append row)

Follows the established portfolio pipeline: GitHub (`eruo005-dev/<name>`) → Vercel → row in `_shipped.tsv`.

- [ ] **Step 1: Write `README.md`**

```markdown
# GatewayforAI.com

OpenAI-compatible LLM gateway with automatic fallback routing and rate limiting.
BYOK — bring your own provider keys. No signup; the `gw_live_` key is the account.

## Stack
Next.js 15 · Upstash Redis · Vercel. Provider keys encrypted with AES-256-GCM
(`MASTER_KEY` env var). Prompts/responses are never stored.

## Env vars
See `.env.example`: `MASTER_KEY` (64 hex chars), `UPSTASH_REDIS_REST_URL`,
`UPSTASH_REDIS_REST_TOKEN`.

## Develop
npm install && npm run dev — tests: npm test

## API
- `POST /v1/chat/completions` — OpenAI-compatible, `Authorization: Bearer gw_live_...`,
  model `"provider/model"` or `"auto"` (fallback chain).
- `GET /v1/models` — union of models from configured providers.
- `POST/GET/PATCH/DELETE /api/config`, `POST /api/config/rotate` — config management.
```

- [ ] **Step 2: Provision Upstash Redis — CHECKPOINT (may need the user)**

Create a Redis database (region: closest to Vercel deployment, e.g. `eu-central-1` or global) and copy the REST URL + token:
- If `upstash` CLI or existing env credentials are available, use them.
- Otherwise STOP and ask the user to create a free database at `https://console.upstash.com` and paste `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

Then create `.env.local` (gitignored) with both values plus a fresh master key:

```bash
openssl rand -hex 32   # → MASTER_KEY value
```

Verify locally: `npm run dev`, then:

```bash
curl -s -X POST http://localhost:3000/api/config \
  -H "content-type: application/json" \
  -d '{"providers":{"openai":"sk-placeholder"},"fallbackChain":[{"provider":"openai","model":"gpt-4o"}],"rateLimit":{"rpm":60}}'
```

Expected: `{"gatewayKey":"gw_live_..."}` (201). Then `curl -s http://localhost:3000/api/config -H "Authorization: Bearer <that key>"` returns the masked config. Delete it afterwards with `curl -X DELETE`.

- [ ] **Step 3: Create GitHub repo and push**

```bash
gh repo create eruo005-dev/gatewayforai-com --public --source . --remote origin
git push -u origin main
```

Expected: repo visible at `https://github.com/eruo005-dev/gatewayforai-com`.

- [ ] **Step 4: Deploy to Vercel with env vars**

```bash
vercel link --yes
printf '%s' "$MASTER_KEY"               | vercel env add MASTER_KEY production
printf '%s' "$UPSTASH_REDIS_REST_URL"   | vercel env add UPSTASH_REDIS_REST_URL production
printf '%s' "$UPSTASH_REDIS_REST_TOKEN" | vercel env add UPSTASH_REDIS_REST_TOKEN production
vercel deploy --prod
```

Expected: production URL like `https://gatewayforai-xxxx-support-6002s-projects.vercel.app`. (Custom domain `gatewayforai.com` is attached in the Vercel dashboard once the user buys/points the domain — note this for the user, do not block on it.)

- [ ] **Step 5: Smoke test the live deployment**

With at least one real provider key (ask the user, or use a throwaway Groq/Gemini free-tier key):

```bash
BASE=<production-url>
# 1. create config
GW=$(curl -s -X POST $BASE/api/config -H "content-type: application/json" \
  -d '{"providers":{"groq":"<real-key>"},"fallbackChain":[{"provider":"groq","model":"llama-3.3-70b-versatile"}],"rateLimit":{"rpm":5}}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['gatewayKey'])")
# 2. real completion — expect 200 + x-gateway-provider: groq
curl -si $BASE/v1/chat/completions -H "Authorization: Bearer $GW" \
  -H "content-type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Say OK"}]}' | head -20
# 3. streaming — expect data: chunks
curl -sN $BASE/v1/chat/completions -H "Authorization: Bearer $GW" \
  -H "content-type: application/json" \
  -d '{"model":"auto","stream":true,"messages":[{"role":"user","content":"Count to 3"}]}' | head -5
# 4. rate limit — 6 rapid calls, expect a 429 with retry-after
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}\n" \
  $BASE/v1/chat/completions -H "Authorization: Bearer $GW" \
  -H "content-type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'; done
# 5. bad key — expect 401
curl -s -o /dev/null -w "%{http_code}\n" $BASE/v1/chat/completions \
  -H "Authorization: Bearer gw_live_bogus" -d '{}'
# 6. clean up the smoke config
curl -s -X DELETE $BASE/api/config -H "Authorization: Bearer $GW"
```

Expected: 200 with gateway headers, streaming chunks, at least one 429, a 401, cleanup `{"ok":true}`.

- [ ] **Step 6: Register in the portfolio**

Append to `../../shipped/_shipped.tsv` (tab-separated, matching existing rows):

```
gatewayforai.com	gatewayforai-com	https://github.com/eruo005-dev/gatewayforai-com	<production-url>
```

- [ ] **Step 7: Final commit**

```bash
git add README.md
git commit -m "docs: README + production deploy"
git push
```

---

## Done criteria

- All vitest suites green (`npm test`), `npm run build` clean.
- Live URL serves the landing page with working animations.
- Smoke test passes: completion, streaming, fallback headers, 429, 401.
- `_shipped.tsv` row added. Custom domain attachment handed to the user.
