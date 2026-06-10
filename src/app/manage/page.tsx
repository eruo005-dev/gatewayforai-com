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
  const [rotatedKey, setRotatedKey] = useState("");
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
      setRotatedKey(gatewayKey);
      setNotice("New key generated — copy it now, it is shown once.");
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
      {rotatedKey && (
        <div>
          <div className="keybox">{rotatedKey}</div>
          <button className="btn" onClick={() => navigator.clipboard.writeText(rotatedKey)}>Copy key</button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {cfg && (
        <>
          <div className="panel">
            <h3>Providers</h3>
            <p className="hint">Keys are masked. To change a key, delete and re-create the config (or PATCH via API).</p>
            {Object.entries(cfg.providers).map(([p, masked]) => (
              <div className="field" key={p}>
                <label htmlFor={`masked-${p}`}>{p}</label>
                <input id={`masked-${p}`} value={masked} disabled />
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
                  aria-label={`${e.provider} model`}
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
                  <button onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                  <button onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                </span>
              </div>
            ))}
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="manage-rpm">RPM</label>
              <select
                id="manage-rpm"
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
