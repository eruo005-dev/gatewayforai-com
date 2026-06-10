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
            <label htmlFor={`key-${p.id}`}>{p.label}</label>
            <input
              id={`key-${p.id}`}
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
              aria-label={`${e.provider} model`}
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
          <label htmlFor="rpm">RPM</label>
          <select id="rpm" value={rpm} onChange={(e) => setRpm(Number(e.target.value))}>
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
